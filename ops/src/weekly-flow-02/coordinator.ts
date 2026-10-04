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
import {
  CollectGoogleNewsRssError,
  collectGoogleNewsRss,
  createGoogleNewsRssWorker,
  type CollectGoogleNewsRssDependencies,
  type CollectGoogleNewsRssResult,
  type GoogleNewsRssWorker
} from './phases/04_collectGoogleNewsRss';
import { GoogleNewsRssClientError } from './phases/04_googleNewsRssClient';
import type { WeeklyFlowInvocation } from './cli';
import {
  WeeklyFlowPersistenceError,
  persistenceErrorDiagnostics,
  type JsonRecord,
  type WeeklyFlowFailure,
  type WeeklyFlowPersistence,
  type WeeklyFlowPhase,
  type WeeklyFlowRunRecord
} from './persistence';
import { selectWeeklyFlowRun } from './runSelection';

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

type CollectRss = (
  run: WeeklyFlowRunRecord,
  config: OpsConfig,
  dependencies: CollectGoogleNewsRssDependencies
) => Promise<CollectGoogleNewsRssResult>;

export interface CoordinatorDependencies {
  request: WorkerRequest;
  createBackup: CreateBackup;
  deleteArticles: DeleteArticles;
  collectRss: CollectRss;
  rssWorker: GoogleNewsRssWorker;
  delay: (milliseconds: number) => Promise<void>;
  persistence: WeeklyFlowPersistence;
  invocation: WeeklyFlowInvocation;
  now: () => Date;
}

const productionPhaseDependencies: Pick<
  CoordinatorDependencies,
  'request' | 'createBackup' | 'deleteArticles'
> = {
  request: globalThis.fetch,
  createBackup: createDatabaseBackup,
  deleteArticles: deleteOldArticles
};

const defaultInvocation: WeeklyFlowInvocation = { mode: 'default' };
const currentTime = (): Date => new Date();
const delay = async (milliseconds: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
};

const phaseFailureCategory = (phase: WeeklyFlowPhase, error: unknown): string => {
  if (phase === 1 && error instanceof ClearDuplicateAnalysesError) return error.category;
  if (phase === 2 && error instanceof CreateDatabaseBackupError) return error.category;
  if (phase === 3 && error instanceof DeleteOldArticlesError) return error.category;
  if (phase === 4 && error instanceof CollectGoogleNewsRssError) return error.category;
  if (phase === 4 && error instanceof GoogleNewsRssClientError) return error.category;
  if (error instanceof WeeklyFlowPersistenceError) return 'persistence';
  return 'unknown';
};

const failureMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const recordFailure = async (
  persistence: WeeklyFlowPersistence,
  logger: CoordinatorLogger,
  runId: number,
  phase: WeeklyFlowPhase,
  error: unknown,
  now: () => Date
): Promise<void> => {
  const failure: WeeklyFlowFailure = {
    phase,
    category: phaseFailureCategory(phase, error),
    message: failureMessage(error),
    failedAt: now()
  };
  try {
    await persistence.recordFailure(runId, failure);
  } catch (persistenceError: unknown) {
    logger.error('Weekly pipeline failure could not be persisted', {
      runId,
      phase,
      error: failureMessage(persistenceError),
      ...persistenceErrorDiagnostics(persistenceError)
    });
    throw persistenceError;
  }
};

const candidateForInvocation = async (
  persistence: WeeklyFlowPersistence,
  invocation: WeeklyFlowInvocation
): Promise<WeeklyFlowRunRecord | null> => {
  if (invocation.mode === 'new') return null;
  if (invocation.mode === 'continue' && invocation.runId !== null) {
    return persistence.getRunById(invocation.runId);
  }
  return persistence.getLatestRun();
};

const selectOrCreateRun = async (
  persistence: WeeklyFlowPersistence,
  invocation: WeeklyFlowInvocation,
  now: () => Date
): Promise<{ run: WeeklyFlowRunRecord; reason: string; continued: boolean }> => {
  const selectionTime = now();
  const candidate = await candidateForInvocation(persistence, invocation);
  const selection = selectWeeklyFlowRun(invocation, candidate, selectionTime);
  if (selection.action === 'continue') {
    return { run: selection.run, reason: selection.reason, continued: true };
  }
  return {
    run: await persistence.createRun(selectionTime),
    reason: selection.reason,
    continued: false
  };
};

