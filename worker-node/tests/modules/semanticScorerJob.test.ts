import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createSemanticScorerJobHandler,
  processArticlesWithTimeout,
  SemanticScorerJobResult
} from '../../src/modules/jobs/semanticScorerJob';

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
