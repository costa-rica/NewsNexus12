import express from 'express';
import request from 'supertest';
import { orchestratorLockMiddleware } from '../../src/modules/middleware/orchestratorLock';

const mockGetActiveRunId = jest.fn();

jest.mock('../../src/modules/orchestrator/activeRunGuard', () => ({
  getActiveOrchestratorRunId: () => mockGetActiveRunId(),
}));

const buildApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.post(
    '/test/start-job',
    orchestratorLockMiddleware,
    (_req, res) => res.status(202).json({ ok: true })
  );
  return app;
};

describe('orchestratorLockMiddleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows request when no run is active', async () => {
    mockGetActiveRunId.mockResolvedValueOnce(null);

    const app = buildApp();
    const res = await request(app).post('/test/start-job').send({});

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true });
  });

  it('blocks request with 423 when a run is active and no header', async () => {
    mockGetActiveRunId.mockResolvedValueOnce(99);

    const app = buildApp();
    const res = await request(app).post('/test/start-job').send({});

    expect(res.status).toBe(423);
    expect(res.body).toMatchObject({ orchestratorRunId: 99 });
  });

  it('allows request when X-Orchestrator-Run-Id matches active run', async () => {
    mockGetActiveRunId.mockResolvedValueOnce(99);

    const app = buildApp();
    const res = await request(app)
      .post('/test/start-job')
      .set('X-Orchestrator-Run-Id', '99')
      .send({});

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true });
  });

  it('blocks request when X-Orchestrator-Run-Id does not match', async () => {
    mockGetActiveRunId.mockResolvedValueOnce(99);

    const app = buildApp();
    const res = await request(app)
      .post('/test/start-job')
      .set('X-Orchestrator-Run-Id', '77')
      .send({});

    expect(res.status).toBe(423);
    expect(res.body).toMatchObject({ orchestratorRunId: 99 });
  });

  it('allows request when guard check throws', async () => {
    mockGetActiveRunId.mockRejectedValueOnce(new Error('db error'));

    const app = buildApp();
    const res = await request(app).post('/test/start-job').send({});

    expect(res.status).toBe(202);
  });
});
