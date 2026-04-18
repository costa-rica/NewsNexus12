import ExcelJS from 'exceljs';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  Article,
  ArticleApproved,
  ArticleEntityWhoCategorizedArticleContract,
  ArtificialIntelligence,
  dropLegacyArticleContentsTable,
  EntityWhoCategorizedArticle,
  initModels,
  sequelize
} from '@newsnexus/db-models';
import logger from '../logger';
import { QueueExecutionContext } from '../queue/queueEngine';

export interface SemanticScorerJobContext {
  jobId: string;
  semanticScorerDir: string;
  signal: AbortSignal;
}

export interface SemanticScorerJobDependencies {
  runLegacyWorkflow?: (context: SemanticScorerJobContext) => Promise<void>;
}

export interface ScorableArticle {
  id: number;
  title: string | null;
  description: string | null;
}

export interface ScoreResult {
  keyword: string | null;
  keywordRating: number | null;
}

interface ProcessArticlesOptions {
  articles: ScorableArticle[];
  keywords: string[];
  iterationTimeoutMs: number;
  signal: AbortSignal;
  scoreArticle: (article: ScorableArticle, keywords: string[], signal: AbortSignal) => Promise<ScoreResult>;
  persistScore: (articleId: number, keyword: string, keywordRating: number) => Promise<void>;
  progressEvery: number;
  writeRunningStatus: (count: number) => Promise<void>;
  writeCompletedStatus: (count: number) => Promise<void>;
  log: {
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
  };
}

const SEMANTIC_SCORER_KEYWORDS_FILENAME = 'NewsNexusSemanticScorerKeywords.xlsx';
const LEGACY_AI_NAME = 'NewsNexusSemanticScorer02';
const LEGACY_AI_MODEL = 'Xenova/paraphrase-MiniLM-L6-v2';
const LEGACY_AI_MODEL_TYPE = 'feature-extraction';
const DEFAULT_ITERATION_TIMEOUT_MS = 10_000;
const PROCESS_LOG_EVERY = 100;

let dbReadyPromise: Promise<void> | null = null;
let embedderPromise: Promise<
  (
    text: string,
    options: { pooling: 'mean'; normalize: true }
  ) => Promise<{ data: Float32Array | number[] }>
> | null = null;

const ensureDbReady = async (): Promise<void> => {
  if (dbReadyPromise) {
    return dbReadyPromise;
  }

  dbReadyPromise = (async () => {
    initModels();
    await sequelize.authenticate();
    await sequelize.sync();
    await dropLegacyArticleContentsTable();
  })();

  return dbReadyPromise;
};

const cosineSimilarity = (vecA: number[] | Float32Array, vecB: number[] | Float32Array): number => {
  const length = Math.min(vecA.length, vecB.length);

  let dot = 0;
  let normASum = 0;
  let normBSum = 0;

  for (let i = 0; i < length; i += 1) {
    const a = vecA[i];
    const b = vecB[i];
    dot += a * b;
    normASum += a * a;
    normBSum += b * b;
  }

  const normA = Math.sqrt(normASum);
  const normB = Math.sqrt(normBSum);

  if (normA === 0 || normB === 0) {
    return -1;
  }

  return dot / (normA * normB);
};

const pickArticleText = (article: ScorableArticle): string | null => {
  if (article.description && article.description.trim() !== '') {
    return article.description;
  }

  if (article.title && article.title.trim() !== '') {
    return article.title;
  }

  return null;
};

const getEmbedder = async (): Promise<
  (
    text: string,
    options: { pooling: 'mean'; normalize: true }
  ) => Promise<{ data: Float32Array | number[] }>
> => {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      const transformers = (await import('@huggingface/transformers')) as {
        pipeline: (
          task: 'feature-extraction',
          model: string
        ) => Promise<
          (
            text: string,
            options: { pooling: 'mean'; normalize: true }
          ) => Promise<{ data: Float32Array | number[] }>
        >;
      };

      logger.info(`Loading semantic scorer model: ${LEGACY_AI_MODEL}`);
      return transformers.pipeline('feature-extraction', LEGACY_AI_MODEL);
    })();
  }

  return embedderPromise;
};

