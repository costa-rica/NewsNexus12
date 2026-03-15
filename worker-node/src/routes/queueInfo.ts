import { Router } from 'express';
import { AppError } from '../modules/errors/appError';
import { globalQueueEngine } from '../modules/queue/globalQueue';
import { GlobalQueueEngine } from '../modules/queue/queueEngine';

interface QueueInfoRouteDependencies {
  queueEngine: GlobalQueueEngine;
}

const requireJobIdParam = (rawJobId: unknown): string => {
  if (typeof rawJobId !== 'string' || rawJobId.trim() === '') {
    throw AppError.validation([
      {
        field: 'jobId',
        message: 'jobId route parameter is required'
      }
    ]);
  }

  return rawJobId.trim();
};

const requireEndpointNameQuery = (rawEndpointName: unknown): string => {
  if (typeof rawEndpointName !== 'string' || rawEndpointName.trim() === '') {
    throw AppError.validation([
      {
        field: 'endpointName',
        message: 'endpointName query parameter is required'
      }
    ]);
  }

  return rawEndpointName.trim();
};

/**
 * queue-info method mapping:
 * - GET /check-status/:jobId
 * - GET /latest-job
 * - GET /queue_status
 * - POST /cancel_job/:jobId
 */
export const createQueueInfoRouter = (
  dependencies: QueueInfoRouteDependencies = { queueEngine: globalQueueEngine }
): Router => {
  const router = Router();
  const { queueEngine } = dependencies;

  router.get('/check-status/:jobId', async (req, res, next) => {
    try {
      const jobId = requireJobIdParam(req.params.jobId);
      const jobRecord = await queueEngine.getCheckStatus(jobId);

      if (!jobRecord) {
        throw new AppError({
          status: 404,
          code: 'NOT_FOUND',
          message: `Job not found: ${jobId}`
        });
      }

      return res.status(200).json({ job: jobRecord });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/latest-job', async (req, res, next) => {
    try {
      const endpointName = requireEndpointNameQuery(req.query.endpointName);
      const jobRecord = await queueEngine.getLatestJobByEndpointName(endpointName);

      return res.status(200).json({ job: jobRecord });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/queue_status', async (_req, res, next) => {
    try {
      const queueStatus = await queueEngine.getQueueStatusView();
      return res.status(200).json(queueStatus);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/cancel_job/:jobId', async (req, res, next) => {
    try {
      const jobId = requireJobIdParam(req.params.jobId);
      const result = await queueEngine.cancelJob(jobId);

      if (result.outcome === 'not_found') {
        throw new AppError({
          status: 404,
          code: 'NOT_FOUND',
          message: `Job not found: ${jobId}`
        });
      }

      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  return router;
};

export default createQueueInfoRouter();
