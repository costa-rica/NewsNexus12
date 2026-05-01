import { sequelize } from '@newsnexus/db-models';
import ensureDbReady from '../db/ensureDbReady';
import { invalidateActiveRunCache } from './activeRunGuard';
import { startNodeJob, startPythonJob } from './childJobClient';
import {
  createRun,
  getRunWithSteps,
  getStepByName,
  reconcileOrphanedRuns,
  updateRunReportFilePath,
  updateRunStatus,
  updateStepStatus,
} from './repository';
import { writeReport } from './reportWriter';
import type {
  OrchestratorConfig,
  OrchestratorTestConfig,
  OrchestratorRunRow,
  OrchestratorRunStepRow,
  OrchestratorRunStatus,
  StepConfig,
  ChildJobHandle,
} from './types';
import { STEP_DEFAULTS } from './types';
import logger from '../logger';

const POLL_INTERVAL_MS = 60_000;
const DEFAULT_ARTICLE_THRESHOLD_DAYS_OLD = 180;
const DEFAULT_ARTICLE_REVIEW_COUNT = 100;

const DEFAULT_TEST_CONFIG: OrchestratorTestConfig = {
  deleteTrimCount: 100,
  targetArticlesAddedCount: 10,
  downstreamArticleCount: 10,
};

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
  await writeJobsReportSnapshot(run.id);

  invalidateActiveRunCache();

  const ac = new AbortController();
  activeCoordinator = { runId: run.id, abortController: ac };

  void runCoordinator(run.id, runSteps, steps, config, ac.signal).catch((err) => {
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
  const isAbbreviatedTest = config.mode === 'abbreviated_test';

  return STEP_DEFAULTS.map((s) => {
    const timeoutSeconds = isAbbreviatedTest
      ? Math.min(s.timeoutSeconds, 30 * 60)
      : s.timeoutSeconds;

    if (s.stepName === 'ai_approver') return { ...s, timeoutSeconds, enabled: config.aiApproverEnabled };
    if (s.stepName === 'semantic_scorer') return { ...s, timeoutSeconds, enabled: config.semanticScorerEnabled };
    return { ...s, timeoutSeconds, enabled: true };
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

const writeJobsReportSnapshot = async (runId: number): Promise<void> => {
  try {
    const snapshot = await getRunWithSteps(runId);
    if (!snapshot) return;

    const reportPath = await writeReport(snapshot.run, snapshot.steps, { includeArticles: false });
    if (reportPath !== null) {
      await updateRunReportFilePath(runId, reportPath);
    }
  } catch (err) {
    logger.warn('coordinator: jobs report snapshot failed', {
      runId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

const normalizeTestConfig = (config: OrchestratorConfig): OrchestratorTestConfig => ({
  ...DEFAULT_TEST_CONFIG,
  ...(config.testConfig ?? {}),
});

const buildCursorBody = (
  articleIdMinExclusive: number | null,
  articleIdMaxInclusive: number | null
): Record<string, number> => ({
  ...(articleIdMinExclusive !== null ? { articleIdMinExclusive } : {}),
  ...(articleIdMaxInclusive !== null ? { articleIdMaxInclusive } : {}),
});

const buildStepRequestBody = (
  stepConfig: StepConfig,
  config: OrchestratorConfig,
  articleIdMinExclusive: number | null,
  articleIdMaxInclusive: number | null
): Record<string, unknown> => {
  const cursorBody = buildCursorBody(articleIdMinExclusive, articleIdMaxInclusive);
  const isAbbreviatedTest = config.mode === 'abbreviated_test';
  const testConfig = normalizeTestConfig(config);

  switch (stepConfig.stepName) {
    case 'delete_articles':
      return isAbbreviatedTest ? { trimCount: testConfig.deleteTrimCount } : {};
    case 'google_rss':
      return isAbbreviatedTest
        ? {
            targetArticlesAddedCount: testConfig.targetArticlesAddedCount,
            ...(testConfig.doNotRepeatRequestsWithinHours !== undefined
              ? { doNotRepeatRequestsWithinHours: testConfig.doNotRepeatRequestsWithinHours }
              : {}),
          }
        : {};
    case 'state_assigner':
      return {
        targetArticleThresholdDaysOld: DEFAULT_ARTICLE_THRESHOLD_DAYS_OLD,
        targetArticleStateReviewCount: isAbbreviatedTest
          ? testConfig.downstreamArticleCount
          : DEFAULT_ARTICLE_REVIEW_COUNT,
        ...cursorBody,
      };
    case 'ai_approver':
      return {
        limit: isAbbreviatedTest ? testConfig.downstreamArticleCount : DEFAULT_ARTICLE_REVIEW_COUNT,
        ...cursorBody,
      };
    case 'semantic_scorer':
      return cursorBody;
    case 'report':
      return {};
  }
};

const startChildJob = async (
  stepConfig: StepConfig,
  runId: number,
  body: Record<string, unknown>,
  _signal: AbortSignal
): Promise<ChildJobHandle> => {
  if (stepConfig.worker === 'python') {
    return startPythonJob(stepConfig.endpointName, body, runId);
  }
  return startNodeJob(stepConfig.endpointName, body, runId);
};

const runCoordinator = async (
  runId: number,
  runSteps: OrchestratorRunStepRow[],
  stepConfigs: StepConfig[],
  config: OrchestratorConfig,
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
        await writeJobsReportSnapshot(runId);
        continue;
      }

      if (signal.aborted) {
        await updateStepStatus(stepRow.id, 'canceled');
        await writeJobsReportSnapshot(runId);
        continue;
      }

      logger.info('coordinator: starting step', { runId, step: stepConfig.stepName });
      await updateStepStatus(stepRow.id, 'running', { startedAt: new Date() });
      await writeJobsReportSnapshot(runId);

      if (stepConfig.stepName === 'google_rss') {
        articleIdMinExclusive = await captureMaxArticleId();
        await updateRunStatus(runId, 'running', { articleIdMinExclusive });
        await writeJobsReportSnapshot(runId);
      }

      const stepRequestBody = buildStepRequestBody(
        stepConfig,
        config,
        articleIdMinExclusive,
        articleIdMaxInclusive
      );

      let handle: ChildJobHandle;
      try {
        handle = await startChildJob(stepConfig, runId, stepRequestBody, signal);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('coordinator: failed to start child job', { runId, step: stepConfig.stepName, error: msg });
        await updateStepStatus(stepRow.id, 'failed', {
          endedAt: new Date(),
          endingReason: 'start_failed',
          endingMessage: msg,
        });
        await writeJobsReportSnapshot(runId);
        finalStatus = 'failed';
        failureReason = `Step ${stepConfig.stepName} failed to start: ${msg}`;
        break;
      }

      await updateStepStatus(stepRow.id, 'running', { childJobId: handle.jobId });
      await writeJobsReportSnapshot(runId);

      const pollResult = await pollUntilDone(handle, stepConfig.timeoutSeconds, signal);

      if (pollResult.outcome === 'timed_out') {
        logger.warn('coordinator: step timed out', { runId, step: stepConfig.stepName });
        await handle.cancel().catch(() => undefined);
        await updateStepStatus(stepRow.id, 'timed_out', {
          endedAt: new Date(),
          endingReason: 'timeout',
          endingMessage: `Step exceeded ${stepConfig.timeoutSeconds}s timeout`,
        });
        await writeJobsReportSnapshot(runId);
        finalStatus = 'timed_out';
        failureReason = `Step ${stepConfig.stepName} timed out`;
        break;
      }

      if (pollResult.outcome === 'canceled') {
        logger.info('coordinator: step canceled', { runId, step: stepConfig.stepName });
        await handle.cancel().catch(() => undefined);
        await updateStepStatus(stepRow.id, 'canceled', { endedAt: new Date() });
        await writeJobsReportSnapshot(runId);
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
        await writeJobsReportSnapshot(runId);
        finalStatus = 'failed';
        failureReason = `Step ${stepConfig.stepName} failed: ${pollResult.reason}`;
        break;
      }

      const stepResult = 'result' in pollResult ? (pollResult.result ?? undefined) : undefined;
      const result = {
        ...(stepResult != null ? stepResult as Record<string, unknown> : {}),
        ...(config.mode === 'abbreviated_test'
          ? { orchestratorMode: 'abbreviated_test', requestBody: stepRequestBody }
          : {}),
      };
      await updateStepStatus(stepRow.id, 'completed', {
        endedAt: new Date(),
        endingReason: 'completed',
        ...(Object.keys(result).length > 0 ? { result } : {}),
      });
      await writeJobsReportSnapshot(runId);

      if (stepConfig.stepName === 'google_rss') {
        articleIdMaxInclusive = await captureMaxArticleId();
        await updateRunStatus(runId, 'running', { articleIdMaxInclusive });
        await writeJobsReportSnapshot(runId);

        if (articleIdMaxInclusive === articleIdMinExclusive) {
          logger.info('coordinator: google-rss added no new articles, early exit', { runId });
          const remainingSteps = runSteps.filter(
            (s) => ['state_assigner', 'ai_approver', 'semantic_scorer'].includes(s.stepName)
          );
          for (const remaining of remainingSteps) {
            await updateStepStatus(remaining.id, 'skipped');
          }
          await writeJobsReportSnapshot(runId);
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
    const snapshot = await getRunWithSteps(runId);
    if (snapshot) {
      try {
        const reportPath = await writeReport(snapshot.run as unknown as OrchestratorRunRow, snapshot.steps);
        await updateRunStatus(runId, finalStatus, {
          endedAt: new Date(),
          ...(failureReason !== undefined ? { failureReason } : {}),
          ...(reportPath !== null ? { reportFilePath: reportPath } : {}),
          ...(articleIdMinExclusive !== null ? { articleIdMinExclusive } : {}),
          ...(articleIdMaxInclusive !== null ? { articleIdMaxInclusive } : {}),
        });
        const reportStep = snapshot.steps.find((s) => s.stepName === 'report');
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
