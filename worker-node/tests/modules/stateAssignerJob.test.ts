import {
  createStateAssignerJobHandler,
  processStateAssignmentsWithTimeout,
  StateAssignerJobInput,
  StateAssignerJobResult
} from '../../src/modules/jobs/stateAssignerJob';
import { StateAssignerAiConfig } from '../../src/modules/state-assigner/config';
import { QueueExecutionContext } from '../../src/modules/queue/queueEngine';

type ProcessStateAssignmentsOptions = Parameters<typeof processStateAssignmentsWithTimeout>[0];
type AnalyzeArticle = ProcessStateAssignmentsOptions['analyzeArticle'];

const stateAssignerDirectories = {
  rootDir: '/tmp/state-assigner-files',
  chatGptResponsesDir: '/tmp/state-assigner-files/chatgpt_responses',
  promptsDir: '/tmp/state-assigner-files/prompts'
};

const emptyContent02Summary = {
  articlesConsidered: 0,
  articlesSkipped: 0,
  successfulScrapes: 0,
  failedScrapes: 0,
  createdRows: 0,
  updatedRows: 0
};

const openAiConfig: StateAssignerAiConfig = {
  backend: 'openai',
  modelName: 'gpt-4o-mini',
  keyOpenAi: 'test-key'
};

const codexConfig: StateAssignerAiConfig = {
  backend: 'codex-cli',
  modelName: 'gpt-5.4-mini',
  codexTimeoutMs: 180_000
};

const createQueueContext = (
  registerCancelableProcess = jest.fn(),
  updateResult = jest.fn(() => Promise.resolve())
): QueueExecutionContext => ({
  jobId: 'job-1',
  endpointName: '/state-assigner/start-job',
  signal: new AbortController().signal,
  registerCancelableProcess,
  updateResult
});

const createAnalyzer = (): jest.MockedFunction<AnalyzeArticle> =>
  jest.fn<ReturnType<AnalyzeArticle>, Parameters<AnalyzeArticle>>(
    async () => ({ occuredInTheUS: true, reasoning: 'ok', state: 'CA' })
  );

const resultForSuccessfulIds = (articleIds: number[]): StateAssignerJobResult => ({
  schemaVersion: 1,
  endingReason: 'completed',
  terminalMessage: 'State assigner completed all selected articles.',
  selectedArticleIds: articleIds,
  attemptedArticleIds: articleIds,
  successfulArticleIds: articleIds,
  skippedArticles: [],
  failedArticles: [],
  unattemptedArticleIds: [],
  selectedCount: articleIds.length,
  attemptedCount: articleIds.length,
  successfulCount: articleIds.length,
  skippedCount: 0,
  failedCount: 0,
  unattemptedCount: 0,
  maximumConsecutiveFailures: 0,
  circuitBreakerTripped: false
});

const silentLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

const runWorkflowWithConfig = async (
  aiConfig: StateAssignerAiConfig,
  inputOverrides: Partial<StateAssignerJobInput> = {}
) => {
  const analyzeWithOpenAi = createAnalyzer();
  const analyzeWithCodexCli = createAnalyzer();
  const processAssignments = jest.fn<Promise<StateAssignerJobResult>, [ProcessStateAssignmentsOptions]>(
    async () => resultForSuccessfulIds([1])
  );
  const registerCancelableProcess = jest.fn();
  const updateResult = jest.fn(() => Promise.resolve());
  const selectedArticle = {
    id: 1,
    title: 'test title',
    description: 'test description',
    url: 'https://example.com/article',
    publishedDate: '2026-07-10'
  };
  const selectArticles = jest.fn(async () => [selectedArticle]);
  const enrichContent02 = jest.fn(async () => emptyContent02Summary);

  const handler = createStateAssignerJobHandler(
    {
      targetArticleThresholdDaysOld: 15,
      targetArticleStateReviewCount: 25,
      aiConfig,
      pathToStateAssignerFiles: '/tmp/state-assigner-files',
      ...inputOverrides
    },
    {
      ensureDb: async () => undefined,
      ensureDirectories: async () => stateAssignerDirectories,
      syncPrompts: async () => undefined,
      resolveEntityWhoCategorizes: async () => 11,
      loadPrompt: async () => ({ id: 7, content: 'test prompt' }),
      selectArticles,
      enrichContent02,
      getCanonicalContent02Row: async () => null,
      analyzeWithOpenAi,
      analyzeWithCodexCli,
      processAssignments
    }
  );

  await handler(createQueueContext(registerCancelableProcess, updateResult));

  return {
    analyzeWithOpenAi,
    analyzeWithCodexCli,
    processAssignments,
    registerCancelableProcess,
    updateResult,
    selectArticles,
    enrichContent02,
    selectedArticle,
    capturedOptions: processAssignments.mock.calls[0][0]
  };
};

