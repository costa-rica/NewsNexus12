import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { errorHandler } from '../../src/modules/middleware/errorHandlers';
import {
  DEFAULT_REQUEST_GOOGLE_RSS_REPEAT_WINDOW_HOURS,
  RequestGoogleRssJobInput
} from '../../src/modules/jobs/requestGoogleRssJob';
import { QueueJobStore } from '../../src/modules/queue/jobStore';
import { GlobalQueueEngine, QueueExecutionContext } from '../../src/modules/queue/queueEngine';
import { createRequestGoogleRssRouter } from '../../src/routes/requestGoogleRss';

const buildApp = (
  queueEngine: GlobalQueueEngine,
  env: NodeJS.ProcessEnv,
  buildJobHandler?: (input: RequestGoogleRssJobInput) => (context: QueueExecutionContext) => Promise<void>
): express.Express => {
  const app = express();
  app.use(express.json());
  app.use(
    '/request-google-rss',
    createRequestGoogleRssRouter({
      queueEngine,
      env,
      buildJobHandler: buildJobHandler ?? (() => async () => undefined)
    })
  );
  app.use(errorHandler);
  return app;
};

describe('requestGoogleRss routes', () => {
  let tempDirPath = '';
  let queueStore: QueueJobStore;
  let queueEngine: GlobalQueueEngine;

  beforeEach(async () => {
    tempDirPath = await fs.mkdtemp(path.join(os.tmpdir(), 'request-google-rss-route-'));
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

  it('enqueues request-google-rss job and returns expected metadata', async () => {
    const spreadsheetPath = path.join(tempDirPath, 'queries.xlsx');
    await fs.writeFile(spreadsheetPath, 'dummy', 'utf8');
    const buildJobHandler = jest.fn(() => async () => undefined);

    const app = buildApp(queueEngine, {
      PATH_AND_FILENAME_FOR_QUERY_SPREADSHEET_AUTOMATED: spreadsheetPath
    }, buildJobHandler);

    const response = await request(app).post('/request-google-rss/start-job').send({});

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      jobId: 'job-1',
      status: 'queued',
      endpointName: '/request-google-rss/start-job'
    });

    expect(buildJobHandler).toHaveBeenCalledWith({
      spreadsheetPath,
      doNotRepeatRequestsWithinHours: DEFAULT_REQUEST_GOOGLE_RSS_REPEAT_WINDOW_HOURS
    });

    await queueEngine.onIdle();
    const queuedJob = await queueStore.getJobById('job-1');
    expect(queuedJob?.status).toBe('completed');
  });

  it('passes custom doNotRepeatRequestsWithinHours to the job handler', async () => {
    const spreadsheetPath = path.join(tempDirPath, 'queries.xlsx');
    await fs.writeFile(spreadsheetPath, 'dummy', 'utf8');
    const buildJobHandler = jest.fn(() => async () => undefined);

    const app = buildApp(
      queueEngine,
      {
        PATH_AND_FILENAME_FOR_QUERY_SPREADSHEET_AUTOMATED: spreadsheetPath
      },
      buildJobHandler
    );

    const response = await request(app).post('/request-google-rss/start-job').send({
      doNotRepeatRequestsWithinHours: 24
    });

    expect(response.status).toBe(202);
    expect(buildJobHandler).toHaveBeenCalledWith({
      spreadsheetPath,
      doNotRepeatRequestsWithinHours: 24
    });
  });

  it('accepts 0 hours and passes it to the job handler', async () => {
    const spreadsheetPath = path.join(tempDirPath, 'queries.xlsx');
    await fs.writeFile(spreadsheetPath, 'dummy', 'utf8');
    const buildJobHandler = jest.fn(() => async () => undefined);

    const app = buildApp(
      queueEngine,
      {
        PATH_AND_FILENAME_FOR_QUERY_SPREADSHEET_AUTOMATED: spreadsheetPath
      },
      buildJobHandler
    );

    const response = await request(app).post('/request-google-rss/start-job').send({
      doNotRepeatRequestsWithinHours: 0
    });

    expect(response.status).toBe(202);
    expect(buildJobHandler).toHaveBeenCalledWith({
      spreadsheetPath,
      doNotRepeatRequestsWithinHours: 0
    });
  });

  it('returns validation error when spreadsheet env var is missing', async () => {
    const app = buildApp(queueEngine, {});

    const response = await request(app).post('/request-google-rss/start-job').send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      status: 400,
      details: [
        {
          field: 'PATH_AND_FILENAME_FOR_QUERY_SPREADSHEET_AUTOMATED',
          message: 'PATH_AND_FILENAME_FOR_QUERY_SPREADSHEET_AUTOMATED env var is required'
        }
      ]
    });
  });

  it('returns validation error when doNotRepeatRequestsWithinHours is invalid', async () => {
    const spreadsheetPath = path.join(tempDirPath, 'queries.xlsx');
    await fs.writeFile(spreadsheetPath, 'dummy', 'utf8');

    const app = buildApp(queueEngine, {
      PATH_AND_FILENAME_FOR_QUERY_SPREADSHEET_AUTOMATED: spreadsheetPath
    });

    const response = await request(app).post('/request-google-rss/start-job').send({
      doNotRepeatRequestsWithinHours: -1
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      status: 400,
      details: [
        {
          field: 'doNotRepeatRequestsWithinHours',
          message: 'doNotRepeatRequestsWithinHours must be a non-negative integer'
        }
      ]
    });
  });
});