export const scoreArticleWithEmbeddings = async (
  article: ScorableArticle,
  keywords: string[],
  embedder?: (
    text: string,
    options: { pooling: 'mean'; normalize: true }
  ) => Promise<{ data: Float32Array | number[] }>
): Promise<ScoreResult> => {
  const text = pickArticleText(article);

  if (!text) {
    return { keyword: null, keywordRating: null };
  }

  const loadedEmbedder = embedder ?? (await getEmbedder());
  const articleVec = (await loadedEmbedder(text, { pooling: 'mean', normalize: true })).data;

  let bestKeyword: string | null = null;
  let bestRating = -Infinity;

  for (const keyword of keywords) {
    const keywordVec = (await loadedEmbedder(keyword, { pooling: 'mean', normalize: true })).data;
    const rating = cosineSimilarity(articleVec, keywordVec);
    if (rating > bestRating) {
      bestRating = rating;
      bestKeyword = keyword;
    }
  }

  if (!bestKeyword || bestRating < 0) {
    return { keyword: null, keywordRating: null };
  }

  return { keyword: bestKeyword, keywordRating: bestRating };
};

const withTimeout = async <T>(operation: Promise<T>, timeoutMs: number): Promise<T | null> =>
  new Promise<T | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      resolve(null);
    }, timeoutMs);

    operation
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      });
  });

const toTimestampedStatus = (count: number): string =>
  `Count of Loops: ${count}, on ${new Date().toISOString()}`;

export const resolveSemanticScorerKeywordsPath = (semanticScorerDir: string): string =>
  path.join(semanticScorerDir, SEMANTIC_SCORER_KEYWORDS_FILENAME);

export const verifySemanticScorerDirectoryExists = async (semanticScorerDir: string): Promise<void> => {
  try {
    const stats = await fs.stat(semanticScorerDir);
    if (!stats.isDirectory()) {
      throw new Error(`Semantic scorer path is not a directory: ${semanticScorerDir}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Semantic scorer directory not found: ${semanticScorerDir}`);
    }

    throw error;
  }
};

export const verifyKeywordsWorkbookExists = async (semanticScorerDir: string): Promise<string> => {
  const workbookPath = resolveSemanticScorerKeywordsPath(semanticScorerDir);

  try {
    const stats = await fs.stat(workbookPath);
    if (!stats.isFile()) {
      throw new Error(`Semantic scorer keywords workbook path is not a file: ${workbookPath}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Semantic scorer keywords workbook not found: ${workbookPath}`);
    }

    throw error;
  }

  return workbookPath;
};

const loadKeywordsFromExcel = async (excelPath: string): Promise<string[]> => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(excelPath);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error(`Keywords workbook has no worksheet: ${excelPath}`);
  }

  const keywords: string[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }

    const value = row.getCell(1).value;
    if (value === null || value === undefined) {
      return;
    }

    const keyword = String(value).trim();
    if (keyword !== '') {
      keywords.push(keyword);
    }
  });

  return keywords;
};

const resolveEntityWhoCategorizesId = async (): Promise<number> => {
  const aiModel = await ArtificialIntelligence.findOne({
    where: {
      name: LEGACY_AI_NAME,
      huggingFaceModelName: LEGACY_AI_MODEL,
      huggingFaceModelType: LEGACY_AI_MODEL_TYPE
    }
  });

  if (!aiModel) {
    throw new Error('Missing ArtificialIntelligence row for NewsNexusSemanticScorer02.');
  }

  const entity = await EntityWhoCategorizedArticle.findOne({
    where: {
      artificialIntelligenceId: aiModel.id
    }
  });

  if (!entity) {
    throw new Error('Missing EntityWhoCategorizedArticle row for semantic scorer AI model.');
  }

  return entity.id;
};

const createFilteredArticlesArray = async (
  entityWhoCategorizesId: number
): Promise<ScorableArticle[]> => {
  const existingContracts = await ArticleEntityWhoCategorizedArticleContract.findAll({
    where: { entityWhoCategorizesId },
    attributes: ['articleId'],
    raw: true
  });

  const alreadyProcessed = new Set(
    existingContracts
      .map((row) => (row as { articleId?: unknown }).articleId)
      .filter((value): value is number => typeof value === 'number')
  );

  type ArticleWithApproved = Article & {
    ArticleApproveds?: ArticleApproved[];
  };

  const allArticles = (await Article.findAll({
    include: [{ model: ArticleApproved }]
  })) as ArticleWithApproved[];

  return allArticles
    .filter((article) => !alreadyProcessed.has(article.id))
    .map((article) => {
      let description = article.description;
      if (!description || description.trim() === '') {
        description = article.ArticleApproveds?.[0]?.textForPdfReport ?? null;
      }

      return {
        id: article.id,
        title: article.title,
        description
      };
    });
};

