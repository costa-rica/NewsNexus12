import {
  ArticleStateContract02,
  ArtificialIntelligence,
  EntityWhoCategorizedArticle,
  Prompt,
  State,
} from '@newsnexus/db-models';
import fs from 'node:fs/promises';
import path from 'node:path';
import logger, { logWorkflowStart } from '../logger';
import { QueueExecutionContext } from '../queue/queueEngine';
import { ensureStateAssignerDirectories, StateAssignerDirectories } from '../startup/stateAssignerFiles';
import ensureDbReady from '../db/ensureDbReady';
import { selectTargetArticles, TargetArticleRecord } from '../articleTargeting';
import { enrichArticleContent02 } from '../article-content-02/enrichment';
import {
  getCanonicalArticleContent02Row,
  hasUsableArticleContent02
} from '../article-content-02/repository';

interface StateAssignerArticle {
  id: number;
  title: string;
  content: string;
}

interface PromptData {
  id: number;
  content: string;
}

export interface StateAssignerJobInput {
  targetArticleThresholdDaysOld: number;
  targetArticleStateReviewCount: number;
  keyOpenAi: string;
  pathToStateAssignerFiles: string;
}

export interface StateAssignerJobContext extends StateAssignerJobInput {
  jobId: string;
  signal: AbortSignal;
}

export interface ChatGptResponse {
  occuredInTheUS: boolean;
  reasoning: string;
  state?: string;
}

export interface StateAssignerJobDependencies {
  runLegacyWorkflow?: (context: StateAssignerJobContext) => Promise<void>;
  selectArticles?: typeof selectTargetArticles;
  enrichContent02?: typeof enrichArticleContent02;
  getCanonicalContent02Row?: typeof getCanonicalArticleContent02Row;
}

interface ProcessStateAssignmentsOptions {
  articles: StateAssignerArticle[];
  prompt: PromptData;
  entityWhoCategorizesId: number;
  keyOpenAi: string;
  stateAssignerDirectories: StateAssignerDirectories;
  iterationTimeoutMs: number;
  signal: AbortSignal;
  analyzeArticle: (
    keyOpenAi: string,
    stateAssignerDirectories: StateAssignerDirectories,
    promptTemplate: string,
    article: StateAssignerArticle,
    signal: AbortSignal
  ) => Promise<ChatGptResponse>;
  persistAssignment: (
    articleId: number,
    response: ChatGptResponse,
    promptId: number,
    entityWhoCategorizesId: number
  ) => Promise<void>;
  log: {
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
  };
}

const LEGACY_AI_NAME = 'NewsNexusLlmStateAssigner01';
const DEFAULT_ITERATION_TIMEOUT_MS = 10_000;

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'));

const resolveEntityWhoCategorizesId = async (): Promise<number> => {
  const aiEntity = await ArtificialIntelligence.findOne({
    where: { name: LEGACY_AI_NAME }
  });

  if (!aiEntity) {
    throw new Error(`No ArtificialIntelligence found with name: ${LEGACY_AI_NAME}`);
  }

  const categorizerEntity = await EntityWhoCategorizedArticle.findOne({
    where: { artificialIntelligenceId: aiEntity.id }
  });

  if (!categorizerEntity) {
    throw new Error(
      `No EntityWhoCategorizedArticle found with artificialIntelligenceId: ${aiEntity.id}`
    );
  }

  return categorizerEntity.id;
};

const getPrompt = async (): Promise<PromptData> => {
  const prompt = await Prompt.findOne({
    order: [['id', 'DESC']]
  });

  if (!prompt) {
    throw new Error('No prompts found in database');
  }

  return {
    id: prompt.id,
    content: prompt.promptInMarkdown
  };
};

const loadPromptMarkdownFiles = async (promptsDir: string): Promise<string[]> => {
  const entries = await fs.readdir(promptsDir, { withFileTypes: true });

  const markdownFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const contents: string[] = [];
  for (const fileName of markdownFiles) {
    const fullPath = path.join(promptsDir, fileName);
    const content = (await fs.readFile(fullPath, 'utf8')).trim();
    if (content !== '') {
      contents.push(content);
    }
  }

  return contents;
};

const syncPromptFilesToDatabase = async (promptsDir: string): Promise<void> => {
  const promptContents = await loadPromptMarkdownFiles(promptsDir);

  for (const content of promptContents) {
    const existingPrompt = await Prompt.findOne({
      where: { promptInMarkdown: content }
    });

    if (!existingPrompt) {
      await Prompt.create({ promptInMarkdown: content });
    }
  }
};