export async function runCoordinator(
  logger: CoordinatorLogger,
  config: OpsConfig,
  dependencies: Pick<CoordinatorDependencies, 'persistence'> &
    Partial<Omit<CoordinatorDependencies, 'persistence'>>
): Promise<void> {
  const request = dependencies.request ?? productionPhaseDependencies.request;
  const createBackup = dependencies.createBackup ?? productionPhaseDependencies.createBackup;
  const deleteArticles = dependencies.deleteArticles ?? productionPhaseDependencies.deleteArticles;
  const collectRss = dependencies.collectRss ?? collectGoogleNewsRss;
  const persistence = dependencies.persistence;
  const invocation = dependencies.invocation ?? defaultInvocation;
  const now = dependencies.now ?? currentTime;
  const wait = dependencies.delay ?? delay;
  const rssWorker = dependencies.rssWorker ?? createGoogleNewsRssWorker(config, request);
  logger.info('------------------------------------------------------------');
  logger.info('### Starting weekly pipeline coordinator ###');
  let selection;
  try {
    selection = await selectOrCreateRun(persistence, invocation, now);
  } catch (error: unknown) {
    logger.error('Weekly pipeline run selection failed', {
      failureCategory: error instanceof WeeklyFlowPersistenceError ? 'persistence' : 'unknown',
      error: failureMessage(error),
      ...persistenceErrorDiagnostics(error)
    });
    throw error;
  }
  let activeRun = selection.run;
  const runId = activeRun.id;
  logger.info(selection.continued ? 'Continuing weekly pipeline run' : 'Starting new weekly pipeline run', {
    runId,
    selectionReason: selection.reason,
    runStartedAt: selection.run.runStartedAt.toISOString()
  });

  if ((activeRun.lastPhaseCompleted ?? 0) < 3) {
    try {
      await persistence.recordPhaseStarted(runId, 1, now());
      logger.info('Phase 1 started: clearing duplicate analyses', { runId, phase: 1 });
      const result = await clearDuplicateAnalyses(config, request);
      const phaseResult: JsonRecord = {
        rowsDeleted: result.rowsDeleted,
        cancelledJobs: result.cancelledJobs,
        cancellationRequestedJobs: result.cancellationRequestedJobs,
        workerTimestamp: result.timestamp
      };
      activeRun = await persistence.recordPhaseCompleted(runId, 1, now(), phaseResult);
      logger.info('Phase 1 completed: duplicate analyses cleared', {
        runId,
        phase: 1,
        rowsDeleted: result.rowsDeleted,
        cancelledJobs: result.cancelledJobs,
        cancellationRequestedJobs: result.cancellationRequestedJobs,
        workerTimestamp: result.timestamp
      });
    } catch (error: unknown) {
      logger.error('Phase 1 failed: duplicate analyses were not confirmed cleared', {
        runId,
        phase: 1,
        failureCategory:
          error instanceof ClearDuplicateAnalysesError ? error.category : 'unknown',
        error: error instanceof Error ? error.message : String(error),
        ...persistenceErrorDiagnostics(error)
      });
      await recordFailure(persistence, logger, runId, 1, error, now);
      throw error;
    }

    try {
      await persistence.recordPhaseStarted(runId, 2, now());
      logger.info('Phase 2 started: creating database backup', { runId, phase: 2 });
      const result = await createBackup(config);
      const phaseResult: JsonRecord = {
        backupPath: result.backupPath,
        byteSize: result.byteSize,
        sha256: result.sha256,
        manifestVersion: result.manifestVersion
      };
      activeRun = await persistence.recordPhaseCompleted(runId, 2, now(), phaseResult, {
        backupPath: result.backupPath,
        backupByteSize: String(result.byteSize),
        backupSha256: result.sha256,
        backupManifestVersion: result.manifestVersion
      });
      logger.info('Phase 2 completed: database backup created and verified', {
        runId,
        phase: 2,
        backupPath: result.backupPath,
        byteSize: result.byteSize,
        sha256: result.sha256,
        reportedManifestVersion: result.manifestVersion
      });
    } catch (error: unknown) {
      logger.error('Phase 2 failed: database backup was not verified', {
        runId,
        phase: 2,
        failureCategory:
          error instanceof CreateDatabaseBackupError ? error.category : 'unknown',
        error: error instanceof Error ? error.message : String(error),
        ...persistenceErrorDiagnostics(error)
      });
      await recordFailure(persistence, logger, runId, 2, error, now);
      throw error;
    }

    try {
      await persistence.recordPhaseStarted(runId, 3, now());
      logger.info('Phase 3 started: deleting old unprotected articles', { runId, phase: 3 });
      const result = await deleteArticles(config);
      const phaseResult: JsonRecord = {
        daysOldThreshold: result.daysOldThreshold,
        cutoffDate: result.cutoffDate,
        eligibleCount: result.eligibleCount,
        processedCount: result.processedCount,
        deletedCount: result.deletedCount
      };
      activeRun = await persistence.recordPhaseCompleted(runId, 3, now(), phaseResult);
      logger.info('Phase 3 completed: old unprotected articles deleted', {
        runId,
        phase: 3,
        daysOldThreshold: result.daysOldThreshold,
        cutoffDate: result.cutoffDate,
        eligibleCount: result.eligibleCount,
        processedCount: result.processedCount,
        deletedCount: result.deletedCount
      });
    } catch (error: unknown) {
      logger.error('Phase 3 failed: old-article deletion was not verified', {
        runId,
        phase: 3,
        failureCategory:
          error instanceof DeleteOldArticlesError ? error.category : 'unknown',
        error: error instanceof Error ? error.message : String(error),
        ...persistenceErrorDiagnostics(error)
      });
      await recordFailure(persistence, logger, runId, 3, error, now);
      throw error;
    }
  }

  try {
    logger.info('Phase 4 started or continued: collecting Google News RSS Articles', {
      runId,
      phase: 4,
      savedJobId: activeRun.rssJobId
    });
    const result = await collectRss(activeRun, config, {
      persistence,
      worker: rssWorker,
      now,
      delay: wait,
      onEvent: (event) => {
        logger.info('Phase 4 RSS job event', { runId, phase: 4, ...event });
      }
    });
    logger.info(
      result.kind === 'zero_work'
        ? 'Phase 4 completed with no downstream Articles; weekly run completed'
        : 'Phase 4 completed; weekly pipeline stopped at the Phase 5 boundary',
      {
        runId,
        phase: 4,
        rssJobId: result.rssJobId,
        firstRssRequestId: result.firstRssRequestId,
        firstRssArticleId: result.firstRssArticleId,
        rssArticlesAddedCount: result.rssArticlesAddedCount,
        articleCount: result.articleCount,
        runCompleted: result.kind === 'zero_work'
      }
    );
  } catch (error: unknown) {
    logger.error('Phase 4 stopped without a verified RSS completion', {
      runId,
      phase: 4,
      failureCategory: phaseFailureCategory(4, error),
      error: failureMessage(error),
      ...persistenceErrorDiagnostics(error)
    });
    await recordFailure(persistence, logger, runId, 4, error, now);
    throw error;
  }
}
