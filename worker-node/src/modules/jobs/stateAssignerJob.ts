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
import { CancelableProcessHandle, QueueExecutionContext } from '../queue/queueEngine';
import { ensureStateAssignerDirectories, StateAssignerDirectories } from '../startup/stateAssignerFiles';
import ensureDbReady from '../db/ensureDbReady';
import { selectTargetArticles, TargetArticleRecord } from '../articleTargeting';
import { enrichArticleContent02 } from '../article-content-02/enrichment';
import {
  getCanonicalArticleContent02Row,
  hasUsableArticleContent02
} from '../article-content-02/repository';
import { StateAssignerAiConfig } from '../state-assigner/config';
import { analyzeArticleWithCodexCli } from '../state-assigner/codexCliClient';
import { analyzeArticleWithOpenAi } from '../state-assigner/openAiClient';
import { ChatGptResponse } from '../state-assigner/responseParsing';

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
  aiConfig: StateAssignerAiConfig;
  pathToStateAssignerFiles: string;
  articleIdMinExclusive?: number;
  articleIdMaxInclusive?: number;
  articleIds?: number[];
  includeArticlesThatMightHaveBeenStateAssigned?: boolean;
}

export interface StateAssignerJobContext extends StateAssignerJobInput {
  jobId: string;
  signal: AbortSignal;
  registerCancelableProcess: (handle: CancelableProcessHandle) => void;
}

export type StateAssignerEndingReason = 'completed' | 'canceled' | 'circuit_breaker' | 'error';
export type StateAssignerSkipReason = 'no_usable_content' | 'operator_canceled';
export type StateAssignerFailureReason = 'timeout' | 'analysis_error' | 'persistence_error';

export interface StateAssignerArticleOutcome<Reason extends string> {
  articleId: number;
  reason: Reason;
}

export interface StateAssignerJobResult {
  schemaVersion: 1;
  endingReason: StateAssignerEndingReason;
  terminalMessage: string;
  selectedArticleIds: number[];
  attemptedArticleIds: number[];
  successfulArticleIds: number[];
  skippedArticles: StateAssignerArticleOutcome<StateAssignerSkipReason>[];
  failedArticles: StateAssignerArticleOutcome<StateAssignerFailureReason>[];
  unattemptedArticleIds: number[];
  selectedCount: number;
  attemptedCount: number;
  successfulCount: number;
  skippedCount: number;
  failedCount: number;
  unattemptedCount: number;
  maximumConsecutiveFailures: number;
  circuitBreakerTripped: boolean;
}

type AnalyzeStateAssignerArticle = (
  aiConfig: StateAssignerAiConfig,
  stateAssignerDirectories: StateAssignerDirectories,
  promptTemplate: string,
  article: StateAssignerArticle,
  signal: AbortSignal,
  registerCancelableProcess: (handle: CancelableProcessHandle) => void
) => Promise<ChatGptResponse>;

