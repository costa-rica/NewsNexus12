import { Router } from 'express';
import { AppError } from '../modules/errors/appError';
import { QueueJobHandler } from '../modules/queue/queueEngine';
import { createStateAssignerJobHandler } from '../modules/jobs/stateAssignerJob';
import { globalQueueEngine } from '../modules/queue/globalQueue';
import { GlobalQueueEngine } from '../modules/queue/queueEngine';
import logger from '../modules/logger';

interface StateAssignerRouteDependencies {
  queueEngine: GlobalQueueEngine;
  env: NodeJS.ProcessEnv;
  buildJobHandler: (input: {
    targetArticleThresholdDaysOld: number;
    targetArticleStateReviewCount: number;
    keyOpenAi: string;
    pathToStateAssignerFiles: string;
  }) => QueueJobHandler;
}

const parsePositiveIntegerField = (
  value: unknown,
  field: 'targetArticleThresholdDaysOld' | 'targetArticleStateReviewCount'
): number | null => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
};

const validateStartJobBody = (body: unknown): {
  targetArticleThresholdDaysOld: number;
  targetArticleStateReviewCount: number;
} => {
  const candidate = body as Record<string, unknown>;

  const thresholdDays = parsePositiveIntegerField(
    candidate?.targetArticleThresholdDaysOld,
    'targetArticleThresholdDaysOld'
  );
  const reviewCount = parsePositiveIntegerField(
    candidate?.targetArticleStateReviewCount,
    'targetArticleStateReviewCount'
  );

  const details: Array<{ field: string; message: string }> = [];

  if (thresholdDays === null) {
    details.push({
      field: 'targetArticleThresholdDaysOld',
      message: 'targetArticleThresholdDaysOld must be a positive integer'
    });
  }

  if (reviewCount === null) {
    details.push({
      field: 'targetArticleStateReviewCount',
      message: 'targetArticleStateReviewCount must be a positive integer'
    });
  }

  if (details.length > 0) {
    throw AppError.validation(details);
  }

  return {
    targetArticleThresholdDaysOld: thresholdDays!,
    targetArticleStateReviewCount: reviewCount!
  };
};

const resolveOpenAiKey = (env: NodeJS.ProcessEnv): string => {
  const value = env.KEY_OPEN_AI;

  if (!value || value.trim() === '') {
    throw AppError.validation([
      {
        field: 'KEY_OPEN_AI',
        message: 'KEY_OPEN_AI env var is required'
      }
    ]);
  }

  return value.trim();
};

const resolveStateAssignerFilesPath = (env: NodeJS.ProcessEnv): string => {
  const value = env.PATH_TO_STATE_ASSIGNER_FILES;

  if (!value || value.trim() === '') {
    throw AppError.validation([
      {
        field: 'PATH_TO_STATE_ASSIGNER_FILES',
        message: 'PATH_TO_STATE_ASSIGNER_FILES env var is required'
      }
    ]);
  }

  return value.trim();
};

export const createStateAssignerRouter = (
  dependencies: StateAssignerRouteDependencies = {
    queueEngine: globalQueueEngine,
    env: process.env,
    buildJobHandler: createStateAssignerJobHandler
  }
): Router => {
  const router = Router();
  const { queueEngine, env, buildJobHandler } = dependencies;

  router.post('/start-job', async (req, res, next) => {
    try {
      const endpointName = '/state-assigner/start-job';
      const openAiKey = resolveOpenAiKey(env);
      const pathToStateAssignerFiles = resolveStateAssignerFilesPath(env);
      const body = validateStartJobBody(req.body);

      logger.info('Received state assigner start request', {
        endpointName,
        targetArticleThresholdDaysOld: body.targetArticleThresholdDaysOld,
        targetArticleStateReviewCount: body.targetArticleStateReviewCount,
        pathToStateAssignerFiles
      });

      const enqueueResult = await queueEngine.enqueueJob({
        endpointName,
        run: buildJobHandler({
          targetArticleThresholdDaysOld: body.targetArticleThresholdDaysOld,
          targetArticleStateReviewCount: body.targetArticleStateReviewCount,
          keyOpenAi: openAiKey,
          pathToStateAssignerFiles
        })
      });

      logger.info('Queued state assigner job', {
        endpointName,
        jobId: enqueueResult.jobId,
        status: enqueueResult.status
      });

      return res.status(202).json({
        jobId: enqueueResult.jobId,
        status: enqueueResult.status,
        endpointName
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
};

export default createStateAssignerRouter();
