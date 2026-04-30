import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createSemanticScorerJobHandler,
  processArticlesWithTimeout
} from '../../src/modules/jobs/semanticScorerJob';

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

    await processArticlesWithTimeout({
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
  });
});