interface ProcessStateAssignmentsOptions {
  articles: StateAssignerArticle[];
  prompt: PromptData;
  entityWhoCategorizesId: number;
  aiConfig: StateAssignerAiConfig;
  stateAssignerDirectories: StateAssignerDirectories;
  iterationTimeoutMs: number;
  signal: AbortSignal;
  registerCancelableProcess: (handle: CancelableProcessHandle) => void;
  analyzeArticle: AnalyzeStateAssignerArticle;
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

const buildStateAssignerResult = (input: {
  endingReason: StateAssignerEndingReason;
  terminalMessage: string;
  selectedArticleIds: number[];
  attemptedArticleIds: number[];
  successfulArticleIds: number[];
  skippedArticles: StateAssignerArticleOutcome<StateAssignerSkipReason>[];
  failedArticles: StateAssignerArticleOutcome<StateAssignerFailureReason>[];
  unattemptedArticleIds: number[];
  maximumConsecutiveFailures: number;
  circuitBreakerTripped: boolean;
}): StateAssignerJobResult => ({
  schemaVersion: 1,
  ...input,
  selectedCount: input.selectedArticleIds.length,
  attemptedCount: input.attemptedArticleIds.length,
  successfulCount: input.successfulArticleIds.length,
  skippedCount: input.skippedArticles.length,
  failedCount: input.failedArticles.length,
  unattemptedCount: input.unattemptedArticleIds.length
});

const emptyStateAssignerResult = (
  endingReason: StateAssignerEndingReason,
  terminalMessage: string
): StateAssignerJobResult => buildStateAssignerResult({
  endingReason,
  terminalMessage,
  selectedArticleIds: [],
  attemptedArticleIds: [],
  successfulArticleIds: [],
  skippedArticles: [],
  failedArticles: [],
  unattemptedArticleIds: [],
  maximumConsecutiveFailures: 0,
  circuitBreakerTripped: false
});

export interface StateAssignerJobDependencies {
  runLegacyWorkflow?: (context: StateAssignerJobContext) => Promise<StateAssignerJobResult>;
  selectArticles?: typeof selectTargetArticles;
  enrichContent02?: typeof enrichArticleContent02;
  getCanonicalContent02Row?: typeof getCanonicalArticleContent02Row;
  analyzeWithOpenAi?: AnalyzeStateAssignerArticle;
  analyzeWithCodexCli?: AnalyzeStateAssignerArticle;
  processAssignments?: (options: ProcessStateAssignmentsOptions) => Promise<StateAssignerJobResult>;
  ensureDb?: typeof ensureDbReady;
  ensureDirectories?: typeof ensureStateAssignerDirectories;
  syncPrompts?: (promptsDir: string) => Promise<void>;
  resolveEntityWhoCategorizes?: () => Promise<number>;
  loadPrompt?: () => Promise<PromptData>;
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
  aiConfig,
  stateAssignerDirectories,
  iterationTimeoutMs,
  signal,
  registerCancelableProcess,
  analyzeArticle,
  persistAssignment,
  log
}: ProcessStateAssignmentsOptions): Promise<StateAssignerJobResult> => {
  const selectedArticleIds = articles.map(({ id }) => id);
  const attemptedArticleIds: number[] = [];
  const successfulArticleIds: number[] = [];
  const skippedArticles: StateAssignerArticleOutcome<StateAssignerSkipReason>[] = [];
  const failedArticles: StateAssignerArticleOutcome<StateAssignerFailureReason>[] = [];
  let consecutiveFailures = 0;
  let maximumConsecutiveFailures = 0;

  const createResult = (
    endingReason: StateAssignerEndingReason,
    terminalMessage: string,
    unattemptedArticleIds: number[],
    circuitBreakerTripped = false
  ) => buildStateAssignerResult({
    endingReason,
    terminalMessage,
    selectedArticleIds,
    attemptedArticleIds,
    successfulArticleIds,
    skippedArticles,
    failedArticles,
    unattemptedArticleIds,
    maximumConsecutiveFailures,
    circuitBreakerTripped
  });

  const recordFailure = (articleId: number, reason: StateAssignerFailureReason): boolean => {
    failedArticles.push({ articleId, reason });
    consecutiveFailures += 1;
    maximumConsecutiveFailures = Math.max(maximumConsecutiveFailures, consecutiveFailures);
    return consecutiveFailures >= 5;
  };

  for (let index = 0; index < articles.length; index += 1) {
    if (signal.aborted) {
      return createResult(
        'canceled',
        'State assigner was canceled before all selected articles were attempted.',
        articles.slice(index).map(({ id }) => id)
      );
    }

    const article = articles[index];
    log.info(`Processing article ${article.id} (${index + 1}/${articles.length})`);

    if (article.title.trim() === '' && article.content.trim() === '') {
      skippedArticles.push({ articleId: article.id, reason: 'no_usable_content' });
      continue;
    }

    attemptedArticleIds.push(article.id);

    let response: ChatGptResponse;

    try {
      const result = await runWithIterationTimeout(
        (iterationSignal) =>
          analyzeArticle(
            aiConfig,
            stateAssignerDirectories,
            prompt.content,
            article,
            iterationSignal,
            registerCancelableProcess
          ),
        iterationTimeoutMs,
        signal
      );

      if (signal.aborted) {
        skippedArticles.push({ articleId: article.id, reason: 'operator_canceled' });
        return createResult(
          'canceled',
          'State assigner was canceled during article analysis.',
          articles.slice(index + 1).map(({ id }) => id)
        );
      }

      if (result.timedOut) {
        log.warn(
          `State assigner timeout for article ${article.id} after ${iterationTimeoutMs}ms. Skipping iteration.`
        );
        if (recordFailure(article.id, 'timeout')) {
          return createResult(
            'circuit_breaker',
            'State assigner stopped after five consecutive article failures.',
            articles.slice(index + 1).map(({ id }) => id),
            true
          );
        }
        continue;
      }
      response = result.value!;
    } catch (error) {
      if (signal.aborted || isAbortError(error)) {
        skippedArticles.push({ articleId: article.id, reason: 'operator_canceled' });
        return createResult(
          'canceled',
          'State assigner was canceled during article analysis.',
          articles.slice(index + 1).map(({ id }) => id)
        );
      }

      const message = error instanceof Error ? error.message : 'Unknown state assigner error';
      log.error(`State assigner analysis failed for article ${article.id}: ${message}`);
      log.warn(`Skipping article ${article.id} and continuing with next article`);
      if (recordFailure(article.id, 'analysis_error')) {
        return createResult(
          'circuit_breaker',
          'State assigner stopped after five consecutive article failures.',
          articles.slice(index + 1).map(({ id }) => id),
          true
        );
      }
      continue;
    }

    try {
      await persistAssignment(article.id, response, prompt.id, entityWhoCategorizesId);
      successfulArticleIds.push(article.id);
      consecutiveFailures = 0;
      log.info(`Successfully processed article ${article.id}`);
    } catch (error) {
      if (signal.aborted || isAbortError(error)) {
        skippedArticles.push({ articleId: article.id, reason: 'operator_canceled' });
        return createResult(
          'canceled',
          'State assigner was canceled while persisting an article assignment.',
          articles.slice(index + 1).map(({ id }) => id)
        );
      }
      const message = error instanceof Error ? error.message : 'Unknown state assignment persistence error';
      log.error(`State assigner persistence failed for article ${article.id}: ${message}`);
      if (recordFailure(article.id, 'persistence_error')) {
        return createResult(
          'circuit_breaker',
          'State assigner stopped after five consecutive article failures.',
          articles.slice(index + 1).map(({ id }) => id),
          true
        );
      }
    }
  }

  return createResult('completed', 'State assigner completed all selected articles.', []);
};