const buildStateAssignerArticles = async (
  targetArticles: TargetArticleRecord[],
  dependencies: Pick<StateAssignerJobDependencies, 'getCanonicalContent02Row'> = {}
): Promise<StateAssignerArticle[]> => {
  const getCanonicalContent02Row =
    dependencies.getCanonicalContent02Row ?? getCanonicalArticleContent02Row;

  return Promise.all(
    targetArticles.map(async (article) => {
      const articleContent = await getCanonicalContent02Row(article.id);
      const content =
        articleContent && hasUsableArticleContent02(articleContent.content)
          ? articleContent.content ?? ''
          : article.description || '';

      return {
        id: article.id,
        title: article.title ?? '',
        content
      };
    })
  );
};

const buildPrompt = (template: string, article: StateAssignerArticle): string =>
  template.replace('{articleTitle}', article.title).replace('{articleContent}', article.content);

const analyzeArticleWithOpenAi = async (
  keyOpenAi: string,
  stateAssignerDirectories: StateAssignerDirectories,
  promptTemplate: string,
  article: StateAssignerArticle,
  signal: AbortSignal
): Promise<ChatGptResponse> => {
  const prompt = buildPrompt(promptTemplate, article);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${keyOpenAi}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3
    }),
    signal
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed with status ${response.status}`);
  }

  const completion = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const rawContent = completion.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error('No response content from OpenAI');
  }

  const responseFileName = `response-${article.id}-${new Date().toISOString().replace(/:/g, '-')}.json`;
  const responseFilePath = path.join(stateAssignerDirectories.chatGptResponsesDir, responseFileName);
  await fs.writeFile(responseFilePath, rawContent, 'utf8');

  const parsed = JSON.parse(rawContent) as ChatGptResponse;

  if (typeof parsed.occuredInTheUS !== 'boolean') {
    throw new Error("Invalid response: missing or invalid 'occuredInTheUS'");
  }
  if (typeof parsed.reasoning !== 'string' || parsed.reasoning.trim() === '') {
    throw new Error("Invalid response: missing 'reasoning'");
  }

  return parsed;
};

const saveArticleStateContract = async (
  articleId: number,
  response: ChatGptResponse,
  promptId: number,
  entityWhoCategorizesId: number
): Promise<void> => {
  let stateId: number | null = null;

  if (response.occuredInTheUS && response.state && response.state.trim() !== '') {
    const stateName = response.state.trim();

    let state = await State.findOne({ where: { name: stateName } });
    if (!state) {
      state = await State.findOne({ where: { abbreviation: stateName } });
    }

    stateId = state?.id ?? null;
    if (!stateId) {
      logger.warn(`State not found in database: ${stateName}. Saving article ${articleId} with stateId=null`);
    }
  }

  await ArticleStateContract02.create({
    articleId,
    stateId,
    entityWhoCategorizesId,
    promptId,
    isHumanApproved: false,
    isDeterminedToBeError: false,
    occuredInTheUS: response.occuredInTheUS,
    reasoning: response.reasoning
  });
};

const runWithIterationTimeout = async <T>(
  task: (signal: AbortSignal) => Promise<T>,
  iterationTimeoutMs: number,
  queueSignal: AbortSignal
): Promise<{ timedOut: boolean; value?: T }> => {
  const iterationAbortController = new AbortController();

  const onQueueAbort = () => {
    iterationAbortController.abort('job_canceled');
  };
  queueSignal.addEventListener('abort', onQueueAbort, { once: true });

  const timeout = setTimeout(() => {
    iterationAbortController.abort('iteration_timeout');
  }, iterationTimeoutMs);

  try {
    const value = await task(iterationAbortController.signal);
    return { timedOut: false, value };
  } catch (error) {
    if (
      iterationAbortController.signal.aborted &&
      iterationAbortController.signal.reason === 'iteration_timeout'
    ) {
      return { timedOut: true };
    }

    throw error;
  } finally {
    clearTimeout(timeout);
    queueSignal.removeEventListener('abort', onQueueAbort);
  }
};

export const processStateAssignmentsWithTimeout = async ({
  articles,
  prompt,
  entityWhoCategorizesId,
  keyOpenAi,
  stateAssignerDirectories,
  iterationTimeoutMs,
  signal,
  analyzeArticle,
  persistAssignment,
  log
}: ProcessStateAssignmentsOptions): Promise<void> => {
  for (let index = 0; index < articles.length; index += 1) {
    if (signal.aborted) {
      return;
    }

    const article = articles[index];
    log.info(`Processing article ${article.id} (${index + 1}/${articles.length})`);

    try {
      const result = await runWithIterationTimeout(
        (iterationSignal) =>
          analyzeArticle(
            keyOpenAi,
            stateAssignerDirectories,
            prompt.content,
            article,
            iterationSignal
          ),
        iterationTimeoutMs,
        signal
      );

      if (result.timedOut) {
        log.warn(
          `State assigner timeout for article ${article.id} after ${iterationTimeoutMs}ms. Skipping iteration.`
        );
        continue;
      }

      await persistAssignment(article.id, result.value!, prompt.id, entityWhoCategorizesId);
      log.info(`Successfully processed article ${article.id}`);
    } catch (error) {
      if (signal.aborted || isAbortError(error)) {
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown state assigner error';
      log.error(`Failed to process article ${article.id}: ${message}`);
      log.warn(`Skipping article ${article.id} and continuing with next article`);
    }
  }
};

const runLegacyWorkflow = async (
  context: StateAssignerJobContext,
  dependencies: Pick<
    StateAssignerJobDependencies,
    'selectArticles' | 'enrichContent02' | 'getCanonicalContent02Row'
  > = {}
): Promise<void> => {
  logWorkflowStart('State Assigner', {
    jobId: context.jobId,
    targetArticleThresholdDaysOld: context.targetArticleThresholdDaysOld,
    targetArticleStateReviewCount: context.targetArticleStateReviewCount
  });

  await ensureDbReady();
  const stateAssignerDirectories = await ensureStateAssignerDirectories(
    context.pathToStateAssignerFiles
  );
  await syncPromptFilesToDatabase(stateAssignerDirectories.promptsDir);

  const selectArticles = dependencies.selectArticles ?? selectTargetArticles;
  const enrichContent02 = dependencies.enrichContent02 ?? enrichArticleContent02;
  const entityWhoCategorizesId = await resolveEntityWhoCategorizesId();
  const prompt = await getPrompt();
  const candidateArticles = await selectArticles({
    targetArticleStateReviewCount: context.targetArticleStateReviewCount,
    targetArticleThresholdDaysOld: context.targetArticleThresholdDaysOld
  });

  if (candidateArticles.length === 0) {
    logger.info('No articles to process');
    return;
  }

  logger.info('State assigner selected candidate articles for pre-scrape enrichment', {
    candidateArticleIds: candidateArticles.map((article) => article.id)
  });

  try {
    const scrapeSummary = await enrichContent02({
      articles: candidateArticles,
      signal: context.signal
    });

    logger.info('State assigner pre-scrape enrichment summary', scrapeSummary);
  } catch (error) {
    if (context.signal.aborted || isAbortError(error)) {
      return;
    }

    logger.warn('State assigner pre-scrape enrichment failed. Continuing with assignment.', {
      errorMessage: error instanceof Error ? error.message : 'Unknown enrichment error'
    });
  }

  const articles = await buildStateAssignerArticles(candidateArticles, {
    getCanonicalContent02Row: dependencies.getCanonicalContent02Row
  });

  logger.info(`Starting to process ${articles.length} articles`);

  await processStateAssignmentsWithTimeout({
    articles,
    prompt,
    entityWhoCategorizesId,
    keyOpenAi: context.keyOpenAi,
    stateAssignerDirectories,
    iterationTimeoutMs: DEFAULT_ITERATION_TIMEOUT_MS,
    signal: context.signal,
    analyzeArticle: analyzeArticleWithOpenAi,
    persistAssignment: saveArticleStateContract,
    log: logger
  });
};

export const createStateAssignerJobHandler = (
  input: StateAssignerJobInput,
  dependencies: StateAssignerJobDependencies = {}
) => {
  const workflowRunner =
    dependencies.runLegacyWorkflow ??
    ((context: StateAssignerJobContext) =>
      runLegacyWorkflow(context, {
        selectArticles: dependencies.selectArticles,
        enrichContent02: dependencies.enrichContent02,
        getCanonicalContent02Row: dependencies.getCanonicalContent02Row
      }));

  return async (queueContext: QueueExecutionContext): Promise<void> => {
    await workflowRunner({
      jobId: queueContext.jobId,
      signal: queueContext.signal,
      targetArticleThresholdDaysOld: input.targetArticleThresholdDaysOld,
      targetArticleStateReviewCount: input.targetArticleStateReviewCount,
      keyOpenAi: input.keyOpenAi,
      pathToStateAssignerFiles: input.pathToStateAssignerFiles
    });
  };
};