describe('stateAssigner job handler', () => {
  it('passes request parameters to legacy workflow dependency', async () => {
    const runLegacyWorkflow = jest.fn(async () => resultForSuccessfulIds([]));
    const registerCancelableProcess = jest.fn();

    const handler = createStateAssignerJobHandler(
      {
        targetArticleThresholdDaysOld: 15,
        targetArticleStateReviewCount: 25,
        aiConfig: openAiConfig,
        pathToStateAssignerFiles: '/tmp/state-assigner-files'
      },
      { runLegacyWorkflow }
    );

    await handler(createQueueContext(registerCancelableProcess));

    expect(runLegacyWorkflow).toHaveBeenCalledWith({
      jobId: 'job-1',
      signal: expect.any(Object),
      registerCancelableProcess,
      targetArticleThresholdDaysOld: 15,
      targetArticleStateReviewCount: 25,
      aiConfig: openAiConfig,
      pathToStateAssignerFiles: '/tmp/state-assigner-files'
    });
  });

  it('passes exact cohort IDs and capacity to the workflow dependency', async () => {
    const runLegacyWorkflow = jest.fn(async () => resultForSuccessfulIds([101, 202]));
    const updateResult = jest.fn(() => Promise.resolve());
    const handler = createStateAssignerJobHandler(
      {
        targetArticleThresholdDaysOld: 180,
        targetArticleStateReviewCount: 250,
        articleIds: [101, 202],
        aiConfig: openAiConfig,
        pathToStateAssignerFiles: '/tmp/state-assigner-files'
      },
      { runLegacyWorkflow }
    );

    await handler(createQueueContext(jest.fn(), updateResult));

    expect(runLegacyWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      articleIds: [101, 202],
      targetArticleStateReviewCount: 250
    }));
    expect(updateResult).toHaveBeenCalledWith(expect.objectContaining({
      selectedArticleIds: [101, 202],
      selectedCount: 2,
      successfulCount: 2
    }));
  });

  it('times out one iteration, logs it, and continues processing next article', async () => {
    const warnings: string[] = [];
    const persisted: number[] = [];
    const registerCancelableProcess = jest.fn();

    const result = await processStateAssignmentsWithTimeout({
      articles: [
        { id: 1, title: 'a', content: 'c1' },
        { id: 2, title: 'b', content: 'c2' }
      ],
      prompt: { id: 7, content: 'test prompt' },
      entityWhoCategorizesId: 11,
      aiConfig: openAiConfig,
      stateAssignerDirectories,
      iterationTimeoutMs: 10,
      signal: new AbortController().signal,
      registerCancelableProcess,
      analyzeArticle: async (_aiConfig, _dirs, _prompt, article, signal) => {
        if (article.id === 1) {
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(resolve, 30);
            signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timeout);
                reject(new DOMException('The operation was aborted.', 'AbortError'));
              },
              { once: true }
            );
          });
          return { occuredInTheUS: true, reasoning: 'late', state: 'CA' };
        }

        return { occuredInTheUS: true, reasoning: 'ok', state: 'NY' };
      },
      persistAssignment: async (articleId) => {
        persisted.push(articleId);
      },
      log: {
        info: () => undefined,
        warn: (message: string) => {
          warnings.push(message);
        },
        error: () => undefined
      }
    });

    expect(warnings.some((entry) => entry.includes('timeout for article 1'))).toBe(true);
    expect(persisted).toEqual([2]);
    expect(result).toMatchObject({
      endingReason: 'completed',
      successfulArticleIds: [2],
      failedArticles: [{ articleId: 1, reason: 'timeout' }],
      maximumConsecutiveFailures: 1,
      circuitBreakerTripped: false
    });
  });

  it('classifies analysis and persistence errors and deterministic skips', async () => {
    const result = await processStateAssignmentsWithTimeout({
      articles: [
        { id: 10, title: '', content: '' },
        { id: 11, title: 'analysis', content: 'content' },
        { id: 12, title: 'persistence', content: 'content' },
        { id: 13, title: 'success', content: 'content' }
      ],
      prompt: { id: 7, content: 'test prompt' },
      entityWhoCategorizesId: 11,
      aiConfig: openAiConfig,
      stateAssignerDirectories,
      iterationTimeoutMs: 100,
      signal: new AbortController().signal,
      registerCancelableProcess: jest.fn(),
      analyzeArticle: async (_config, _dirs, _prompt, article) => {
        if (article.id === 11) {
          throw new Error('analysis failed');
        }
        return { occuredInTheUS: true, reasoning: 'ok', state: 'CA' };
      },
      persistAssignment: async (articleId) => {
        if (articleId === 12) {
          throw new Error('persistence failed');
        }
      },
      log: silentLog
    });

    expect(result.successfulArticleIds).toEqual([13]);
    expect(result.skippedArticles).toEqual([{ articleId: 10, reason: 'no_usable_content' }]);
    expect(result.failedArticles).toEqual([
      { articleId: 11, reason: 'analysis_error' },
      { articleId: 12, reason: 'persistence_error' }
    ]);
    expect(result.selectedCount).toBe(4);
    expect(result.attemptedCount).toBe(3);
  });

  it('trips after five consecutive mixed failures and leaves the remainder unattempted', async () => {
    const result = await processStateAssignmentsWithTimeout({
      articles: [1, 2, 3, 4, 5, 6].map((id) => ({ id, title: `article ${id}`, content: 'content' })),
      prompt: { id: 7, content: 'test prompt' },
      entityWhoCategorizesId: 11,
      aiConfig: openAiConfig,
      stateAssignerDirectories,
      iterationTimeoutMs: 5,
      signal: new AbortController().signal,
      registerCancelableProcess: jest.fn(),
      analyzeArticle: async (_config, _dirs, _prompt, article, signal) => {
        if (article.id === 3) {
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
          });
        }
        if (article.id === 1 || article.id === 4) {
          throw new Error('analysis failed');
        }
        return { occuredInTheUS: true, reasoning: 'ok', state: 'CA' };
      },
      persistAssignment: async (articleId) => {
        if (articleId === 2 || articleId === 5) {
          throw new Error('persistence failed');
        }
      },
      log: silentLog
    });

    expect(result).toMatchObject({
      endingReason: 'circuit_breaker',
      attemptedArticleIds: [1, 2, 3, 4, 5],
      unattemptedArticleIds: [6],
      maximumConsecutiveFailures: 5,
      circuitBreakerTripped: true,
      failedCount: 5
    });
    expect(result.failedArticles.map(({ reason }) => reason)).toEqual([
      'analysis_error',
      'persistence_error',
      'timeout',
      'analysis_error',
      'persistence_error'
    ]);
  });

  it('resets consecutive failures only after a persisted success', async () => {
    const result = await processStateAssignmentsWithTimeout({
      articles: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((id) => ({ id, title: `article ${id}`, content: 'content' })),
      prompt: { id: 7, content: 'test prompt' },
      entityWhoCategorizesId: 11,
      aiConfig: openAiConfig,
      stateAssignerDirectories,
      iterationTimeoutMs: 100,
      signal: new AbortController().signal,
      registerCancelableProcess: jest.fn(),
      analyzeArticle: async (_config, _dirs, _prompt, article) => {
        if (article.id !== 5) {
          throw new Error('isolated around success');
        }
        return { occuredInTheUS: true, reasoning: 'ok', state: 'CA' };
      },
      persistAssignment: async () => undefined,
      log: silentLog
    });

    expect(result.endingReason).toBe('completed');
    expect(result.successfulArticleIds).toEqual([5]);
    expect(result.failedCount).toBe(8);
    expect(result.maximumConsecutiveFailures).toBe(4);
    expect(result.circuitBreakerTripped).toBe(false);
  });

  it('does not count operator cancellation as an article failure', async () => {
    const controller = new AbortController();
    const result = await processStateAssignmentsWithTimeout({
      articles: [
        { id: 20, title: 'one', content: 'content' },
        { id: 21, title: 'two', content: 'content' }
      ],
      prompt: { id: 7, content: 'test prompt' },
      entityWhoCategorizesId: 11,
      aiConfig: openAiConfig,
      stateAssignerDirectories,
      iterationTimeoutMs: 100,
      signal: controller.signal,
      registerCancelableProcess: jest.fn(),
      analyzeArticle: async () => {
        controller.abort();
        throw new DOMException('aborted', 'AbortError');
      },
      persistAssignment: async () => undefined,
      log: silentLog
    });

    expect(result).toMatchObject({
      endingReason: 'canceled',
      skippedArticles: [{ articleId: 20, reason: 'operator_canceled' }],
      unattemptedArticleIds: [21],
      failedCount: 0,
      maximumConsecutiveFailures: 0,
      circuitBreakerTripped: false
    });
  });

  it('uses the OpenAI analyzer and default timeout for the openai backend', async () => {
    const { analyzeWithOpenAi, capturedOptions, registerCancelableProcess, updateResult } =
      await runWorkflowWithConfig(openAiConfig);

    expect(capturedOptions.analyzeArticle).toBe(analyzeWithOpenAi);
    expect(capturedOptions.iterationTimeoutMs).toBe(10_000);
    expect(capturedOptions.registerCancelableProcess).toBe(registerCancelableProcess);
    expect(capturedOptions.aiConfig).toBe(openAiConfig);
    expect(capturedOptions.articles).toEqual([
      { id: 1, title: 'test title', content: 'test description' }
    ]);
    expect(updateResult).toHaveBeenCalledWith(expect.objectContaining({
      schemaVersion: 1,
      successfulArticleIds: [1]
    }));
  });

  it('uses the Codex analyzer and configured timeout for the codex backend', async () => {
    const { analyzeWithCodexCli, capturedOptions, registerCancelableProcess } =
      await runWorkflowWithConfig(codexConfig);

    expect(capturedOptions.analyzeArticle).toBe(analyzeWithCodexCli);
    expect(capturedOptions.iterationTimeoutMs).toBe(codexConfig.codexTimeoutMs);
    expect(capturedOptions.registerCancelableProcess).toBe(registerCancelableProcess);
    expect(capturedOptions.aiConfig).toBe(codexConfig);
  });

  it('preserves exact-ID targeting through bounded pre-scrape enrichment', async () => {
    const { selectArticles, enrichContent02, selectedArticle } = await runWorkflowWithConfig(
      openAiConfig,
      {
        articleIds: [101, 202],
        targetArticleStateReviewCount: 250,
        articleIdMinExclusive: 100,
        articleIdMaxInclusive: 300
      }
    );

    expect(selectArticles).toHaveBeenCalledWith(expect.objectContaining({
      articleIds: [101, 202],
      targetArticleStateReviewCount: 250,
      articleIdMinExclusive: 100,
      articleIdMaxInclusive: 300
    }));
    expect(enrichContent02).toHaveBeenCalledWith({
      articles: [selectedArticle],
      signal: expect.any(Object)
    });
  });
});
