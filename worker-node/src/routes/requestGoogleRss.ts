import { Router } from 'express';
import { AppError } from '../modules/errors/appError';
import { QueueJobHandler } from '../modules/queue/queueEngine';
import {
  createRequestGoogleRssJobHandler,
  DEFAULT_REQUEST_GOOGLE_RSS_REPEAT_WINDOW_HOURS,
  RequestGoogleRssJobInput,
  verifySpreadsheetFileExists
} from '../modules/jobs/requestGoogleRssJob';
import { globalQueueEngine } from '../modules/queue/globalQueue';
import { GlobalQueueEngine } from '../modules/queue/queueEngine';
import logger from '../modules/logger';
import ensureDbReady from '../modules/db/ensureDbReady';
import { WeeklyArticleFlowRun } from '@newsnexus/db-models';

interface RequestGoogleRssRouteDependencies {
  queueEngine: GlobalQueueEngine;
  env: NodeJS.ProcessEnv;
  buildJobHandler: (input: RequestGoogleRssJobInput) => QueueJobHandler;
  findWeeklyRunByPk?: (id: number) => Promise<{ status: string } | null>;
  ensureDatabaseReady?: () => Promise<void>;
}

const resolveSpreadsheetPathFromEnv = (env: NodeJS.ProcessEnv): string => {
  const value = env.PATH_AND_FILENAME_FOR_QUERY_SPREADSHEET_AUTOMATED;
  if (!value || value.trim() === '') {
    throw AppError.validation([
      {
        field: 'PATH_AND_FILENAME_FOR_QUERY_SPREADSHEET_AUTOMATED',
        message: 'PATH_AND_FILENAME_FOR_QUERY_SPREADSHEET_AUTOMATED env var is required'
      }
    ]);
  }

  return value.trim();
};

const resolveDoNotRepeatRequestsWithinHours = (body: unknown): number => {
  const rawValue =
    typeof body === 'object' && body !== null && 'doNotRepeatRequestsWithinHours' in body
      ? body.doNotRepeatRequestsWithinHours
      : undefined;

  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return DEFAULT_REQUEST_GOOGLE_RSS_REPEAT_WINDOW_HOURS;
  }

  const parsed =
    typeof rawValue === 'number'
      ? rawValue
      : typeof rawValue === 'string'
        ? Number.parseInt(rawValue, 10)
        : Number.NaN;

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw AppError.validation([
      {
        field: 'doNotRepeatRequestsWithinHours',
        message: 'doNotRepeatRequestsWithinHours must be a non-negative integer'
      }
    ]);
  }

  return parsed;
};

const resolveTargetArticlesAddedCount = (body: unknown): number | undefined => {
  const rawValue =
    typeof body === 'object' && body !== null && 'targetArticlesAddedCount' in body
      ? body.targetArticlesAddedCount
      : undefined;

  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return undefined;
  }

  const parsed =
    typeof rawValue === 'number'
      ? rawValue
      : typeof rawValue === 'string'
        ? Number.parseInt(rawValue, 10)
        : Number.NaN;

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw AppError.validation([
      {
        field: 'targetArticlesAddedCount',
        message: 'targetArticlesAddedCount must be a positive integer when provided'
      }
    ]);
  }

  return parsed;
};

const resolveWeeklyArticleFlowRunId = (body: unknown): number | undefined => {
  const rawValue =
    typeof body === 'object' && body !== null && 'weeklyArticleFlowRunId' in body
      ? body.weeklyArticleFlowRunId
      : undefined;
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return undefined;
  }
  if (
    (typeof rawValue !== 'number' && typeof rawValue !== 'string') ||
    (typeof rawValue === 'string' && !/^\d+$/.test(rawValue))
  ) {
    throw AppError.validation([{ field: 'weeklyArticleFlowRunId', message: 'weeklyArticleFlowRunId must be a positive integer' }]);
  }
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw AppError.validation([{ field: 'weeklyArticleFlowRunId', message: 'weeklyArticleFlowRunId must be a positive integer' }]);
  }
  return parsed;
};

export const createRequestGoogleRssRouter = (
  dependencies: RequestGoogleRssRouteDependencies = {
    queueEngine: globalQueueEngine,
    env: process.env,
    buildJobHandler: createRequestGoogleRssJobHandler
  }
): Router => {
  const router = Router();
  const { queueEngine, env, buildJobHandler } = dependencies;
  const findWeeklyRunByPk = dependencies.findWeeklyRunByPk ?? ((id: number) => WeeklyArticleFlowRun.findByPk(id));
  const ensureDatabaseReady = dependencies.ensureDatabaseReady ?? ensureDbReady;

  router.post('/start-job', async (req, res, next) => {
    try {
      const endpointName = '/request-google-rss/start-job';
      const spreadsheetPath = resolveSpreadsheetPathFromEnv(env);
      const doNotRepeatRequestsWithinHours = resolveDoNotRepeatRequestsWithinHours(req.body);
      const targetArticlesAddedCount = resolveTargetArticlesAddedCount(req.body);
      const weeklyArticleFlowRunId = resolveWeeklyArticleFlowRunId(req.body);
      if (weeklyArticleFlowRunId !== undefined) {
        await ensureDatabaseReady();
        const run = await findWeeklyRunByPk(weeklyArticleFlowRunId);
        if (!run || !['pending', 'running'].includes(run.status)) {
          throw AppError.validation([{ field: 'weeklyArticleFlowRunId', message: 'weeklyArticleFlowRunId must reference an active weekly run' }]);
        }
      }
      await verifySpreadsheetFileExists(spreadsheetPath);

      logger.info('Received Request Google RSS start request', {
        endpointName,
        spreadsheetPath,
        doNotRepeatRequestsWithinHours,
        targetArticlesAddedCount,
        weeklyArticleFlowRunId
      });

      const enqueueResult = await queueEngine.enqueueJob({
        endpointName,
        parameters: {
          doNotRepeatRequestsWithinHours,
          ...(targetArticlesAddedCount !== undefined ? { targetArticlesAddedCount } : {}),
          ...(weeklyArticleFlowRunId !== undefined ? { weeklyArticleFlowRunId } : {})
        },
        run: buildJobHandler({
          spreadsheetPath,
          doNotRepeatRequestsWithinHours,
          ...(targetArticlesAddedCount !== undefined ? { targetArticlesAddedCount } : {}),
          ...(weeklyArticleFlowRunId !== undefined ? { weeklyArticleFlowRunId } : {})
        })
      });

      logger.info('Queued Request Google RSS job', {
        endpointName,
        jobId: enqueueResult.jobId,
        status: enqueueResult.status,
        doNotRepeatRequestsWithinHours,
        targetArticlesAddedCount,
        weeklyArticleFlowRunId
      });

      return res.status(202).json({
        jobId: enqueueResult.jobId,
        status: enqueueResult.status,
        endpointName
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return next(
          new AppError({
            status: 404,
            code: 'NOT_FOUND',
            message: (error as Error).message
          })
        );
      }

      if (error instanceof Error && error.message.includes('Spreadsheet file not found')) {
        return next(
          new AppError({
            status: 404,
            code: 'NOT_FOUND',
            message: error.message
          })
        );
      }

      return next(error);
    }
  });

  return router;
};

export default createRequestGoogleRssRouter();
