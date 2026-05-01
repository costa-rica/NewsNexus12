import express from 'express';
import request from 'supertest';
import { createOrchestratorRouter } from '../../src/routes/orchestrator';
import { errorHandler } from '../../src/modules/middleware/errorHandlers';

const mockGetActiveRunId = jest.fn();
const mockStartCoordinator = jest.fn();
const mockRequestCancel = jest.fn();
const mockGetActiveCoordinator = jest.fn();
const mockGetRunWithSteps = jest.fn();
const mockGetRunById = jest.fn();
const mockListRuns = jest.fn();
const mockInvalidateCache = jest.fn();

jest.mock('../../src/modules/orchestrator/activeRunGuard', () => ({
  getActiveOrchestratorRunId: () => mockGetActiveRunId(),
  invalidateActiveRunCache: () => mockInvalidateCache(),
}));

jest.mock('../../src/modules/orchestrator/coordinator', () => ({
  startCoordinator: (...args: unknown[]) => mockStartCoordinator(...args),
  requestCancel: (...args: unknown[]) => mockRequestCancel(...args),
  getActiveCoordinator: () => mockGetActiveCoordinator(),
}));

jest.mock('../../src/modules/orchestrator/repository', () => ({
  getRunWithSteps: (...args: unknown[]) => mockGetRunWithSteps(...args),
  getRunById: (...args: unknown[]) => mockGetRunById(...args),
  listRuns: (...args: unknown[]) => mockListRuns(...args),
}));

const buildApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use('/orchestrator', createOrchestratorRouter());
  app.use(errorHandler);
  return app;
};

describe('orchestrator routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /orchestrator/start', () => {
    it('returns 409 when a run is already active', async () => {
      mockGetActiveRunId.mockResolvedValueOnce(5);

      const res = await request(buildApp()).post('/orchestrator/start').send({});

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ orchestratorRunId: 5 });
    });

    it('starts a run and returns 202 with runId', async () => {
      mockGetActiveRunId.mockResolvedValueOnce(null);
      mockStartCoordinator.mockResolvedValueOnce(42);

      const res = await request(buildApp())
        .post('/orchestrator/start')
        .send({ aiApproverEnabled: true, semanticScorerEnabled: false });

      expect(res.status).toBe(202);
      expect(res.body).toEqual({ runId: 42 });
      expect(mockStartCoordinator).toHaveBeenCalledWith(
        { mode: 'weekly', aiApproverEnabled: true, semanticScorerEnabled: false },
        null
      );
    });

    it('starts an abbreviated test run with default limits', async () => {
      mockGetActiveRunId.mockResolvedValueOnce(null);
      mockStartCoordinator.mockResolvedValueOnce(43);

      const res = await request(buildApp())
        .post('/orchestrator/start')
        .send({ mode: 'abbreviated_test', aiApproverEnabled: true, semanticScorerEnabled: true });

      expect(res.status).toBe(202);
      expect(mockStartCoordinator).toHaveBeenCalledWith(
        {
          mode: 'abbreviated_test',
          aiApproverEnabled: true,
          semanticScorerEnabled: true,
          testConfig: {
            deleteTrimCount: 100,
            targetArticlesAddedCount: 10,
            downstreamArticleCount: 10,
          },
        },
        null
      );
    });

    it('validates abbreviated test run limits', async () => {
      mockGetActiveRunId.mockResolvedValueOnce(null);

      const res = await request(buildApp())
        .post('/orchestrator/start')
        .send({
          mode: 'abbreviated_test',
          testConfig: { targetArticlesAddedCount: 0 },
        });

      expect(res.status).toBe(400);
      expect(mockStartCoordinator).not.toHaveBeenCalled();
      expect(res.body.error.details).toEqual([
        {
          field: 'testConfig.targetArticlesAddedCount',
          message: 'testConfig.targetArticlesAddedCount must be a positive integer when provided',
        },
      ]);
    });
  });

  describe('GET /orchestrator/active-run', () => {
    it('returns null when no run is active', async () => {
      mockGetActiveRunId.mockResolvedValueOnce(null);

      const res = await request(buildApp()).get('/orchestrator/active-run');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ runId: null });
    });

    it('returns the active run id', async () => {
      mockGetActiveRunId.mockResolvedValueOnce(7);

      const res = await request(buildApp()).get('/orchestrator/active-run');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ runId: 7 });
    });
  });

  describe('GET /orchestrator/runs', () => {
    it('returns a list of runs', async () => {
      mockListRuns.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);

      const res = await request(buildApp()).get('/orchestrator/runs');

      expect(res.status).toBe(200);
      expect(res.body.runs).toHaveLength(2);
    });
  });

  describe('GET /orchestrator/runs/:id', () => {
    it('returns 404 for an unknown run', async () => {
      mockGetRunWithSteps.mockResolvedValueOnce(null);

      const res = await request(buildApp()).get('/orchestrator/runs/99');

      expect(res.status).toBe(404);
    });

    it('returns run with steps', async () => {
      mockGetRunWithSteps.mockResolvedValueOnce({ run: { id: 1 }, steps: [] });

      const res = await request(buildApp()).get('/orchestrator/runs/1');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ run: { id: 1 }, steps: [] });
    });
  });

  describe('POST /orchestrator/runs/:id/cancel', () => {
    it('returns 404 when run does not exist', async () => {
      mockGetRunById.mockResolvedValueOnce(null);

      const res = await request(buildApp()).post('/orchestrator/runs/99/cancel').send({});

      expect(res.status).toBe(404);
    });

    it('returns 409 when run is not running', async () => {
      mockGetRunById.mockResolvedValueOnce({ id: 1, status: 'completed' });

      const res = await request(buildApp()).post('/orchestrator/runs/1/cancel').send({});

      expect(res.status).toBe(409);
    });

    it('sends cancel signal for active run', async () => {
      mockGetRunById.mockResolvedValueOnce({ id: 1, status: 'running' });
      mockRequestCancel.mockReturnValueOnce(true);

      const res = await request(buildApp()).post('/orchestrator/runs/1/cancel').send({});

      expect(res.status).toBe(202);
      expect(mockRequestCancel).toHaveBeenCalledWith(1);
    });
  });
});
