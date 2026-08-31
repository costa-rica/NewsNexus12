import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { AppError } from '../../src/modules/errors/appError';
import { errorHandler } from '../../src/modules/middleware/errorHandlers';
import { QueueJobStore } from '../../src/modules/queue/jobStore';
import { GlobalQueueEngine, QueueExecutionContext } from '../../src/modules/queue/queueEngine';
import { StateAssignerAiConfig } from '../../src/modules/state-assigner/config';
import {
  createStateAssignerRouter,
  StateAssignerStartInput
} from '../../src/routes/stateAssigner';

const codexConfig: StateAssignerAiConfig = {
  backend: 'codex-cli',
  modelName: 'gpt-5.4-mini',
  codexTimeoutMs: 180_000
};

const openAiConfig: StateAssignerAiConfig = {
  backend: 'openai',
  modelName: 'gpt-4o-mini',
  keyOpenAi: 'test-key'
};

interface BuildAppOptions {
  buildJobHandler?: (
    input: StateAssignerStartInput
  ) => (context: QueueExecutionContext) => Promise<void>;
  resolveAiConfig?: (env: NodeJS.ProcessEnv) => StateAssignerAiConfig;
}

const buildApp = (
  queueEngine: GlobalQueueEngine,
  env: NodeJS.ProcessEnv,
  options: BuildAppOptions = {}
): express.Express => {
  const app = express();
  app.use(express.json());
  app.use(
    '/state-assigner',
    createStateAssignerRouter({
      queueEngine,
      env,
      buildJobHandler: options.buildJobHandler ?? (() => async () => undefined),
      resolveAiConfig: options.resolveAiConfig ?? (() => codexConfig)
    })
  );
  app.use(errorHandler);
  return app;
};

describe('stateAssigner routes', () => {
  let tempDirPath = '';
  let queueStore: QueueJobStore;
  let queueEngine: GlobalQueueEngine;

  beforeEach(async () => {
    tempDirPath = await fs.mkdtemp(path.join(os.tmpdir(), 'state-assigner-route-'));
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

  it('validates request body and enqueues state assigner job', async () => {
    const buildJobHandler = jest.fn(() => async () => undefined);
    const app = buildApp(
      queueEngine,
      {
        PATH_TO_STATE_ASSIGNER_FILES: tempDirPath
      },
      { buildJobHandler }
    );

    const response = await request(app).post('/state-assigner/start-job').send({
      targetArticleThresholdDaysOld: 30,
      targetArticleStateReviewCount: 50
    });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      jobId: 'job-1',
      status: 'queued',
      endpointName: '/state-assigner/start-job'
    });
    expect(buildJobHandler).toHaveBeenCalledWith({
      targetArticleThresholdDaysOld: 30,
      targetArticleStateReviewCount: 50,
      aiConfig: codexConfig,
      pathToStateAssignerFiles: tempDirPath
    });

    await queueEngine.onIdle();
    const queuedJob = await queueStore.getJobById('job-1');
    expect(queuedJob?.status).toBe('completed');
  });

  it('returns validation error when request body fields are invalid', async () => {
    const app = buildApp(queueEngine, {
      PATH_TO_STATE_ASSIGNER_FILES: tempDirPath
    });

    const response = await request(app).post('/state-assigner/start-job').send({
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

  it('returns validation error when PATH_TO_STATE_ASSIGNER_FILES is missing', async () => {
    const app = buildApp(queueEngine, {});

    const response = await request(app).post('/state-assigner/start-job').send({
      targetArticleThresholdDaysOld: 30,
      targetArticleStateReviewCount: 50
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      status: 400,
      details: [
        {
          field: 'PATH_TO_STATE_ASSIGNER_FILES',
          message: 'PATH_TO_STATE_ASSIGNER_FILES env var is required'
        }
      ]
    });
  });

  it('accepts a missing OpenAI key when the codex backend is resolvable', async () => {
    const app = buildApp(queueEngine, {
      PATH_TO_STATE_ASSIGNER_FILES: tempDirPath
    });

    const response = await request(app).post('/state-assigner/start-job').send({
      targetArticleThresholdDaysOld: 30,
      targetArticleStateReviewCount: 50
    });

    expect(response.status).toBe(202);
  });

  it('allows USE_OPEN_AI_API=true without a key when the resolver falls back to codex', async () => {
    const resolveAiConfig = jest.fn(() => codexConfig);
    const app = buildApp(
      queueEngine,
      {
        USE_OPEN_AI_API: 'true',
        PATH_TO_STATE_ASSIGNER_FILES: tempDirPath
      },
      { resolveAiConfig }
    );

    const response = await request(app).post('/state-assigner/start-job').send({
      targetArticleThresholdDaysOld: 30,
      targetArticleStateReviewCount: 50
    });

    expect(response.status).toBe(202);
    expect(resolveAiConfig).toHaveBeenCalledWith({
      USE_OPEN_AI_API: 'true',
      PATH_TO_STATE_ASSIGNER_FILES: tempDirPath
    });
  });

  it('returns validation error when the resolver rejects a missing codex binary', async () => {
    const app = buildApp(
      queueEngine,
      {
        PATH_TO_STATE_ASSIGNER_FILES: tempDirPath
      },
      {
        resolveAiConfig: () => {
          throw AppError.validation([
            {
              field: 'codex',
              message: 'codex CLI not found on PATH'
            }
          ]);
        }
      }
    );

    const response = await request(app).post('/state-assigner/start-job').send({
      targetArticleThresholdDaysOld: 30,
      targetArticleStateReviewCount: 50
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      status: 400,
      details: [
        {
          field: 'codex',
          message: 'codex CLI not found on PATH'
        }
      ]
    });
  });

  it('passes an openai config to the job handler when the resolver selects openai', async () => {
    const buildJobHandler = jest.fn(() => async () => undefined);
    const app = buildApp(
      queueEngine,
      {
        USE_OPEN_AI_API: 'true',
        KEY_OPEN_AI: 'test-key',
        PATH_TO_STATE_ASSIGNER_FILES: tempDirPath
      },
      {
        buildJobHandler,
        resolveAiConfig: () => openAiConfig
      }
    );

    const response = await request(app).post('/state-assigner/start-job').send({
      targetArticleThresholdDaysOld: 30,
      targetArticleStateReviewCount: 50
    });

    expect(response.status).toBe(202);
    expect(buildJobHandler).toHaveBeenCalledWith({
      targetArticleThresholdDaysOld: 30,
      targetArticleStateReviewCount: 50,
      aiConfig: openAiConfig,
      pathToStateAssignerFiles: tempDirPath
    });
  });

  it('preserves exact cohort IDs and requested capacity in the job and queue record', async () => {
    const buildJobHandler = jest.fn(() => async () => undefined);
    const app = buildApp(
      queueEngine,
      { PATH_TO_STATE_ASSIGNER_FILES: tempDirPath },
      { buildJobHandler }
    );

    const response = await request(app).post('/state-assigner/start-job').send({
      articleIds: [101, 202, 202],
      targetArticleStateReviewCount: 250
    });

    expect(response.status).toBe(202);
    expect(buildJobHandler).toHaveBeenCalledWith(expect.objectContaining({
      articleIds: [101, 202],
      targetArticleStateReviewCount: 250
    }));
    await queueEngine.onIdle();
    await expect(queueStore.getJobById('job-1')).resolves.toMatchObject({
      parameters: expect.objectContaining({
        articleIds: [101, 202],
        targetArticleStateReviewCount: 250
      })
    });
  });
});
