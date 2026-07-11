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
import {
  resolveStateAssignerAiConfig,
  StateAssignerAiConfig
} from '../modules/state-assigner/config';

export interface StateAssignerStartInput extends ArticleAutomationTargetingInput {
  aiConfig: StateAssignerAiConfig;
  pathToStateAssignerFiles: string;
}

interface StateAssignerRouteDependencies {
  queueEngine: GlobalQueueEngine;
  env: NodeJS.ProcessEnv;
  buildJobHandler: (input: StateAssignerStartInput) => QueueJobHandler;
  resolveAiConfig?: typeof resolveStateAssignerAiConfig;
}

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
    buildJobHandler: createStateAssignerJobHandler,
    resolveAiConfig: resolveStateAssignerAiConfig
  }
): Router => {
  const router = Router();
  const {
    queueEngine,
    env,
    buildJobHandler,
    resolveAiConfig = resolveStateAssignerAiConfig
  } = dependencies;

  router.post('/start-job', async (req, res, next) => {
    try {
      const endpointName = '/state-assigner/start-job';
      const aiConfig = resolveAiConfig(env);
      const pathToStateAssignerFiles = resolveStateAssignerFilesPath(env);
      const body = validateArticleAutomationTargetingInput(req.body);

      logger.info('Received state assigner start request', {
        endpointName,
        targetArticleThresholdDaysOld: body.targetArticleThresholdDaysOld,
        targetArticleStateReviewCount: body.targetArticleStateReviewCount,
        backend: aiConfig.backend,
        modelName: aiConfig.modelName,
        pathToStateAssignerFiles
      });

      const enqueueResult = await queueEngine.enqueueJob({
        endpointName,
        run: buildJobHandler({
          ...body,
          aiConfig,
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
