import { Router } from 'express';
import { AppError } from '../modules/errors/appError';
import { QueueJobHandler } from '../modules/queue/queueEngine';
import { createStateAssignerJobHandler } from '../modules/jobs/stateAssignerJob';
import { globalQueueEngine } from '../modules/queue/globalQueue';
import { GlobalQueueEngine } from '../modules/queue/queueEngine';
import logger from '../modules/logger';
import {
  ArticleAutomationTargetingInput,
  validateArticleAutomationTargetingInput
} from '../modules/articleTargeting';

export interface StateAssignerStartInput extends ArticleAutomationTargetingInput {
  keyOpenAi: string;
  pathToStateAssignerFiles: string;
}

interface StateAssignerRouteDependencies {
  queueEngine: GlobalQueueEngine;
  env: NodeJS.ProcessEnv;
  buildJobHandler: (input: StateAssignerStartInput) => QueueJobHandler;
}

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
      const body = validateArticleAutomationTargetingInput(req.body);

      logger.info('Received state assigner start request', {
        endpointName,
        targetArticleThresholdDaysOld: body.targetArticleThresholdDaysOld,
        targetArticleStateReviewCount: body.targetArticleStateReviewCount,
        pathToStateAssignerFiles
      });

      const enqueueResult = await queueEngine.enqueueJob({
        endpointName,
        run: buildJobHandler({
          ...body,
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
