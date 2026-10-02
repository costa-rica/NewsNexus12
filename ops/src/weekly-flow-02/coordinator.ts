import type { OpsConfig } from '../config';
import { ClearDuplicateAnalysesError } from './phases/01_clearDuplicateAnalysesRequest';
import {
  clearDuplicateAnalyses,
  type WorkerRequest
} from './phases/01_clearDuplicateAnalyses';
import {
  createDatabaseBackup,
  type CreateDatabaseBackupResult
} from './phases/02_createDatabaseBackup';
import { CreateDatabaseBackupError } from './phases/02_createDatabaseBackupCommand';
import {
  deleteOldArticles,
  type DeleteOldArticlesResult
} from './phases/03_deleteOldArticles';
import { DeleteOldArticlesError } from './phases/03_deleteOldArticlesCommand';

export interface CoordinatorLogger {
  info(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

type CreateBackup = (
  config: Pick<OpsConfig, 'dbManagerBackupTimeoutSeconds'>
) => Promise<CreateDatabaseBackupResult>;

type DeleteArticles = (
  config: Pick<OpsConfig, 'dbManagerDeleteArticlesTimeoutSeconds'>
) => Promise<DeleteOldArticlesResult>;

export interface CoordinatorDependencies {
  request: WorkerRequest;
  createBackup: CreateBackup;
  deleteArticles: DeleteArticles;
}

const productionDependencies: CoordinatorDependencies = {
  request: globalThis.fetch,
  createBackup: createDatabaseBackup,
  deleteArticles: deleteOldArticles
};

export async function runCoordinator(
  logger: CoordinatorLogger,
  config: OpsConfig,
  dependencies: Partial<CoordinatorDependencies> = {}
): Promise<void> {
  const request = dependencies.request ?? productionDependencies.request;
  const createBackup = dependencies.createBackup ?? productionDependencies.createBackup;
  const deleteArticles = dependencies.deleteArticles ?? productionDependencies.deleteArticles;
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

  logger.info('Phase 2 started: creating database backup', { phase: 2 });

  try {
    const result = await createBackup(config);
    logger.info('Phase 2 completed: database backup created and verified', {
      phase: 2,
      backupPath: result.backupPath,
      byteSize: result.byteSize,
      sha256: result.sha256,
      reportedManifestVersion: result.manifestVersion
    });
  } catch (error: unknown) {
    logger.error('Phase 2 failed: database backup was not verified', {
      phase: 2,
      failureCategory:
        error instanceof CreateDatabaseBackupError ? error.category : 'unknown',
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }

  logger.info('Phase 3 started: deleting old unprotected articles', { phase: 3 });

  try {
    const result = await deleteArticles(config);
    logger.info('Phase 3 completed: old unprotected articles deleted', {
      phase: 3,
      daysOldThreshold: result.daysOldThreshold,
      cutoffDate: result.cutoffDate,
      eligibleCount: result.eligibleCount,
      processedCount: result.processedCount,
      deletedCount: result.deletedCount
    });
  } catch (error: unknown) {
    logger.error('Phase 3 failed: old-article deletion was not verified', {
      phase: 3,
      failureCategory:
        error instanceof DeleteOldArticlesError ? error.category : 'unknown',
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }

  logger.info('Weekly pipeline stopped before phase 4; phase 4 is not implemented');
}
