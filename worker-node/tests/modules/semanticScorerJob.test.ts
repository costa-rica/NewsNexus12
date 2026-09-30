import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createSemanticScorerJobHandler,
  initializeSemanticScorerModel,
  processArticlesWithTimeout,
  SemanticScorerJobResult
} from '../../src/modules/jobs/semanticScorerJob';
import { createSemanticScorerDiagnostics } from '../../src/modules/jobs/semanticScorerDiagnostics';

const silentLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

const completedResult = (): SemanticScorerJobResult => ({
  schemaVersion: 1,
  endingReason: 'completed',
  terminalMessage: 'Semantic scorer completed all selected articles.',
  selectedArticleIds: [],
  scoredArticleIds: [],
  skippedArticles: [],
  failedArticles: [],
  unattemptedArticleIds: [],
  selectedCount: 0,
  attemptedCount: 0,
  successfulCount: 0,
  skippedCount: 0,
  failedCount: 0,
  unattemptedCount: 0
});

describe('semanticScorer job handler', () => {
  it('fails when keywords workbook file is missing', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'semantic-scorer-job-'));
    const handler = createSemanticScorerJobHandler(tempDir);

    await expect(
      handler({
        jobId: 'job-1',
        endpointName: '/semantic-scorer/start-job',
        signal: new AbortController().signal,
        registerCancelableProcess: () => undefined,
        updateResult: () => Promise.resolve()
      })
    ).rejects.toThrow('Semantic scorer keywords workbook not found');

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('times out one iteration, logs it, and continues processing later iterations', async () => {
    const warnings: string[] = [];
    const persisted: number[] = [];

    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

    const result = await processArticlesWithTimeout({
      articles: [
        { id: 1, title: 'a', description: 'd1' },
        { id: 2, title: 'b', description: 'd2' }
      ],
      keywords: ['fire'],
      iterationTimeoutMs: 10,
      signal: new AbortController().signal,
      scoreArticle: async (article) => {
        if (article.id === 1) {
          await sleep(30);
          return { keyword: 'fire', keywordRating: 1 };
        }

        return { keyword: 'fire', keywordRating: 0.8 };
      },
      persistScore: async (articleId) => {
        persisted.push(articleId);
      },
      progressEvery: 1,
      writeRunningStatus: async () => undefined,
      writeCompletedStatus: async () => undefined,
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
      selectedArticleIds: [1, 2],
      scoredArticleIds: [2],
      failedArticles: [{ articleId: 1, reason: 'timeout' }],
      selectedCount: 2,
      attemptedCount: 2,
      successfulCount: 1,
      failedCount: 1,
      unattemptedCount: 0
    });
  });

  it('classifies skips, scoring errors, persistence errors, and successes independently', async () => {
    const result = await processArticlesWithTimeout({
      articles: [
        { id: 10, title: null, description: ' ' },
        { id: 11, title: 'score error', description: null },
        { id: 12, title: 'persist error', description: null },
        { id: 13, title: 'success', description: null },
        { id: 14, title: 'no result', description: null }
      ],
      keywords: ['fire'],
      iterationTimeoutMs: 100,
      signal: new AbortController().signal,
      scoreArticle: async (article) => {
        if (article.id === 11) {
          throw new Error('scoring failed');
        }
        if (article.id === 14) {
          return { keyword: null, keywordRating: null };
        }
        return { keyword: 'fire', keywordRating: 0.9 };
      },
      persistScore: async (articleId) => {
        if (articleId === 12) {
          throw new Error('persistence failed');
        }
      },
      progressEvery: 100,
      writeRunningStatus: async () => undefined,
      writeCompletedStatus: async () => undefined,
      log: silentLog
    });

    expect(result.scoredArticleIds).toEqual([13]);
    expect(result.skippedArticles).toEqual([
      { articleId: 10, reason: 'no_usable_text' },
      { articleId: 14, reason: 'no_score_result' }
    ]);
    expect(result.failedArticles).toEqual([
      { articleId: 11, reason: 'scoring_error' },
      { articleId: 12, reason: 'persistence_error' }
    ]);
    expect(result.attemptedCount).toBe(5);
    expect(result.selectedCount).toBe(5);
  });

  it('returns selected articles as unattempted after cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const writeCompletedStatus = jest.fn();

    const result = await processArticlesWithTimeout({
      articles: [
        { id: 20, title: 'one', description: null },
        { id: 21, title: 'two', description: null }
      ],
      keywords: ['fire'],
      iterationTimeoutMs: 100,
      signal: controller.signal,
      scoreArticle: async () => ({ keyword: 'fire', keywordRating: 1 }),
      persistScore: async () => undefined,
      progressEvery: 100,
      writeRunningStatus: async () => undefined,
      writeCompletedStatus,
      log: silentLog
    });

    expect(result).toMatchObject({
      endingReason: 'canceled',
      selectedArticleIds: [20, 21],
      unattemptedArticleIds: [20, 21],
      attemptedCount: 0,
      unattemptedCount: 2
    });
    expect(writeCompletedStatus).not.toHaveBeenCalled();
  });

  it('calls the first-attempt hook once immediately before the first usable article is scored', async () => {
    const order: string[] = [];

    await processArticlesWithTimeout({
      articles: [
        { id: 1, title: null, description: ' ' },
        { id: 2, title: 'usable', description: null },
        { id: 3, title: 'also usable', description: null }
      ],
      keywords: ['fire'],
      iterationTimeoutMs: 100,
      signal: new AbortController().signal,
      onFirstArticleAttempt: () => order.push('first-attempt'),
      scoreArticle: async (article) => {
        order.push(`score-${article.id}`);
        return { keyword: null, keywordRating: null };
      },
      persistScore: async () => undefined,
      progressEvery: 100,
      writeRunningStatus: async () => undefined,
      writeCompletedStatus: async () => undefined,
      log: silentLog
    });

    expect(order).toEqual(['first-attempt', 'score-2', 'score-3']);
  });

  it('does not call the first-attempt hook when every selected article has no usable text', async () => {
    const onFirstArticleAttempt = jest.fn();

    await processArticlesWithTimeout({
      articles: [{ id: 1, title: null, description: ' ' }],
      keywords: ['fire'],
      iterationTimeoutMs: 100,
      signal: new AbortController().signal,
      onFirstArticleAttempt,
      scoreArticle: async () => ({ keyword: null, keywordRating: null }),
      persistScore: async () => undefined,
      progressEvery: 100,
      writeRunningStatus: async () => undefined,
      writeCompletedStatus: async () => undefined,
      log: silentLog
    });

    expect(onFirstArticleAttempt).not.toHaveBeenCalled();
  });

  it('continues scoring when the first-attempt hook throws', async () => {
    const scoreArticle = jest.fn(async () => ({ keyword: null, keywordRating: null }));

    const result = await processArticlesWithTimeout({
      articles: [{ id: 1, title: 'usable', description: null }],
      keywords: ['fire'],
      iterationTimeoutMs: 100,
      signal: new AbortController().signal,
      onFirstArticleAttempt: () => { throw new Error('hook failure'); },
      scoreArticle,
      persistScore: async () => undefined,
      progressEvery: 100,
      writeRunningStatus: async () => undefined,
      writeCompletedStatus: async () => undefined,
      log: silentLog
    });

    expect(scoreArticle).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      endingReason: 'completed',
      skippedArticles: [{ articleId: 1, reason: 'no_score_result' }],
      failedArticles: []
    });
  });

  it.each([
    ['completed', 'job_completed'],
    ['canceled', 'job_canceled']
  ] as const)('emits correlated job lifecycle events for a %s result', async (endingReason, terminalEvent) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'semantic-scorer-lifecycle-'));
    await fs.writeFile(path.join(tempDir, 'NewsNexusSemanticScorerKeywords.xlsx'), 'stub', 'utf8');
    const boundary = jest.fn();
    const stop = jest.fn();
    const createDiagnostics = jest.fn(() => ({ boundary, stop }));
    const result = { ...completedResult(), endingReason } as SemanticScorerJobResult;
    const handler = createSemanticScorerJobHandler(tempDir, undefined, {
      diagnosticsEnabled: true,
      createDiagnostics,
      runLegacyWorkflow: async (context) => {
        context.diagnostics.boundary('selection_completed', { candidateCount: 0, keywordCount: 2 });
        context.diagnostics.boundary('model_initialization_started');
        context.diagnostics.boundary('model_initialization_completed', { durationMs: 5 });
        context.diagnostics.boundary('first_article_attempt_started');
        return result;
      }
    });

    await handler({
      jobId: 'job-lifecycle',
      endpointName: '/semantic-scorer/start-job',
      signal: new AbortController().signal,
      registerCancelableProcess: () => undefined,
      updateResult: () => Promise.resolve()
    });

    expect(createDiagnostics).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
      queueJobId: 'job-lifecycle'
    }));
    expect(createDiagnostics).toHaveBeenCalledTimes(1);
    expect(boundary.mock.calls.map(([event]) => event)).toEqual([
      'job_started',
      'selection_completed',
      'model_initialization_started',
      'model_initialization_completed',
      'first_article_attempt_started',
      terminalEvent
    ]);
    expect(stop).toHaveBeenCalledTimes(1);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('emits only job_canceled when cancellation races with successful result persistence', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'semantic-scorer-cancel-persistence-'));
    await fs.writeFile(path.join(tempDir, 'NewsNexusSemanticScorerKeywords.xlsx'), 'stub', 'utf8');
    const controller = new AbortController();
    const boundary = jest.fn();
    const stop = jest.fn();
    const result = completedResult();
    const updateResult = jest.fn(async () => {
      controller.abort();
    });
    const handler = createSemanticScorerJobHandler(tempDir, undefined, {
      diagnosticsEnabled: true,
      createDiagnostics: () => ({ boundary, stop }),
      runLegacyWorkflow: async () => result
    });

    await expect(handler({
      jobId: 'job-canceled-during-result-persistence',
      endpointName: '/semantic-scorer/start-job',
      signal: controller.signal,
      registerCancelableProcess: () => undefined,
      updateResult
    })).resolves.toBeUndefined();

    const terminalEvents = boundary.mock.calls
      .map(([event]) => event)
      .filter((event) => ['job_completed', 'job_canceled', 'job_failed'].includes(event));
    expect(terminalEvents).toEqual(['job_canceled']);
    expect(updateResult).toHaveBeenCalledTimes(1);
    expect(updateResult).toHaveBeenCalledWith(result);
    expect(stop).toHaveBeenCalledTimes(1);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('defers a rejected workflow terminal event until fallback persistence resolves', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'semantic-scorer-fallback-cancel-'));
    await fs.writeFile(path.join(tempDir, 'NewsNexusSemanticScorerKeywords.xlsx'), 'stub', 'utf8');
    const controller = new AbortController();
    const boundary = jest.fn();
    const stop = jest.fn();
    const workflowError = new Error('workflow failed before fallback persistence');
    const updateResult = jest.fn(async () => {
      controller.abort();
    });
    const handler = createSemanticScorerJobHandler(tempDir, undefined, {
      diagnosticsEnabled: true,
      createDiagnostics: () => ({ boundary, stop }),
      runLegacyWorkflow: async () => { throw workflowError; }
    });

    expect(controller.signal.aborted).toBe(false);
    await expect(handler({
      jobId: 'job-canceled-during-fallback-persistence',
      endpointName: '/semantic-scorer/start-job',
      signal: controller.signal,
      registerCancelableProcess: () => undefined,
      updateResult
    })).rejects.toBe(workflowError);

    const terminalEvents = boundary.mock.calls
      .map(([event]) => event)
      .filter((event) => ['job_completed', 'job_canceled', 'job_failed'].includes(event));
    expect(terminalEvents).toEqual(['job_canceled']);
    expect(updateResult).toHaveBeenCalledTimes(1);
    expect(updateResult).toHaveBeenCalledWith(expect.objectContaining({
      endingReason: 'error',
      terminalMessage: workflowError.message
    }));
    expect(stop).toHaveBeenCalledTimes(1);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('propagates a rejected fallback persistence error after cancellation without duplicating the terminal event', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'semantic-scorer-fallback-reject-cancel-'));
    await fs.writeFile(path.join(tempDir, 'NewsNexusSemanticScorerKeywords.xlsx'), 'stub', 'utf8');
    const controller = new AbortController();
    const boundary = jest.fn();
    const stop = jest.fn();
    const workflowError = new Error('workflow failed before rejected fallback persistence');
    const persistenceError = new Error('fallback result persistence failed');
    const updateResult = jest.fn(async () => {
      controller.abort();
      throw persistenceError;
    });
    const handler = createSemanticScorerJobHandler(tempDir, undefined, {
      diagnosticsEnabled: true,
      createDiagnostics: () => ({ boundary, stop }),
      runLegacyWorkflow: async () => { throw workflowError; }
    });

    expect(controller.signal.aborted).toBe(false);
    await expect(handler({
      jobId: 'job-canceled-during-rejected-fallback-persistence',
      endpointName: '/semantic-scorer/start-job',
      signal: controller.signal,
      registerCancelableProcess: () => undefined,
      updateResult
    })).rejects.toBe(persistenceError);

    const terminalEvents = boundary.mock.calls
      .map(([event]) => event)
      .filter((event) => ['job_completed', 'job_canceled', 'job_failed'].includes(event));
    expect(terminalEvents).toEqual(['job_canceled']);
    expect(updateResult).toHaveBeenCalledTimes(1);
    expect(updateResult).toHaveBeenCalledWith(expect.objectContaining({
      endingReason: 'error',
      terminalMessage: workflowError.message
    }));
    expect(stop).toHaveBeenCalledTimes(1);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it.each([
    'workflow',
    'result persistence'
  ] as const)('emits only job_canceled when an aborted job has a %s failure', async (failureSource) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'semantic-scorer-canceled-failure-'));
    await fs.writeFile(path.join(tempDir, 'NewsNexusSemanticScorerKeywords.xlsx'), 'stub', 'utf8');
    const controller = new AbortController();
    const boundary = jest.fn();
    const stop = jest.fn();
    const result = completedResult();
    const originalError = new Error(`${failureSource} failed`);
    const updateResult = failureSource === 'workflow'
      ? jest.fn().mockResolvedValue(undefined)
      : jest.fn()
          .mockImplementationOnce(async () => {
            controller.abort();
            throw originalError;
          })
          .mockResolvedValueOnce(undefined);
    const handler = createSemanticScorerJobHandler(tempDir, undefined, {
      diagnosticsEnabled: true,
      createDiagnostics: () => ({ boundary, stop }),
      runLegacyWorkflow: async () => {
        if (failureSource === 'workflow') {
          controller.abort();
          throw originalError;
        }
        return result;
      }
    });

    await expect(handler({
      jobId: `job-canceled-${failureSource.replace(' ', '-')}-failure`,
      endpointName: '/semantic-scorer/start-job',
      signal: controller.signal,
      registerCancelableProcess: () => undefined,
      updateResult
    })).rejects.toBe(originalError);

    const terminalEvents = boundary.mock.calls
      .map(([event]) => event)
      .filter((event) => ['job_completed', 'job_canceled', 'job_failed'].includes(event));
    expect(terminalEvents).toEqual(['job_canceled']);
    expect(updateResult).toHaveBeenCalledTimes(failureSource === 'workflow' ? 1 : 2);
    if (failureSource === 'result persistence') {
      expect(updateResult).toHaveBeenNthCalledWith(1, result);
    }
    expect(updateResult).toHaveBeenLastCalledWith(expect.objectContaining({
      endingReason: 'error',
      terminalMessage: originalError.message
    }));
    expect(stop).toHaveBeenCalledTimes(1);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it.each([
    'completed',
    'canceled'
  ] as const)('emits only job_failed when result persistence rejects after a %s workflow', async (endingReason) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'semantic-scorer-result-rejection-'));
    await fs.writeFile(path.join(tempDir, 'NewsNexusSemanticScorerKeywords.xlsx'), 'stub', 'utf8');
    const boundary = jest.fn();
    const stop = jest.fn();
    const persistenceError = new Error(`${endingReason} result persistence failed`);
    const failedResultPersistenceError = new Error('failed-result persistence also failed');
    const updateResult = jest.fn()
      .mockRejectedValueOnce(persistenceError)
      .mockRejectedValueOnce(failedResultPersistenceError);
    const handler = createSemanticScorerJobHandler(tempDir, undefined, {
      diagnosticsEnabled: true,
      createDiagnostics: () => ({ boundary, stop }),
      runLegacyWorkflow: async () => ({ ...completedResult(), endingReason })
    });

    await expect(handler({
      jobId: `job-${endingReason}-result-rejection`,
      endpointName: '/semantic-scorer/start-job',
      signal: new AbortController().signal,
      registerCancelableProcess: () => undefined,
      updateResult
    })).rejects.toBe(failedResultPersistenceError);

    const terminalEvents = boundary.mock.calls
      .map(([event]) => event)
      .filter((event) => ['job_completed', 'job_canceled', 'job_failed'].includes(event));
    expect(terminalEvents).toEqual(['job_failed']);
    expect(updateResult).toHaveBeenCalledTimes(2);
    expect(updateResult).toHaveBeenNthCalledWith(1, expect.objectContaining({ endingReason }));
    expect(updateResult).toHaveBeenNthCalledWith(2, expect.objectContaining({
      endingReason: 'error',
      terminalMessage: persistenceError.message
    }));
    expect(stop).toHaveBeenCalledTimes(1);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('starts diagnostics before preflight and emits failed plus cleanup when preflight fails', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'semantic-scorer-preflight-'));
    const boundary = jest.fn();
    const stop = jest.fn();
    const handler = createSemanticScorerJobHandler(tempDir, undefined, {
      diagnosticsEnabled: true,
      createDiagnostics: () => ({ boundary, stop })
    });

    await expect(handler({
      jobId: 'job-preflight',
      endpointName: '/semantic-scorer/start-job',
      signal: new AbortController().signal,
      registerCancelableProcess: () => undefined,
      updateResult: () => Promise.resolve()
    })).rejects.toThrow('keywords workbook not found');

    expect(boundary.mock.calls.map(([event]) => event)).toEqual(['job_started', 'job_failed']);
    expect(stop).toHaveBeenCalledTimes(1);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('does not let diagnostics failures replace the original workflow error', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'semantic-scorer-isolation-'));
    await fs.writeFile(path.join(tempDir, 'NewsNexusSemanticScorerKeywords.xlsx'), 'stub', 'utf8');
    const handler = createSemanticScorerJobHandler(tempDir, undefined, {
      diagnosticsEnabled: true,
      createDiagnostics: () => ({
        boundary: () => { throw new Error('diagnostics boundary failure'); },
        stop: () => { throw new Error('diagnostics cleanup failure'); }
      }),
      runLegacyWorkflow: async () => { throw new Error('original workflow failure'); }
    });

    await expect(handler({
      jobId: 'job-isolation',
      endpointName: '/semantic-scorer/start-job',
      signal: new AbortController().signal,
      registerCancelableProcess: () => undefined,
      updateResult: () => Promise.resolve()
    })).rejects.toThrow('original workflow failure');
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('does not let diagnostics failures alter a successful result', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'semantic-scorer-success-isolation-'));
    await fs.writeFile(path.join(tempDir, 'NewsNexusSemanticScorerKeywords.xlsx'), 'stub', 'utf8');
    const result = completedResult();
    const updateResult = jest.fn(() => Promise.resolve());
    const handler = createSemanticScorerJobHandler(tempDir, undefined, {
      diagnosticsEnabled: true,
      createDiagnostics: () => ({
        boundary: () => { throw new Error('diagnostics boundary failure'); },
        stop: () => { throw new Error('diagnostics cleanup failure'); }
      }),
      runLegacyWorkflow: async () => result
    });

    await expect(handler({
      jobId: 'job-success-isolation',
      endpointName: '/semantic-scorer/start-job',
      signal: new AbortController().signal,
      registerCancelableProcess: () => undefined,
      updateResult
    })).resolves.toBeUndefined();
    expect(updateResult).toHaveBeenCalledWith(result);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('keeps disabled diagnostics silent while preserving the workflow result', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'semantic-scorer-disabled-'));
    await fs.writeFile(path.join(tempDir, 'NewsNexusSemanticScorerKeywords.xlsx'), 'stub', 'utf8');
    const records: Record<string, unknown>[] = [];
    const result = completedResult();
    const updateResult = jest.fn(() => Promise.resolve());
    const createDiagnostics = jest.fn((options) => createSemanticScorerDiagnostics({
      ...options,
      logger: {
        info: (_message: string, metadata: Record<string, unknown>) => records.push(metadata)
      } as never
    }));
    const handler = createSemanticScorerJobHandler(tempDir, undefined, {
      createDiagnostics,
      runLegacyWorkflow: async () => result
    });

    await handler({
      jobId: 'job-disabled',
      endpointName: '/semantic-scorer/start-job',
      signal: new AbortController().signal,
      registerCancelableProcess: () => undefined,
      updateResult
    });

    expect(createDiagnostics).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(records).toEqual([]);
    expect(updateResult).toHaveBeenCalledWith(result);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('emits model initialization completion with monotonic duration', async () => {
    const boundary = jest.fn();
    const diagnostics = { boundary, stop: jest.fn() };
    const embedder = jest.fn(async () => ({ data: [] as number[] }));
    const times = [50, 82];

    await expect(initializeSemanticScorerModel(
      diagnostics,
      async () => embedder,
      () => times.shift() ?? 82
    )).resolves.toBe(embedder);

    expect(boundary.mock.calls).toEqual([
      ['model_initialization_started'],
      ['model_initialization_completed', { durationMs: 32 }]
    ]);
  });

  it('bounds model initialization failure metadata and preserves the original error', async () => {
    const originalError = Object.assign(new Error('model detail must not be logged'), {
      name: 'Unsafe Error Name with article text',
      code: 'unsafe code with spaces'
    });
    const boundary = jest.fn();
    const diagnostics = { boundary, stop: jest.fn() };
    const times = [100, 125];

    await expect(initializeSemanticScorerModel(
      diagnostics,
      async () => { throw originalError; },
      () => times.shift() ?? 125
    )).rejects.toBe(originalError);

    expect(boundary.mock.calls).toEqual([
      ['model_initialization_started'],
      ['model_initialization_failed', {
        durationMs: 25,
        errorName: 'UnknownError'
      }]
    ]);
  });

  it('includes an allowlisted operational code in model initialization failure metadata', async () => {
    const originalError = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
    const boundary = jest.fn();
    const diagnostics = { boundary, stop: jest.fn() };

    await expect(initializeSemanticScorerModel(
      diagnostics,
      async () => { throw originalError; },
      () => 100
    )).rejects.toBe(originalError);

    expect(boundary).toHaveBeenLastCalledWith('model_initialization_failed', {
      durationMs: 0,
      errorName: 'Error',
      errorCode: 'ECONNRESET'
    });
  });

  it('omits a credential-like regex-valid code from model initialization failure metadata', async () => {
    const originalError = Object.assign(new Error('must not leak code'), {
      code: 'DATABASE_PASSWORD'
    });
    const boundary = jest.fn();
    const diagnostics = { boundary, stop: jest.fn() };

    await expect(initializeSemanticScorerModel(
      diagnostics,
      async () => { throw originalError; },
      () => 100
    )).rejects.toBe(originalError);

    expect(boundary).toHaveBeenLastCalledWith('model_initialization_failed', {
      durationMs: 0,
      errorName: 'Error'
    });
  });

  it.each([
    ['zero-selected', []],
    ['all-skipped', [{ id: 41, title: null, description: ' ' }]]
  ] as const)('terminates %s work without fabricating a first-attempt event', async (_case, articles) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'semantic-scorer-no-attempt-'));
    await fs.writeFile(path.join(tempDir, 'NewsNexusSemanticScorerKeywords.xlsx'), 'stub', 'utf8');
    const boundary = jest.fn();
    const stop = jest.fn();
    const updateResult = jest.fn(() => Promise.resolve());
    const handler = createSemanticScorerJobHandler(tempDir, undefined, {
      diagnosticsEnabled: true,
      createDiagnostics: () => ({ boundary, stop }),
      runLegacyWorkflow: async (context) => processArticlesWithTimeout({
        articles: [...articles],
        keywords: ['fire'],
        iterationTimeoutMs: 100,
        signal: context.signal,
        onFirstArticleAttempt: () => context.diagnostics.boundary('first_article_attempt_started'),
        scoreArticle: async () => ({ keyword: null, keywordRating: null }),
        persistScore: async () => undefined,
        progressEvery: 100,
        writeRunningStatus: async () => undefined,
        writeCompletedStatus: async () => undefined,
        log: silentLog
      })
    });

    await handler({
      jobId: `job-${_case}`,
      endpointName: '/semantic-scorer/start-job',
      signal: new AbortController().signal,
      registerCancelableProcess: () => undefined,
      updateResult
    });

    expect(boundary.mock.calls.map(([event]) => event)).toEqual(['job_started', 'job_completed']);
    expect(updateResult).toHaveBeenCalledWith(expect.objectContaining({
      endingReason: 'completed',
      selectedCount: articles.length,
      skippedCount: articles.length
    }));
    expect(stop).toHaveBeenCalledTimes(1);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('persists a normal structured result through the queue context', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'semantic-scorer-result-'));
    await fs.writeFile(path.join(tempDir, 'NewsNexusSemanticScorerKeywords.xlsx'), 'stub', 'utf8');
    const updateResult = jest.fn(() => Promise.resolve());
    const result = completedResult();
    const handler = createSemanticScorerJobHandler(tempDir, undefined, {
      runLegacyWorkflow: jest.fn().mockResolvedValue(result)
    });

    await handler({
      jobId: 'job-result',
      endpointName: '/semantic-scorer/start-job',
      signal: new AbortController().signal,
      registerCancelableProcess: () => undefined,
      updateResult
    });

    expect(updateResult).toHaveBeenCalledWith(result);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('persists partial outcomes before propagating a stage-level failure', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'semantic-scorer-partial-'));
    await fs.writeFile(path.join(tempDir, 'NewsNexusSemanticScorerKeywords.xlsx'), 'stub', 'utf8');
    const updateResult = jest.fn(() => Promise.resolve());
    const handler = createSemanticScorerJobHandler(tempDir, undefined, {
      runLegacyWorkflow: async ({ signal }) => processArticlesWithTimeout({
        articles: [
          { id: 30, title: 'one', description: null },
          { id: 31, title: 'two', description: null }
        ],
        keywords: ['fire'],
        iterationTimeoutMs: 100,
        signal,
        scoreArticle: async () => ({ keyword: 'fire', keywordRating: 1 }),
        persistScore: async () => undefined,
        progressEvery: 1,
        writeRunningStatus: async () => {
          throw new Error('progress disk failure');
        },
        writeCompletedStatus: async () => undefined,
        log: silentLog
      })
    });

    await expect(handler({
      jobId: 'job-partial',
      endpointName: '/semantic-scorer/start-job',
      signal: new AbortController().signal,
      registerCancelableProcess: () => undefined,
      updateResult
    })).rejects.toThrow('progress disk failure');

    expect(updateResult).toHaveBeenCalledWith(expect.objectContaining({
      endingReason: 'error',
      scoredArticleIds: [30],
      unattemptedArticleIds: [31]
    }));
    await fs.rm(tempDir, { recursive: true, force: true });
  });
});
