import { Request, Response, NextFunction } from 'express';
import { getActiveOrchestratorRunId } from '../orchestrator/activeRunGuard';
import logger from '../logger';

export const orchestratorLockMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const activeRunId = await getActiveOrchestratorRunId();

    if (activeRunId === null) {
      return next();
    }

    const headerRunId = req.headers['x-orchestrator-run-id'];
    if (headerRunId !== undefined && String(headerRunId) === String(activeRunId)) {
      return next();
    }

    logger.info('orchestratorLock: blocking external start-job request while run is active', {
      orchestratorRunId: activeRunId,
      path: req.path,
    });

    res.status(423).json({
      orchestratorRunId: activeRunId,
      message:
        `An orchestrator run (id: ${activeRunId}) is currently in progress. ` +
        'External start-job requests are blocked until the run completes.',
    });
  } catch (err) {
    logger.warn('orchestratorLock: guard check failed, allowing request through', {
      error: err instanceof Error ? err.message : String(err),
    });
    next();
  }
};
