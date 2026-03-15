import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { errorHandler } from '../../src/modules/middleware/errorHandlers';
import { QueueJobStore } from '../../src/modules/queue/jobStore';
import { GlobalQueueEngine } from '../../src/modules/queue/queueEngine';
import { QueueJobRecord } from '../../src/modules/queue/types';
import { createQueueInfoRouter } from '../../src/routes/queueInfo';

const makeJob = (overrides: Partial<QueueJobRecord> = {}): QueueJobRecord => ({
  jobId: overrides.jobId ?? 'job-1',
  endpointName: overrides.endpointName ?? '/semantic-scorer/start-job',
  status: overrides.status ?? 'queued',
  createdAt: overrides.createdAt ?? new Date('2026-01-01T00:00:00.000Z').toISOString(),
  ...(overrides.startedAt ? { startedAt: overrides.startedAt } : {}),
  ...(overrides.endedAt ? { endedAt: overrides.endedAt } : {}),
  ...(overrides.failureReason ? { failureReason: overrides.failureReason } : {})
});

const buildTestApp = (queueEngine: GlobalQueueEngine): express.Express => {
  const app = express();
  app.use(express.json());
  app.use('/queue-info', createQueueInfoRouter({ queueEngine }));
  app.use(errorHandler);
  return app;
};

describe('queueInfo routes', () => {
  let tempDirPath = '';
  let store: QueueJobStore;
  let engine: GlobalQueueEngine;

  beforeEach(async () => {
    tempDirPath = await fs.mkdtemp(path.join(os.tmpdir(), 'queue-info-route-test-'));
    store = new QueueJobStore(path.join(tempDirPath, 'queue-jobs.json'));
    await store.ensureInitialized();

    let counter = 0;
    engine = new GlobalQueueEngine(store, {
      createJobId: () => {
        counter += 1;
        return `job-${counter}`;
      }
    });
  });

  afterEach(async () => {
    await engine.onIdle();
    await fs.rm(tempDirPath, { recursive: true, force: true });
  });

  it('returns job status for GET /queue-info/check-status/:jobId', async () => {
    await store.appendJob(makeJob({ jobId: 'job-123', status: 'completed' }));
    const app = buildTestApp(engine);

    const response = await request(app).get('/queue-info/check-status/job-123');

    expect(response.status).toBe(200);
    expect(response.body.job).toMatchObject({
      jobId: 'job-123',
      status: 'completed'
    });
  });

  it('returns queue summary for GET /queue-info/queue_status', async () => {
    await store.appendJob(makeJob({ jobId: 'job-queued', status: 'queued' }));
    await store.appendJob(
      makeJob({
        jobId: 'job-running',
        status: 'running',
        startedAt: new Date('2026-01-01T00:01:00.000Z').toISOString()
      })
    );
    await store.appendJob(
      makeJob({
        jobId: 'job-failed',
        status: 'failed',
        endedAt: new Date('2026-01-01T00:02:00.000Z').toISOString(),
        failureReason: 'example_failure'
      })
    );

    const app = buildTestApp(engine);
    const response = await request(app).get('/queue-info/queue_status');

    expect(response.status).toBe(200);
    expect(response.body.summary).toEqual({
      totalJobs: 3,
      queued: 1,
      running: 1,
      completed: 0,
      failed: 1,
      canceled: 0
    });
    expect(response.body.runningJob.jobId).toBe('job-running');
    expect(response.body.queuedJobs).toHaveLength(1);
    expect(response.body.queuedJobs[0].jobId).toBe('job-queued');
  });

  it('returns latest job for GET /queue-info/latest-job', async () => {
    await store.appendJob(
      makeJob({
        jobId: 'job-older',
        endpointName: '/request-google-rss/start-job',
        status: 'completed',
        createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString()
      })
    );
    await store.appendJob(
      makeJob({
        jobId: 'job-latest',
        endpointName: '/request-google-rss/start-job',
        status: 'running',
        createdAt: new Date('2026-01-01T00:05:00.000Z').toISOString(),
        startedAt: new Date('2026-01-01T00:05:01.000Z').toISOString()
      })
    );
    await store.appendJob(
      makeJob({
        jobId: 'job-other-endpoint',
        endpointName: '/semantic-scorer/start-job',
        status: 'queued',
        createdAt: new Date('2026-01-01T00:06:00.000Z').toISOString()
      })
    );

    const app = buildTestApp(engine);
    const response = await request(app)
      .get('/queue-info/latest-job')
      .query({ endpointName: '/request-google-rss/start-job' });

    expect(response.status).toBe(200);
    expect(response.body.job).toMatchObject({
      jobId: 'job-latest',
      endpointName: '/request-google-rss/start-job',
      status: 'running'
    });
  });

  it('returns null job when GET /queue-info/latest-job has no matches', async () => {
    const app = buildTestApp(engine);
    const response = await request(app)
      .get('/queue-info/latest-job')
      .query({ endpointName: '/request-google-rss/start-job' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ job: null });
  });

  it('cancels a queued job via POST /queue-info/cancel_job/:jobId', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    await engine.enqueueJob({
      endpointName: '/request-google-rss/start-job',
      run: async () => {
        await firstGate;
      }
    });
    await engine.enqueueJob({
      endpointName: '/state-assigner/start-job',
      run: async () => {
        throw new Error('queued job should be canceled before execution');
      }
    });

    try {
      const app = buildTestApp(engine);
      const response = await request(app).post('/queue-info/cancel_job/job-2');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        jobId: 'job-2',
        outcome: 'canceled'
      });

      const job = await store.getJobById('job-2');
      expect(job?.status).toBe('canceled');
    } finally {
      releaseFirst?.();
      await engine.onIdle();
    }
  });

  it('returns NOT_FOUND when target job does not exist', async () => {
    const app = buildTestApp(engine);

    const statusResponse = await request(app).get('/queue-info/check-status/does-not-exist');
    expect(statusResponse.status).toBe(404);
    expect(statusResponse.body.error).toMatchObject({
      code: 'NOT_FOUND',
      status: 404
    });

    const cancelResponse = await request(app).post('/queue-info/cancel_job/does-not-exist');
    expect(cancelResponse.status).toBe(404);
    expect(cancelResponse.body.error).toMatchObject({
      code: 'NOT_FOUND',
      status: 404
    });
  });

  it('returns VALIDATION_ERROR when jobId param is blank', async () => {
    const app = buildTestApp(engine);
    const response = await request(app).get('/queue-info/check-status/%20');

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      status: 400,
      details: [{ field: 'jobId', message: 'jobId route parameter is required' }]
    });
  });

  it('returns VALIDATION_ERROR when endpointName query is blank', async () => {
    const app = buildTestApp(engine);
    const response = await request(app).get('/queue-info/latest-job').query({
      endpointName: ' '
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      status: 400,
      details: [{ field: 'endpointName', message: 'endpointName query parameter is required' }]
    });
  });
});
