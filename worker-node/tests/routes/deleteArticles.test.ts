import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { errorHandler } from '../../src/modules/middleware/errorHandlers';
import { QueueJobStore } from '../../src/modules/queue/jobStore';
import { GlobalQueueEngine, QueueExecutionContext } from '../../src/modules/queue/queueEngine';
import { createDeleteArticlesRouter } from '../../src/routes/deleteArticles';
import { DeleteArticlesJobInput } from '../../src/modules/jobs/deleteArticlesJob';

const buildApp = (
  queueEngine: GlobalQueueEngine,
  buildJobHandler?: (input: DeleteArticlesJobInput) => (context: QueueExecutionContext) => Promise<void>
): express.Express => {
  const app = express();
  app.use(express.json());
  app.use(
    '/delete-articles',
    createDeleteArticlesRouter({
      queueEngine,
      buildJobHandler: buildJobHandler ?? (() => async () => undefined)
    })
  );
  app.use(errorHandler);
  return app;
};

describe('deleteArticles routes', () => {
  let tempDirPath = '';
  let queueStore: QueueJobStore;
  let queueEngine: GlobalQueueEngine;

  beforeEach(async () => {
    tempDirPath = await fs.mkdtemp(path.join(os.tmpdir(), 'delete-articles-route-'));
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

  it('enqueues delete-articles job with default args and returns 202', async () => {
    const app = buildApp(queueEngine);

    const response = await request(app).post('/delete-articles/start-job').send({});

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      jobId: 'job-1',
      status: 'queued',
      endpointName: '/delete-articles/start-job'
    });

    await queueEngine.onIdle();
    const queuedJob = await queueStore.getJobById('job-1');
    expect(queuedJob?.status).toBe('completed');
  });

  it('passes daysOld to the job handler', async () => {
    let receivedInput: DeleteArticlesJobInput | undefined;

    const app = buildApp(queueEngine, (input) => {
      receivedInput = input;
      return async () => undefined;
    });

    const response = await request(app).post('/delete-articles/start-job').send({ daysOld: 90 });

    expect(response.status).toBe(202);
    await queueEngine.onIdle();
    expect(receivedInput?.daysOld).toBe(90);
    expect(receivedInput?.trimCount).toBeUndefined();
  });

  it('passes trimCount to the job handler', async () => {
    let receivedInput: DeleteArticlesJobInput | undefined;

    const app = buildApp(queueEngine, (input) => {
      receivedInput = input;
      return async () => undefined;
    });

    const response = await request(app).post('/delete-articles/start-job').send({ trimCount: 500 });

    expect(response.status).toBe(202);
    await queueEngine.onIdle();
    expect(receivedInput?.trimCount).toBe(500);
    expect(receivedInput?.daysOld).toBeUndefined();
  });

  it('returns 400 for invalid daysOld value', async () => {
    const app = buildApp(queueEngine);

    const response = await request(app)
      .post('/delete-articles/start-job')
      .send({ daysOld: -5 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid trimCount value', async () => {
    const app = buildApp(queueEngine);

    const response = await request(app)
      .post('/delete-articles/start-job')
      .send({ trimCount: 'lots' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
