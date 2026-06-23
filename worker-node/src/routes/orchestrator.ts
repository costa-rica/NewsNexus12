import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../modules/errors/appError';
import {
  startCoordinator,
  requestCancel,
  getActiveCoordinator,
} from '../modules/orchestrator/coordinator';
import type { OrchestratorConfig, OrchestratorTestConfig } from '../modules/orchestrator/types';
import { getActiveOrchestratorRunId, invalidateActiveRunCache } from '../modules/orchestrator/activeRunGuard';
import {
  getRunWithSteps,
  getRunById,
  listRuns,
  listActiveContinuationSourceRunIds,
} from '../modules/orchestrator/repository';
import {
  assessContinuationForRun,
  buildCheapContinuationSignal,
} from '../modules/orchestrator/continuationAssessment';
import logger from '../modules/logger';

const DEFAULT_TEST_CONFIG: OrchestratorTestConfig = {
  deleteTrimCount: 100,
  targetArticlesAddedCount: 10,
  downstreamArticleCount: 10,
};

const parseOptionalPositiveInteger = (
  value: unknown,
  field: string,
  details: Array<{ field: string; message: string }>
): number | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    details.push({ field, message: `${field} must be a positive integer when provided` });
    return undefined;
  }
  return value;
};

const parseOptionalNonNegativeInteger = (
  value: unknown,
  field: string,
  details: Array<{ field: string; message: string }>
): number | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    details.push({ field, message: `${field} must be a non-negative integer when provided` });
    return undefined;
  }
  return value;
};

const parseStartConfig = (body: Record<string, unknown>): OrchestratorConfig => {
  const mode = body.mode === 'abbreviated_test' ? 'abbreviated_test' : 'weekly';
  const aiApproverEnabled =
    typeof body.aiApproverEnabled === 'boolean' ? body.aiApproverEnabled : true;
  const semanticScorerEnabled =
    typeof body.semanticScorerEnabled === 'boolean' ? body.semanticScorerEnabled : true;

  if (mode !== 'abbreviated_test') {
    return { mode, aiApproverEnabled, semanticScorerEnabled };
  }

  const details: Array<{ field: string; message: string }> = [];
  const rawTestConfig =
    typeof body.testConfig === 'object' && body.testConfig !== null
      ? body.testConfig as Record<string, unknown>
      : {};

  const deleteTrimCount = parseOptionalPositiveInteger(
    rawTestConfig.deleteTrimCount,
    'testConfig.deleteTrimCount',
    details
  );
  const targetArticlesAddedCount = parseOptionalPositiveInteger(
    rawTestConfig.targetArticlesAddedCount,
    'testConfig.targetArticlesAddedCount',
    details
  );
  const downstreamArticleCount = parseOptionalPositiveInteger(
    rawTestConfig.downstreamArticleCount,
    'testConfig.downstreamArticleCount',
    details
  );
  const doNotRepeatRequestsWithinHours = parseOptionalNonNegativeInteger(
    rawTestConfig.doNotRepeatRequestsWithinHours,
    'testConfig.doNotRepeatRequestsWithinHours',
    details
  );

  if (details.length > 0) {
    throw AppError.validation(details);
  }

  return {
    mode,
    aiApproverEnabled,
    semanticScorerEnabled,
    testConfig: {
      deleteTrimCount: deleteTrimCount ?? DEFAULT_TEST_CONFIG.deleteTrimCount,
      targetArticlesAddedCount:
        targetArticlesAddedCount ?? DEFAULT_TEST_CONFIG.targetArticlesAddedCount,
      downstreamArticleCount: downstreamArticleCount ?? DEFAULT_TEST_CONFIG.downstreamArticleCount,
      ...(doNotRepeatRequestsWithinHours !== undefined ? { doNotRepeatRequestsWithinHours } : {}),
    },
  };
};

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
      const config = parseStartConfig(body);

      const userId = typeof body.userId === 'number' ? body.userId : null;

      logger.info('orchestrator: start request received', {
        mode: config.mode,
        aiApproverEnabled: config.aiApproverEnabled,
        semanticScorerEnabled: config.semanticScorerEnabled,
        testConfig: config.testConfig,
        userId
      });

      const runId = await startCoordinator(config, userId);
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
      const [activeRunId, activeContinuationSourceRunIds] = await Promise.all([
        getActiveOrchestratorRunId(),
        listActiveContinuationSourceRunIds(runs.map((run) => run.id)),
      ]);
      const activeContinuationSourceRunIdSet = new Set(activeContinuationSourceRunIds);
      const runsWithContinuationSignal = runs.map((run) => ({
        ...run,
        ...buildCheapContinuationSignal(
          run,
          activeRunId,
          activeContinuationSourceRunIdSet.has(run.id)
        ),
      }));

      return res.status(200).json({ runs: runsWithContinuationSignal });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/runs/:id/continuation-assessment', async (req, res, next) => {
    try {
      const runId = Number(req.params.id);
      if (!Number.isFinite(runId) || runId <= 0) {
        throw AppError.validation([{ field: 'id', message: 'id must be a positive integer' }]);
      }

      const result = await assessContinuationForRun(runId);
      if (!result.found || !result.assessment) {
        throw new AppError({ status: 404, code: 'NOT_FOUND', message: `Run ${runId} not found` });
      }

      return res.status(200).json(result.assessment);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/runs/:id/continue', async (req, res, next) => {
    try {
      const runId = Number(req.params.id);
      if (!Number.isFinite(runId) || runId <= 0) {
        throw AppError.validation([{ field: 'id', message: 'id must be a positive integer' }]);
      }

      const result = await assessContinuationForRun(runId);
      if (!result.found || !result.assessment) {
        throw new AppError({ status: 404, code: 'NOT_FOUND', message: `Run ${runId} not found` });
      }

      const { assessment } = result;
      if (!assessment.eligible) {
        const unsupportedReasonCodes = new Set([
          'report_only_continuation_deferred',
          'unrecognized_failure_shape',
          'source_is_continuation',
        ]);
        const status = unsupportedReasonCodes.has(assessment.reasonCode) ? 422 : 409;
        return res.status(status).json(assessment);
      }

      // Phase 5 owns creating and starting continuation runs, including the 202 success path.
      return res.status(422).json({
        ...assessment,
        eligible: false,
        reasonCode: 'continuation_creation_deferred',
        blockingReasons: ['Continuation run creation is deferred to Phase 5.'],
      });
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
