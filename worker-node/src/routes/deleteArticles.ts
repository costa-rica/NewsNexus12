import { Router } from 'express';
import { AppError } from '../modules/errors/appError';
import { QueueJobHandler } from '../modules/queue/queueEngine';
import { GlobalQueueEngine } from '../modules/queue/queueEngine';
import { globalQueueEngine } from '../modules/queue/globalQueue';
import {
  createDeleteArticlesJobHandler,
  DeleteArticlesJobInput
} from '../modules/jobs/deleteArticlesJob';
import logger from '../modules/logger';

interface DeleteArticlesRouteDependencies {
  queueEngine: GlobalQueueEngine;
  buildJobHandler: (input: DeleteArticlesJobInput) => QueueJobHandler;
}

const parseOptionalPositiveInt = (value: unknown, field: string): number | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw AppError.validation([
      { field, message: `${field} must be a positive integer when provided` }
    ]);
  }
  return value;
};

export const createDeleteArticlesRouter = (
  dependencies: DeleteArticlesRouteDependencies = {
    queueEngine: globalQueueEngine,
    buildJobHandler: createDeleteArticlesJobHandler
  }
): Router => {
  const router = Router();
  const { queueEngine, buildJobHandler } = dependencies;

  router.post('/start-job', async (req, res, next) => {
    try {
      const endpointName = '/delete-articles/start-job';
      const body = (req.body ?? {}) as Record<string, unknown>;

      const daysOld = parseOptionalPositiveInt(body.daysOld, 'daysOld');
      const trimCount = parseOptionalPositiveInt(body.trimCount, 'trimCount');
      const batchSize = parseOptionalPositiveInt(body.batchSize, 'batchSize');

      logger.info('Received delete articles start request', {
        endpointName,
        daysOld,
        trimCount,
        batchSize
      });

      const enqueueResult = await queueEngine.enqueueJob({
        endpointName,
        run: buildJobHandler({ daysOld, trimCount, batchSize })
      });

      logger.info('Queued delete articles job', {
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

export default createDeleteArticlesRouter();
