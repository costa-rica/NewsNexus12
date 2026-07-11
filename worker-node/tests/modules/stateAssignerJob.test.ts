import {
  createStateAssignerJobHandler,
  processStateAssignmentsWithTimeout
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
  registerCancelableProcess = jest.fn()
): QueueExecutionContext => ({
  jobId: 'job-1',
  endpointName: '/state-assigner/start-job',
  signal: new AbortController().signal,
  registerCancelableProcess,
  updateResult: () => Promise.resolve()
});

const createAnalyzer = (): jest.MockedFunction<AnalyzeArticle> =>
  jest.fn<ReturnType<AnalyzeArticle>, Parameters<AnalyzeArticle>>(
    async () => ({ occuredInTheUS: true, reasoning: 'ok', state: 'CA' })
  );

const runWorkflowWithConfig = async (aiConfig: StateAssignerAiConfig) => {
  const analyzeWithOpenAi = createAnalyzer();
  const analyzeWithCodexCli = createAnalyzer();
  const processAssignments = jest.fn<Promise<void>, [ProcessStateAssignmentsOptions]>(
    async () => undefined
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
    const runLegacyWorkflow = jest.fn(async () => undefined);
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

  it('times out one iteration, logs it, and continues processing next article', async () => {
    const warnings: string[] = [];
    const persisted: number[] = [];
    const registerCancelableProcess = jest.fn();

    await processStateAssignmentsWithTimeout({
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
