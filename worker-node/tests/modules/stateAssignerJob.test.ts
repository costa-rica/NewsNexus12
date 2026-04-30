import {
  createStateAssignerJobHandler,
  processStateAssignmentsWithTimeout
} from '../../src/modules/jobs/stateAssignerJob';

describe('stateAssigner job handler', () => {
  it('passes request parameters to legacy workflow dependency', async () => {
    const runLegacyWorkflow = jest.fn(async () => undefined);

    const handler = createStateAssignerJobHandler(
      {
        targetArticleThresholdDaysOld: 15,
        targetArticleStateReviewCount: 25,
        keyOpenAi: 'test-key',
        pathToStateAssignerFiles: '/tmp/state-assigner-files'
      },
      { runLegacyWorkflow }
    );

    await handler({
      jobId: 'job-1',
      endpointName: '/state-assigner/start-job',
      signal: new AbortController().signal,
      registerCancelableProcess: () => undefined,
        updateResult: () => Promise.resolve()
    });

    expect(runLegacyWorkflow).toHaveBeenCalledWith({
      jobId: 'job-1',
      signal: expect.any(Object),
      targetArticleThresholdDaysOld: 15,
      targetArticleStateReviewCount: 25,
      keyOpenAi: 'test-key',
      pathToStateAssignerFiles: '/tmp/state-assigner-files'
    });
  });

  it('times out one iteration, logs it, and continues processing next article', async () => {
    const warnings: string[] = [];
    const persisted: number[] = [];

    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

    await processStateAssignmentsWithTimeout({
      articles: [
        { id: 1, title: 'a', content: 'c1' },
        { id: 2, title: 'b', content: 'c2' }
      ],
      prompt: { id: 7, content: 'test prompt' },
      entityWhoCategorizesId: 11,
      keyOpenAi: 'test-key',
      stateAssignerDirectories: {
        rootDir: '/tmp/state-assigner-files',
        chatGptResponsesDir: '/tmp/state-assigner-files/chatgpt_responses',
        promptsDir: '/tmp/state-assigner-files/prompts'
      },
      iterationTimeoutMs: 10,
      signal: new AbortController().signal,
      analyzeArticle: async (_key, _dirs, _prompt, article, signal) => {
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
});