const runLegacyWorkflow = async (
  context: StateAssignerJobContext,
  dependencies: StateAssignerJobDependencies = {}
): Promise<StateAssignerJobResult> => {
  logWorkflowStart('State Assigner', {
    jobId: context.jobId,
    targetArticleThresholdDaysOld: context.targetArticleThresholdDaysOld,
    targetArticleStateReviewCount: context.targetArticleStateReviewCount
  });

  const ensureDb = dependencies.ensureDb ?? ensureDbReady;
  const ensureDirectories = dependencies.ensureDirectories ?? ensureStateAssignerDirectories;
  const syncPrompts = dependencies.syncPrompts ?? syncPromptFilesToDatabase;
  const resolveEntityWhoCategorizes =
    dependencies.resolveEntityWhoCategorizes ?? resolveEntityWhoCategorizesId;
  const loadPrompt = dependencies.loadPrompt ?? getPrompt;
  const selectArticles = dependencies.selectArticles ?? selectTargetArticles;
  const enrichContent02 = dependencies.enrichContent02 ?? enrichArticleContent02;
  const analyzeWithOpenAi = dependencies.analyzeWithOpenAi ?? analyzeArticleWithOpenAi;
  const analyzeWithCodexCli = dependencies.analyzeWithCodexCli ?? analyzeArticleWithCodexCli;
  const processAssignments =
    dependencies.processAssignments ?? processStateAssignmentsWithTimeout;

  await ensureDb();
  const stateAssignerDirectories = await ensureDirectories(
    context.pathToStateAssignerFiles
  );
  await syncPrompts(stateAssignerDirectories.promptsDir);

  const entityWhoCategorizesId = await resolveEntityWhoCategorizes();
  const prompt = await loadPrompt();
  const candidateArticles = await selectArticles({
    targetArticleStateReviewCount: context.targetArticleStateReviewCount,
    targetArticleThresholdDaysOld: context.targetArticleThresholdDaysOld,
    articleIds: context.articleIds,
    includeArticlesThatMightHaveBeenStateAssigned: context.includeArticlesThatMightHaveBeenStateAssigned,
    articleIdMinExclusive: context.articleIdMinExclusive,
    articleIdMaxInclusive: context.articleIdMaxInclusive
  });

  if (candidateArticles.length === 0) {
    logger.info('No articles to process');
    return emptyStateAssignerResult('completed', 'State assigner found no eligible articles.');
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
      return buildStateAssignerResult({
        endingReason: 'canceled',
        terminalMessage: 'State assigner was canceled during pre-scrape enrichment.',
        selectedArticleIds: candidateArticles.map(({ id }) => id),
        attemptedArticleIds: [],
        successfulArticleIds: [],
        skippedArticles: [],
        failedArticles: [],
        unattemptedArticleIds: candidateArticles.map(({ id }) => id),
        maximumConsecutiveFailures: 0,
        circuitBreakerTripped: false
      });
    }

    logger.warn('State assigner pre-scrape enrichment failed. Continuing with assignment.', {
      errorMessage: error instanceof Error ? error.message : 'Unknown enrichment error'
    });
  }

  const articles = await buildStateAssignerArticles(candidateArticles, {
    getCanonicalContent02Row: dependencies.getCanonicalContent02Row
  });

  const analyzeArticle =
    context.aiConfig.backend === 'openai' ? analyzeWithOpenAi : analyzeWithCodexCli;
  const iterationTimeoutMs =
    context.aiConfig.backend === 'openai'
      ? DEFAULT_ITERATION_TIMEOUT_MS
      : context.aiConfig.codexTimeoutMs;

  logger.info('State assigner AI backend selected', {
    backend: context.aiConfig.backend,
    modelName: context.aiConfig.modelName,
    iterationTimeoutMs
  });
  logger.info(`Starting to process ${articles.length} articles`);

  return processAssignments({
    articles,
    prompt,
    entityWhoCategorizesId,
    aiConfig: context.aiConfig,
    stateAssignerDirectories,
    iterationTimeoutMs,
    signal: context.signal,
    registerCancelableProcess: context.registerCancelableProcess,
    analyzeArticle,
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
    ((context: StateAssignerJobContext) => runLegacyWorkflow(context, dependencies));

  return async (queueContext: QueueExecutionContext): Promise<void> => {
    try {
      const result = await workflowRunner({
        jobId: queueContext.jobId,
        signal: queueContext.signal,
        registerCancelableProcess: queueContext.registerCancelableProcess,
        targetArticleThresholdDaysOld: input.targetArticleThresholdDaysOld,
        targetArticleStateReviewCount: input.targetArticleStateReviewCount,
        aiConfig: input.aiConfig,
        pathToStateAssignerFiles: input.pathToStateAssignerFiles,
        articleIds: input.articleIds,
        includeArticlesThatMightHaveBeenStateAssigned: input.includeArticlesThatMightHaveBeenStateAssigned,
        articleIdMinExclusive: input.articleIdMinExclusive,
        articleIdMaxInclusive: input.articleIdMaxInclusive
      });
      await queueContext.updateResult(result as unknown as Record<string, unknown>);
    } catch (error) {
      const result = emptyStateAssignerResult(
        'error',
        error instanceof Error ? error.message : 'State assigner failed.'
      );
      await queueContext.updateResult(result as unknown as Record<string, unknown>);
      throw error;
    }
  };
};
