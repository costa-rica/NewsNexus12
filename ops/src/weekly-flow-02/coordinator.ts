import type { OpsConfig } from '../config';
import { ClearDuplicateAnalysesError } from './phases/01_clearDuplicateAnalysesRequest';
import {
  clearDuplicateAnalyses,
  type WorkerRequest
} from './phases/01_clearDuplicateAnalyses';

export interface CoordinatorLogger {
  info(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

export async function runCoordinator(
  logger: CoordinatorLogger,
  config: OpsConfig,
  request: WorkerRequest = globalThis.fetch
): Promise<void> {
  logger.info('------------------------------------------------------------');
  logger.info('### Starting weekly pipeline coordinator ###');
  logger.info('Phase 1 started: clearing duplicate analyses', { phase: 1 });

  try {
    const result = await clearDuplicateAnalyses(config, request);
    logger.info('Phase 1 completed: duplicate analyses cleared', {
      phase: 1,
      rowsDeleted: result.rowsDeleted,
      cancelledJobs: result.cancelledJobs,
      cancellationRequestedJobs: result.cancellationRequestedJobs,
      workerTimestamp: result.timestamp
    });
  } catch (error: unknown) {
    logger.error('Phase 1 failed: duplicate analyses were not confirmed cleared', {
      phase: 1,
      failureCategory:
        error instanceof ClearDuplicateAnalysesError ? error.category : 'unknown',
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }

  logger.info('Weekly pipeline stopped before phase 2; phase 2 is not implemented');
}
