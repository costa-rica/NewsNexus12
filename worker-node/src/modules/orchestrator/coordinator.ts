import { sequelize } from '@newsnexus/db-models';
import ensureDbReady from '../db/ensureDbReady';
import { invalidateActiveRunCache } from './activeRunGuard';
import { startNodeJob, startPythonJob } from './childJobClient';
import {
  createRun,
  getRunById,
  getStepByName,
  reconcileOrphanedRuns,
  updateRunStatus,
  updateStepStatus,
} from './repository';
import { writeReport } from './reportWriter';
import type {
  OrchestratorConfig,
  OrchestratorRunRow,
  OrchestratorRunStepRow,
  OrchestratorRunStatus,
  StepConfig,
  ChildJobHandle,
} from './types';
import { STEP_DEFAULTS } from './types';
import logger from '../logger';

const POLL_INTERVAL_MS = 60_000;

interface RunningCoordinator {
  runId: number;
  abortController: AbortController;
}

let activeCoordinator: RunningCoordinator | null = null;

export const getActiveCoordinator = (): RunningCoordinator | null => activeCoordinator;

export const requestCancel = (runId: number): boolean => {
  if (!activeCoordinator || activeCoordinator.runId !== runId) {
    return false;
  }
  activeCoordinator.abortController.abort();
  return true;
};

