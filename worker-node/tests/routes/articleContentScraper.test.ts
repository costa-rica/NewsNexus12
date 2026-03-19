import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { errorHandler } from '../../src/modules/middleware/errorHandlers';
import { QueueJobStore } from '../../src/modules/queue/jobStore';
import { GlobalQueueEngine, QueueExecutionContext } from '../../src/modules/queue/queueEngine';
import { createArticleContentScraperRouter } from '../../src/routes/articleContentScraper';

const buildApp = (
  queueEngine: GlobalQueueEngine,
  buildJobHandler?: (input: {
    targetArticleThresholdDaysOld: number;
    targetArticleStateReviewCount: number;
    includeArticlesThatMightHaveBeenStateAssigned?: boolean;
  }) => (context: QueueExecutionContext) => Promise<void>
): express.Express => {
  const app = express();
  app.use(express.json());
  app.use(
    '/article-content-scraper',
    createArticleContentScraperRouter({
      queueEngine,
      buildJobHandler: buildJobHandler ?? (() => async () => undefined)
    })
  );
  app.use(errorHandler);
  return app;
};

describe('articleContentScraper routes', () => {
  let tempDirPath = '';
  let queueStore: QueueJobStore;
  let queueEngine: GlobalQueueEngine;

  beforeEach(async () => {
    tempDirPath = await fs.mkdtemp(path.join(os.tmpdir(), 'article-content-scraper-route-'));
    queueStore = new QueueJobStore(path.join(tempDirPath, 'queue-jobs.json'));
    await queueStore.ensureInitialized();

    let counter = 0;
    queueEngine = new GlobalQueueEngine(queueStore, {
      createJobId: () => {
        counter += 1;
        return `job-${counter}`;
      }
    });
  });

  afterEach(async () => {
    await queueEngine.onIdle();
    await fs.rm(tempDirPath, { recursive: true, force: true });
  });

  it('validates invalid request bodies correctly', async () => {
    const app = buildApp(queueEngine);

    const response = await request(app).post('/article-content-scraper/start-job').send({
      targetArticleThresholdDaysOld: 0
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      status: 400,
      details: [
        {
          field: 'targetArticleThresholdDaysOld',
          message: 'targetArticleThresholdDaysOld must be a positive integer'
        },
        {
          field: 'targetArticleStateReviewCount',
          message: 'targetArticleStateReviewCount must be a positive integer'
        }
      ]
    });
  });

  it('enqueues the scraper job and returns 202', async () => {
    const app = buildApp(queueEngine);

    const response = await request(app).post('/article-content-scraper/start-job').send({
      targetArticleThresholdDaysOld: 180,
      targetArticleStateReviewCount: 100,
      includeArticlesThatMightHaveBeenStateAssigned: true
    });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      jobId: 'job-1',
      status: 'queued',
      endpointName: '/article-content-scraper/start-job'
    });
  });

  it('allows the queued job to complete successfully in the happy path test', async () => {
    const buildJobHandler = jest.fn(() => async () => undefined);
    const app = buildApp(queueEngine, buildJobHandler);

    const response = await request(app).post('/article-content-scraper/start-job').send({
      targetArticleThresholdDaysOld: 180,
      targetArticleStateReviewCount: 100,
      includeArticlesThatMightHaveBeenStateAssigned: true
    });

    expect(response.status).toBe(202);
    expect(buildJobHandler).toHaveBeenCalledWith({
      targetArticleThresholdDaysOld: 180,
      targetArticleStateReviewCount: 100,
      includeArticlesThatMightHaveBeenStateAssigned: true
    });

    await queueEngine.onIdle();
    const queuedJob = await queueStore.getJobById('job-1');
    expect(queuedJob?.status).toBe('completed');
  });
});
