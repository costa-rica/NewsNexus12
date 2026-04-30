import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../modules/errors/appError';
import {
  startCoordinator,
  requestCancel,
  getActiveCoordinator,
} from '../modules/orchestrator/coordinator';
import { getActiveOrchestratorRunId, invalidateActiveRunCache } from '../modules/orchestrator/activeRunGuard';
import { getRunWithSteps, getRunById, listRuns } from '../modules/orchestrator/repository';
import logger from '../modules/logger';

export const createOrchestratorRouter = (): Router => {
  const router = Router();

  router.post('/start', async (req, res, next) => {
    try {
      const activeRunId = await getActiveOrchestratorRunId();
      if (activeRunId !== null) {
        return res.status(409).json({
          orchestratorRunId: activeRunId,
          message: `An orchestrator run (id: ${activeRunId}) is already in progress.`,
        });
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const aiApproverEnabled =
        typeof body.aiApproverEnabled === 'boolean' ? body.aiApproverEnabled : true;
      const semanticScorerEnabled =
        typeof body.semanticScorerEnabled === 'boolean' ? body.semanticScorerEnabled : true;

      const userId = typeof body.userId === 'number' ? body.userId : null;

      logger.info('orchestrator: start request received', { aiApproverEnabled, semanticScorerEnabled, userId });

      const runId = await startCoordinator({ aiApproverEnabled, semanticScorerEnabled }, userId);
      invalidateActiveRunCache();

      return res.status(202).json({ runId });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/active-run', async (_req, res, next) => {
    try {
      const runId = await getActiveOrchestratorRunId();
      return res.status(200).json({ runId });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/runs', async (req, res, next) => {
    try {
      const limit = Math.min(Number(req.query.limit ?? 20), 100);
      const offset = Number(req.query.offset ?? 0);
      const runs = await listRuns(limit, offset);
      return res.status(200).json({ runs });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/runs/:id', async (req, res, next) => {
    try {
      const runId = Number(req.params.id);
      if (!Number.isFinite(runId) || runId <= 0) {
        throw AppError.validation([{ field: 'id', message: 'id must be a positive integer' }]);
      }

      const data = await getRunWithSteps(runId);
      if (!data) {
        throw new AppError({ status: 404, code: 'NOT_FOUND', message: `Run ${runId} not found` });
      }

      return res.status(200).json(data);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/runs/:id/cancel', async (req, res, next) => {
    try {
      const runId = Number(req.params.id);
      if (!Number.isFinite(runId) || runId <= 0) {
        throw AppError.validation([{ field: 'id', message: 'id must be a positive integer' }]);
      }

      const run = await getRunById(runId);
      if (!run) {
        throw new AppError({ status: 404, code: 'NOT_FOUND', message: `Run ${runId} not found` });
      }

      if (run.status !== 'running') {
        return res.status(409).json({ message: `Run ${runId} is not running (status: ${run.status})` });
      }

      const accepted = requestCancel(runId);
      if (!accepted) {
        return res.status(409).json({ message: `No active in-process coordinator found for run ${runId}` });
      }

      logger.info('orchestrator: cancel requested', { runId });
      return res.status(202).json({ runId, message: 'Cancel signal sent' });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/runs/:id/report', async (req, res, next) => {
    try {
      const runId = Number(req.params.id);
      if (!Number.isFinite(runId) || runId <= 0) {
        throw AppError.validation([{ field: 'id', message: 'id must be a positive integer' }]);
      }

      const run = await getRunById(runId);
      if (!run) {
        throw new AppError({ status: 404, code: 'NOT_FOUND', message: `Run ${runId} not found` });
      }

      if (!run.reportFilePath) {
        throw new AppError({ status: 404, code: 'NOT_FOUND', message: `Report not available for run ${runId}` });
      }

      if (!fs.existsSync(run.reportFilePath)) {
        throw new AppError({ status: 404, code: 'NOT_FOUND', message: `Report file not found on disk` });
      }

      const filename = path.basename(run.reportFilePath);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      fs.createReadStream(run.reportFilePath).pipe(res);
    } catch (error) {
      return next(error);
    }
  });

  return router;
};

export default createOrchestratorRouter();