export const startCoordinator = async (
  config: OrchestratorConfig,
  userId: number | null
): Promise<number> => {
  await ensureDbReady();

  const steps = buildStepList(config);
  const { run, runSteps } = await createRun(config, steps, userId);

  invalidateActiveRunCache();

  const ac = new AbortController();
  activeCoordinator = { runId: run.id, abortController: ac };

  void runCoordinator(run.id, runSteps, steps, ac.signal).catch((err) => {
    logger.error('coordinator: unhandled error in run loop', {
      runId: run.id,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return run.id;
};

export const runReconciliation = async (): Promise<void> => {
  await ensureDbReady();
  const count = await reconcileOrphanedRuns();
  if (count > 0) {
    logger.warn(`coordinator: reconciled ${count} orphaned running run(s) to failed`);
    invalidateActiveRunCache();
  }
};

const buildStepList = (config: OrchestratorConfig): StepConfig[] => {
  return STEP_DEFAULTS.map((s) => {
    if (s.stepName === 'ai_approver') return { ...s, enabled: config.aiApproverEnabled };
    if (s.stepName === 'semantic_scorer') return { ...s, enabled: config.semanticScorerEnabled };
    return { ...s, enabled: true };
  });
};

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });

const pollUntilDone = async (
  handle: ChildJobHandle,
  timeoutSeconds: number,
  signal: AbortSignal
): Promise<{ outcome: 'completed'; result: Record<string, unknown> | null } | { outcome: 'failed'; reason: string } | { outcome: 'canceled' } | { outcome: 'timed_out' }> => {
  const deadline = Date.now() + timeoutSeconds * 1000;

  while (true) {
    if (signal.aborted) return { outcome: 'canceled' };
    if (Date.now() >= deadline) return { outcome: 'timed_out' };

    const poll = await handle.poll();

    if (poll.status === 'completed') return { outcome: 'completed', result: poll.result };
    if (poll.status === 'failed') return { outcome: 'failed', reason: poll.reason };
    if (poll.status === 'canceled') return { outcome: 'canceled' };

    try {
      await sleep(POLL_INTERVAL_MS, signal);
    } catch {
      return { outcome: 'canceled' };
    }
  }
};

const captureMaxArticleId = async (): Promise<number> => {
  const [[row]] = await sequelize.query(
    'SELECT COALESCE(MAX(id), 0) AS max_id FROM "Articles"',
    { raw: true }
  ) as [Array<{ max_id: number }>, unknown];
  return Number(row.max_id ?? 0);
};

const startChildJob = async (
  stepConfig: StepConfig,
  runId: number,
  _signal: AbortSignal
): Promise<ChildJobHandle> => {
  if (stepConfig.worker === 'python') {
    return startPythonJob(stepConfig.endpointName, {}, runId);
  }
  return startNodeJob(stepConfig.endpointName, {}, runId);
};

const runCoordinator = async (
  runId: number,
  runSteps: OrchestratorRunStepRow[],
  stepConfigs: StepConfig[],
  signal: AbortSignal
): Promise<void> => {
  let articleIdMinExclusive: number | null = null;
  let articleIdMaxInclusive: number | null = null;
  let finalStatus: OrchestratorRunStatus = 'completed';
  let failureReason: string | undefined;

  try {
    for (const stepConfig of stepConfigs) {
      if (stepConfig.stepName === 'report') continue;

      const stepRow = runSteps.find((s) => s.stepName === stepConfig.stepName);
      if (!stepRow) continue;

      if (!stepConfig.enabled) {
        await updateStepStatus(stepRow.id, 'skipped');
        continue;
      }

      if (signal.aborted) {
        await updateStepStatus(stepRow.id, 'canceled');
        continue;
      }

      logger.info('coordinator: starting step', { runId, step: stepConfig.stepName });
      await updateStepStatus(stepRow.id, 'running', { startedAt: new Date() });

      if (stepConfig.stepName === 'google_rss') {
        articleIdMinExclusive = await captureMaxArticleId();
        await updateRunStatus(runId, 'running', { articleIdMinExclusive });
      }

      let handle: ChildJobHandle;
      try {
        handle = await startChildJob(stepConfig, runId, signal);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('coordinator: failed to start child job', { runId, step: stepConfig.stepName, error: msg });
        await updateStepStatus(stepRow.id, 'failed', {
          endedAt: new Date(),
          endingReason: 'start_failed',
          endingMessage: msg,
        });
        finalStatus = 'failed';
        failureReason = `Step ${stepConfig.stepName} failed to start: ${msg}`;
        break;
      }

      await updateStepStatus(stepRow.id, 'running', { childJobId: handle.jobId });

      const pollResult = await pollUntilDone(handle, stepConfig.timeoutSeconds, signal);

      if (pollResult.outcome === 'timed_out') {
        logger.warn('coordinator: step timed out', { runId, step: stepConfig.stepName });
        await handle.cancel().catch(() => undefined);
        await updateStepStatus(stepRow.id, 'timed_out', {
          endedAt: new Date(),
          endingReason: 'timeout',
          endingMessage: `Step exceeded ${stepConfig.timeoutSeconds}s timeout`,
        });
        finalStatus = 'timed_out';
        failureReason = `Step ${stepConfig.stepName} timed out`;
        break;
      }

      if (pollResult.outcome === 'canceled') {
        logger.info('coordinator: step canceled', { runId, step: stepConfig.stepName });
        await handle.cancel().catch(() => undefined);
        await updateStepStatus(stepRow.id, 'canceled', { endedAt: new Date() });
        finalStatus = 'canceled';
        break;
      }

      if (pollResult.outcome === 'failed') {
        logger.warn('coordinator: step failed', { runId, step: stepConfig.stepName, reason: pollResult.reason });
        await updateStepStatus(stepRow.id, 'failed', {
          endedAt: new Date(),
          endingReason: 'job_failed',
          endingMessage: pollResult.reason,
        });
        finalStatus = 'failed';
        failureReason = `Step ${stepConfig.stepName} failed: ${pollResult.reason}`;
        break;
      }

      const stepResult = 'result' in pollResult ? (pollResult.result ?? undefined) : undefined;
      await updateStepStatus(stepRow.id, 'completed', {
        endedAt: new Date(),
        endingReason: 'completed',
        ...(stepResult != null ? { result: stepResult as Record<string, unknown> } : {}),
      });

      if (stepConfig.stepName === 'google_rss') {
        articleIdMaxInclusive = await captureMaxArticleId();
        await updateRunStatus(runId, 'running', { articleIdMaxInclusive });

        if (articleIdMaxInclusive === articleIdMinExclusive) {
          logger.info('coordinator: google-rss added no new articles, early exit', { runId });
          const remainingSteps = runSteps.filter(
            (s) => ['state_assigner', 'ai_approver', 'semantic_scorer'].includes(s.stepName)
          );
          for (const remaining of remainingSteps) {
            await updateStepStatus(remaining.id, 'skipped');
          }
          finalStatus = 'completed_no_new_articles';
          break;
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('coordinator: unexpected error', { runId, error: msg });
    finalStatus = 'failed';
    failureReason = msg;
  } finally {
    const run = await getRunById(runId);
    if (run) {
      try {
        const reportPath = await writeReport(run as unknown as OrchestratorRunRow, runSteps);
        await updateRunStatus(runId, finalStatus, {
          endedAt: new Date(),
          ...(failureReason !== undefined ? { failureReason } : {}),
          ...(reportPath !== null ? { reportFilePath: reportPath } : {}),
          ...(articleIdMinExclusive !== null ? { articleIdMinExclusive } : {}),
          ...(articleIdMaxInclusive !== null ? { articleIdMaxInclusive } : {}),
        });
        const reportStep = runSteps.find((s) => s.stepName === 'report');
        if (reportStep) {
          await updateStepStatus(reportStep.id, 'completed', {
            startedAt: new Date(),
            endedAt: new Date(),
            endingReason: 'completed',
            ...(reportPath !== null ? { result: { reportFilePath: reportPath } } : {}),
          });
        }
      } catch (reportErr) {
        logger.error('coordinator: report writer failed', {
          runId,
          error: reportErr instanceof Error ? reportErr.message : String(reportErr),
        });
        await updateRunStatus(runId, finalStatus, {
          endedAt: new Date(),
          ...(failureReason !== undefined ? { failureReason } : {}),
        });
      }
    }

    activeCoordinator = null;
    invalidateActiveRunCache();
    logger.info('coordinator: run complete', { runId, finalStatus });
  }
};