const writeRunningStatus = async (semanticScorerDir: string, count: number): Promise<void> => {
  const statusPath = path.join(semanticScorerDir, 'isRunningStatus.txt');
  await fs.writeFile(statusPath, toTimestampedStatus(count), 'utf8');
};

const writeCompletedStatus = async (semanticScorerDir: string, count: number): Promise<void> => {
  const completedPath = path.join(semanticScorerDir, 'lastRunCompleted.txt');
  const runningPath = path.join(semanticScorerDir, 'isRunningStatus.txt');

  await fs.writeFile(completedPath, toTimestampedStatus(count), 'utf8');

  try {
    await fs.unlink(runningPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
};

export const processArticlesWithTimeout = async ({
  articles,
  keywords,
  iterationTimeoutMs,
  signal,
  scoreArticle,
  persistScore,
  progressEvery,
  writeRunningStatus: writeRunningStatusFile,
  writeCompletedStatus: writeCompletedStatusFile,
  log
}: ProcessArticlesOptions): Promise<void> => {
  for (let index = 0; index < articles.length; index += 1) {
    if (signal.aborted) {
      return;
    }

    const article = articles[index];

    try {
      const scoreResult = await withTimeout(
        scoreArticle(article, keywords, signal),
        iterationTimeoutMs
      );

      if (scoreResult === null) {
        log.warn(
          `Semantic scorer timeout for article ${article.id} after ${iterationTimeoutMs}ms. Skipping iteration.`
        );
      } else if (scoreResult.keyword && scoreResult.keywordRating !== null) {
        await persistScore(article.id, scoreResult.keyword, scoreResult.keywordRating);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown semantic scoring error';
      log.error(`Semantic scorer iteration failed for article ${article.id}: ${message}`);
    }

    const loopCount = index + 1;
    if (loopCount % progressEvery === 0) {
      log.info(`Processed ${loopCount} articles...`);
      await writeRunningStatusFile(loopCount);
    }
  }

  await writeCompletedStatusFile(articles.length);
  log.info('✅ All articles processed and saved.');
};

const runLegacyWorkflow = async (context: SemanticScorerJobContext): Promise<void> => {
  await verifySemanticScorerDirectoryExists(context.semanticScorerDir);
  const keywordsWorkbookPath = await verifyKeywordsWorkbookExists(context.semanticScorerDir);

  await ensureDbReady();

  const entityWhoCategorizesId = await resolveEntityWhoCategorizesId();
  logger.info(`EntityWhoCategorizedArticle: ${entityWhoCategorizesId}`);

  const articles = await createFilteredArticlesArray(entityWhoCategorizesId);
  logger.info(`Loaded articles: ${articles.length}`);

  const keywords = await loadKeywordsFromExcel(keywordsWorkbookPath);
  logger.info(`Loaded keywords: ${keywords.length}`);
  const embedder = await getEmbedder();

  await processArticlesWithTimeout({
    articles,
    keywords,
    iterationTimeoutMs: DEFAULT_ITERATION_TIMEOUT_MS,
    signal: context.signal,
    scoreArticle: (article, keywordList) => scoreArticleWithEmbeddings(article, keywordList, embedder),
    persistScore: async (articleId, keyword, keywordRating) => {
      await ArticleEntityWhoCategorizedArticleContract.upsert({
        articleId,
        entityWhoCategorizesId,
        keyword,
        keywordRating
      });
    },
    progressEvery: PROCESS_LOG_EVERY,
    writeRunningStatus: (count) => writeRunningStatus(context.semanticScorerDir, count),
    writeCompletedStatus: (count) => writeCompletedStatus(context.semanticScorerDir, count),
    log: logger
  });
};

export const createSemanticScorerJobHandler = (
  semanticScorerDir: string,
  dependencies: SemanticScorerJobDependencies = {}
) => {
  const workflowRunner = dependencies.runLegacyWorkflow ?? runLegacyWorkflow;

  return async (queueContext: QueueExecutionContext): Promise<void> => {
    await verifySemanticScorerDirectoryExists(semanticScorerDir);
    await verifyKeywordsWorkbookExists(semanticScorerDir);

    await workflowRunner({
      jobId: queueContext.jobId,
      semanticScorerDir,
      signal: queueContext.signal
    });
  };
};
