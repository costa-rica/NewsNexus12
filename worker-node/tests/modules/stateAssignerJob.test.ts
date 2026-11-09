import {
  createStateAssignerJobHandler,
  processStateAssignmentsWithTimeout,
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

const completedResult: StateAssignerJobResult = {
  selectedCount: 1,
  completedCount: 1,
  skippedCount: 0,
  failedCount: 0,
  targetArticleThresholdDaysOld: 15,
  targetArticleStateReviewCount: 25
};

const createQueueContext = (
  registerCancelableProcess = jest.fn(),
  updateResult = jest.fn(async () => undefined),
  signal: AbortSignal = new AbortController().signal
): QueueExecutionContext => ({
  jobId: 'job-1',
  endpointName: '/state-assigner/start-job',
  signal,
  registerCancelableProcess,
  updateResult
});

const createAnalyzer = (): jest.MockedFunction<AnalyzeArticle> =>
  jest.fn<ReturnType<AnalyzeArticle>, Parameters<AnalyzeArticle>>(
    async () => ({ occuredInTheUS: true, reasoning: 'ok', state: 'CA' })
  );

const runWorkflowWithConfig = async (aiConfig: StateAssignerAiConfig) => {
  const analyzeWithOpenAi = createAnalyzer();
  const analyzeWithCodexCli = createAnalyzer();
  const processAssignments = jest.fn<
    Promise<{ completedCount: number; skippedCount: number; failedCount: number }>,
    [ProcessStateAssignmentsOptions]
  >(
    async () => ({ completedCount: 1, skippedCount: 0, failedCount: 0 })
  );
  const registerCancelableProcess = jest.fn();

  const handler = createStateAssignerJobHandler(
    {
      targetArticleThresholdDaysOld: 15,
      targetArticleStateReviewCount: 25,
      aiConfig,
      pathToStateAssignerFiles: '/tmp/state-assigner-files'
    },
    {
      ensureDb: async () => undefined,
      ensureDirectories: async () => stateAssignerDirectories,
      syncPrompts: async () => undefined,
      resolveEntityWhoCategorizes: async () => 11,
      loadPrompt: async () => ({ id: 7, content: 'test prompt' }),
      selectArticles: async () => [
        {
          id: 1,
          title: 'test title',
          description: 'test description',
          url: 'https://example.com/article',
          publishedDate: '2026-07-10'
        }
      ],
      enrichContent02: async () => emptyContent02Summary,
      getCanonicalContent02Row: async () => null,
      analyzeWithOpenAi,
      analyzeWithCodexCli,
      processAssignments
    }
  );

  await handler(createQueueContext(registerCancelableProcess));

  return {
    analyzeWithOpenAi,
    analyzeWithCodexCli,
    processAssignments,
    registerCancelableProcess,
    capturedOptions: processAssignments.mock.calls[0][0]
  };
};

describe('stateAssigner job handler', () => {
  it('passes request parameters to legacy workflow dependency', async () => {
    const runLegacyWorkflow = jest.fn(async () => completedResult);
    const registerCancelableProcess = jest.fn();
    const updateResult = jest.fn(async () => undefined);

    const handler = createStateAssignerJobHandler(
      {
        targetArticleThresholdDaysOld: 15,
        targetArticleStateReviewCount: 25,
        aiConfig: openAiConfig,
        pathToStateAssignerFiles: '/tmp/state-assigner-files'
      },
      { runLegacyWorkflow }
    );

    await handler(createQueueContext(registerCancelableProcess, updateResult));

    expect(runLegacyWorkflow).toHaveBeenCalledWith({
      jobId: 'job-1',
      signal: expect.any(Object),
      registerCancelableProcess,
      targetArticleThresholdDaysOld: 15,
      targetArticleStateReviewCount: 25,
      aiConfig: openAiConfig,
      pathToStateAssignerFiles: '/tmp/state-assigner-files'
    });
    expect(updateResult).toHaveBeenCalledWith(completedResult);
  });

  it('times out one iteration, logs it, and continues processing next article', async () => {
    const warnings: string[] = [];
    const persisted: number[] = [];
    const registerCancelableProcess = jest.fn();

    const counts = await processStateAssignmentsWithTimeout({
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
    expect(counts).toEqual({ completedCount: 1, skippedCount: 1, failedCount: 0 });
  });

  it('counts abort-like persistence errors as failures when the queue signal is active', async () => {
    const persisted: number[] = [];
    const counts = await processStateAssignmentsWithTimeout({
      articles: [
        { id: 1, title: 'a', content: 'c1' },
        { id: 2, title: 'b', content: 'c2' }
      ],
      prompt: { id: 7, content: 'test prompt' },
      entityWhoCategorizesId: 11,
      aiConfig: openAiConfig,
      stateAssignerDirectories,
      iterationTimeoutMs: 100,
      signal: new AbortController().signal,
      registerCancelableProcess: jest.fn(),
      analyzeArticle: createAnalyzer(),
      persistAssignment: async (articleId) => {
        if (articleId === 1) throw new Error('current transaction is aborted');
        persisted.push(articleId);
      },
      log: { info: () => undefined, warn: () => undefined, error: () => undefined }
    });

    expect(persisted).toEqual([2]);
    expect(counts).toEqual({ completedCount: 1, skippedCount: 0, failedCount: 1 });
  });

  it('returns partial counters when the queue signal is canceled', async () => {
    const controller = new AbortController();
    controller.abort();

    const counts = await processStateAssignmentsWithTimeout({
      articles: [{ id: 1, title: 'a', content: 'c1' }],
      prompt: { id: 7, content: 'test prompt' },
      entityWhoCategorizesId: 11,
      aiConfig: openAiConfig,
      stateAssignerDirectories,
      iterationTimeoutMs: 100,
      signal: controller.signal,
      registerCancelableProcess: jest.fn(),
      analyzeArticle: createAnalyzer(),
      persistAssignment: async () => undefined,
      log: { info: () => undefined, warn: () => undefined, error: () => undefined }
    });

    expect(counts).toEqual({ completedCount: 0, skippedCount: 0, failedCount: 0 });
  });

  describe('stopping after repeated failures', () => {
    type Step = 'success' | 'codex_failure' | 'invalid_response' | 'timeout';

    const runSteps = (steps: Step[]) => {
      const persisted: number[] = [];
      const errors: string[] = [];
      const articles = steps.map((_step, index) => ({
        id: index + 1,
        title: `title ${index + 1}`,
        content: `content ${index + 1}`
      }));

      const promise = processStateAssignmentsWithTimeout({
        articles,
        prompt: { id: 7, content: 'test prompt' },
        entityWhoCategorizesId: 11,
        aiConfig: codexConfig,
        stateAssignerDirectories,
        iterationTimeoutMs: 10,
        signal: new AbortController().signal,
        registerCancelableProcess: jest.fn(),
        analyzeArticle: async (_aiConfig, _dirs, _prompt, article, signal) => {
          const step = steps[article.id - 1];
          if (step === 'codex_failure') {
            throw new Error(`codex exec exited with code 1 for article ${article.id}`);
          }
          if (step === 'invalid_response') {
            throw new Error(
              `codex exec output is not valid state assigner JSON for article ${article.id}`
            );
          }
          if (step === 'timeout') {
            await new Promise<void>((_resolve, reject) => {
              signal.addEventListener(
                'abort',
                () => reject(new DOMException('The operation was aborted.', 'AbortError')),
                { once: true }
              );
            });
          }
          return { occuredInTheUS: true, reasoning: 'ok', state: 'CA' };
        },
        persistAssignment: async (articleId) => {
          persisted.push(articleId);
        },
        log: {
          info: () => undefined,
          warn: () => undefined,
          error: (message: string) => {
            errors.push(message);
          }
        }
      });

      return { promise, persisted, errors };
    };

    it('throws after three failures with no success, including counts and IDs', async () => {
      const { promise, errors } = runSteps([
        'codex_failure',
        'codex_failure',
        'codex_failure',
        'success'
      ]);

      await expect(promise).rejects.toThrow(
        'State assigner stopped after 3 article failures since the last success ' +
          '(completed 0, skipped 0, failed 3); last article 3, prompt 7: ' +
          'codex exec exited with code 1 for article 3'
      );
      expect(errors).toContain(
        'Failed to process article 1 with prompt 7: codex exec exited with code 1 for article 1'
      );
    });

    it('resets the failure count after a success', async () => {
      const { promise, persisted } = runSteps([
        'codex_failure',
        'codex_failure',
        'success',
        'codex_failure',
        'codex_failure'
      ]);

      await expect(promise).resolves.toEqual({
        completedCount: 1,
        skippedCount: 0,
        failedCount: 4
      });
      expect(persisted).toEqual([3]);
    });

    it('counts Codex failures and invalid responses together', async () => {
      const { promise } = runSteps([
        'codex_failure',
        'invalid_response',
        'codex_failure',
        'success'
      ]);

      await expect(promise).rejects.toThrow('last article 3, prompt 7');
    });

    it('does not count timeouts as failures', async () => {
      const { promise } = runSteps(['codex_failure', 'timeout', 'codex_failure', 'timeout']);

      await expect(promise).resolves.toEqual({
        completedCount: 0,
        skippedCount: 2,
        failedCount: 2
      });
    });
  });

  it('saves a valid zero-work result', async () => {
    const updateResult = jest.fn(async () => undefined);
    const handler = createStateAssignerJobHandler(
      {
        targetArticleThresholdDaysOld: 15,
        targetArticleStateReviewCount: 25,
        aiConfig: openAiConfig,
        pathToStateAssignerFiles: '/tmp/state-assigner-files'
      },
      {
        ensureDb: async () => undefined,
        ensureDirectories: async () => stateAssignerDirectories,
        syncPrompts: async () => undefined,
        resolveEntityWhoCategorizes: async () => 11,
        loadPrompt: async () => ({ id: 7, content: 'test prompt' }),
        selectArticles: async () => []
      }
    );

    await handler(createQueueContext(jest.fn(), updateResult));

    expect(updateResult).toHaveBeenCalledWith({
      selectedCount: 0,
      completedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      targetArticleThresholdDaysOld: 15,
      targetArticleStateReviewCount: 25
    });
  });

  it('continues assignment after an abort-like enrichment error', async () => {
    const updateResult = jest.fn(async () => undefined);
    const handler = createStateAssignerJobHandler(
      {
        targetArticleThresholdDaysOld: 15,
        targetArticleStateReviewCount: 25,
        aiConfig: openAiConfig,
        pathToStateAssignerFiles: '/tmp/state-assigner-files'
      },
      {
        ensureDb: async () => undefined,
        ensureDirectories: async () => stateAssignerDirectories,
        syncPrompts: async () => undefined,
        resolveEntityWhoCategorizes: async () => 11,
        loadPrompt: async () => ({ id: 7, content: 'test prompt' }),
        selectArticles: async () => [
          {
            id: 1,
            title: 'test',
            description: 'description',
            url: null,
            publishedDate: '2026-07-10'
          }
        ],
        enrichContent02: async () => {
          throw new Error('navigation aborted unexpectedly');
        },
        getCanonicalContent02Row: async () => null,
        analyzeWithOpenAi: createAnalyzer(),
        processAssignments: async () => ({
          completedCount: 1,
          skippedCount: 0,
          failedCount: 0
        })
      }
    );

    await handler(createQueueContext(jest.fn(), updateResult));

    expect(updateResult).toHaveBeenCalledWith(completedResult);
  });

  it('does not save a completed result after a fatal setup failure', async () => {
    const updateResult = jest.fn(async () => undefined);
    const handler = createStateAssignerJobHandler(
      {
        targetArticleThresholdDaysOld: 15,
        targetArticleStateReviewCount: 25,
        aiConfig: openAiConfig,
        pathToStateAssignerFiles: '/tmp/state-assigner-files'
      },
      { ensureDb: async () => { throw new Error('database unavailable'); } }
    );

    await expect(handler(createQueueContext(jest.fn(), updateResult))).rejects.toThrow(
      'database unavailable'
    );
    expect(updateResult).not.toHaveBeenCalled();
  });

  it('uses the OpenAI analyzer and default timeout for the openai backend', async () => {
    const { analyzeWithOpenAi, capturedOptions, registerCancelableProcess } =
      await runWorkflowWithConfig(openAiConfig);

    expect(capturedOptions.analyzeArticle).toBe(analyzeWithOpenAi);
    expect(capturedOptions.iterationTimeoutMs).toBe(10_000);
    expect(capturedOptions.registerCancelableProcess).toBe(registerCancelableProcess);
    expect(capturedOptions.aiConfig).toBe(openAiConfig);
    expect(capturedOptions.articles).toEqual([
      { id: 1, title: 'test title', content: 'test description' }
    ]);
  });

  it('uses the Codex analyzer and configured timeout for the codex backend', async () => {
    const { analyzeWithCodexCli, capturedOptions, registerCancelableProcess } =
      await runWorkflowWithConfig(codexConfig);

    expect(capturedOptions.analyzeArticle).toBe(analyzeWithCodexCli);
    expect(capturedOptions.iterationTimeoutMs).toBe(codexConfig.codexTimeoutMs);
    expect(capturedOptions.registerCancelableProcess).toBe(registerCancelableProcess);
    expect(capturedOptions.aiConfig).toBe(codexConfig);
  });
});
