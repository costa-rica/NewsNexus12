import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { errorHandler } from '../../src/modules/middleware/errorHandlers';
import { QueueJobStore } from '../../src/modules/queue/jobStore';
import { GlobalQueueEngine, QueueExecutionContext } from '../../src/modules/queue/queueEngine';
import { SemanticScorerTargeting } from '../../src/modules/jobs/semanticScorerJob';
import { createSemanticScorerRouter } from '../../src/routes/semanticScorer';

const buildApp = (
  queueEngine: GlobalQueueEngine,
  env: NodeJS.ProcessEnv,
  buildJobHandler?: (
    semanticScorerDir: string,
    targeting?: SemanticScorerTargeting
  ) => (context: QueueExecutionContext) => Promise<void>
): express.Express => {
  const app = express();
  app.use(express.json());
  app.use(
    '/semantic-scorer',
    createSemanticScorerRouter({
      queueEngine,
      env,
      buildJobHandler: buildJobHandler ?? (() => async () => undefined)
    })
  );
  app.use(errorHandler);
  return app;
};

describe('semanticScorer routes', () => {
  let tempDirPath = '';
  let queueStore: QueueJobStore;
  let queueEngine: GlobalQueueEngine;

  beforeEach(async () => {
    tempDirPath = await fs.mkdtemp(path.join(os.tmpdir(), 'semantic-scorer-route-'));
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

  it('enqueues semantic-scorer job and returns expected metadata', async () => {
    await fs.writeFile(path.join(tempDirPath, 'NewsNexusSemanticScorerKeywords.xlsx'), 'stub', 'utf8');

    const app = buildApp(queueEngine, {
      PATH_TO_SEMANTIC_SCORER_DIR: tempDirPath
    });

    const response = await request(app).post('/semantic-scorer/start-job').send({});

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      jobId: 'job-1',
      status: 'queued',
      endpointName: '/semantic-scorer/start-job'
    });

    await queueEngine.onIdle();
    const queuedJob = await queueStore.getJobById('job-1');
    expect(queuedJob?.status).toBe('completed');
  });

  it('returns validation error when semantic scorer dir env var is missing', async () => {
    const app = buildApp(queueEngine, {});

    const response = await request(app).post('/semantic-scorer/start-job').send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      status: 400,
      details: [
        {
          field: 'PATH_TO_SEMANTIC_SCORER_DIR',
          message: 'PATH_TO_SEMANTIC_SCORER_DIR env var is required'
        }
      ]
    });
  });

  it('keeps optional ID-range targeting compatible', async () => {
    await fs.writeFile(path.join(tempDirPath, 'NewsNexusSemanticScorerKeywords.xlsx'), 'stub', 'utf8');
    const buildJobHandler = jest.fn(() => async () => undefined);
    const app = buildApp(
      queueEngine,
      { PATH_TO_SEMANTIC_SCORER_DIR: tempDirPath },
      buildJobHandler
    );

    const response = await request(app).post('/semantic-scorer/start-job').send({
      articleIdMinExclusive: 100,
      articleIdMaxInclusive: 200
    });

    expect(response.status).toBe(202);
    expect(buildJobHandler).toHaveBeenCalledWith(tempDirPath, {
      articleIdMinExclusive: 100,
      articleIdMaxInclusive: 200
    });
  });

  it('allows the weekly flow to omit ID bounds', async () => {
    await fs.writeFile(path.join(tempDirPath, 'NewsNexusSemanticScorerKeywords.xlsx'), 'stub', 'utf8');
    const buildJobHandler = jest.fn(() => async () => undefined);
    const app = buildApp(
      queueEngine,
      { PATH_TO_SEMANTIC_SCORER_DIR: tempDirPath },
      buildJobHandler
    );

    const response = await request(app).post('/semantic-scorer/start-job').send({});

    expect(response.status).toBe(202);
    expect(buildJobHandler).toHaveBeenCalledWith(tempDirPath, {
      articleIdMinExclusive: undefined,
      articleIdMaxInclusive: undefined
    });
  });
});
