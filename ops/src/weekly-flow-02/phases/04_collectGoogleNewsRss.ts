import type { OpsConfig } from '../../config';
import type {
  WeeklyFlowPersistence,
  WeeklyFlowRunRecord
} from '../persistence';
import {
  GoogleNewsRssClientError,
  cancelGoogleNewsRssJob,
  confirmGoogleNewsRssCancellation,
  getGoogleNewsRssJobStatus,
  monitorGoogleNewsRssJob,
  startGoogleNewsRssJob,
  type GoogleNewsRssJob,
  type GoogleNewsRssStartResult,
  type PhaseFourClock,
  type PhaseFourDelay,
  type WorkerNodeRequest
} from './04_googleNewsRssClient';

type PhaseFourConfig = Pick<
  OpsConfig,
  | 'workerNodeBaseUrl'
  | 'workerNodeRequestTimeoutSeconds'
  | 'rssStatusPollIntervalSeconds'
  | 'rssToleratedConsecutiveStatusFailures'
  | 'rssJobTimeoutHours'
>;

export interface GoogleNewsRssWorker {
  start(): Promise<GoogleNewsRssStartResult>;
  getStatus(jobId: string, phaseStartedAt: Date): Promise<GoogleNewsRssJob>;
  cancel(jobId: string): Promise<'canceled' | 'cancel_requested' | 'not_found'>;
}

export interface CollectGoogleNewsRssDependencies {
  persistence: WeeklyFlowPersistence;
  worker: GoogleNewsRssWorker;
  now: PhaseFourClock;
  delay: PhaseFourDelay;
  onEvent?: (event: PhaseFourEvent) => void;
}

export interface PhaseFourEvent {
  action:
    | 'job_started'
    | 'job_status'
    | 'replacement_eligible'
    | 'cancellation_confirmed'
    | 'verified_success';
  jobId: string;
  status?: string;
  durationMilliseconds?: number;
  recoveryAction?: string;
  cancellationOutcome?: string;
  rssArticlesAddedCount?: number;
}

export type CollectGoogleNewsRssResult =
  | {
      kind: 'zero_work';
      articleCount: 0;
      firstRssRequestId: number | null;
      firstRssArticleId: null;
      rssArticlesAddedCount: number;
      rssJobId: string;
    }
  | {
      kind: 'ready_for_phase_5';
      articleCount: number;
      firstRssRequestId: number | null;
      firstRssArticleId: number | null;
      rssArticlesAddedCount: number;
      rssJobId: string;
    };

export class CollectGoogleNewsRssError extends Error {
  public readonly category:
    | 'invalid_run_state'
    | 'unsuccessful_result'
    | 'job_timeout'
    | 'unverified_outcome';

  public constructor(
    category: CollectGoogleNewsRssError['category'],
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'CollectGoogleNewsRssError';
    this.category = category;
  }
}

const milliseconds = (value: number, unit: number, field: string): number => {
  const result = value * unit;
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new CollectGoogleNewsRssError(
      'invalid_run_state',
      `${field} must convert to a positive safe millisecond value`
    );
  }
  return result;
};

const phaseFourStartedAt = (run: WeeklyFlowRunRecord): Date => {
  const phaseData = run.phaseData.phase4;
  if (typeof phaseData !== 'object' || phaseData === null || Array.isArray(phaseData)) {
    throw new CollectGoogleNewsRssError(
      'invalid_run_state',
      'Phase 4 state is missing its persisted start record'
    );
  }
  const value = (phaseData as Record<string, unknown>).startedAt;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new CollectGoogleNewsRssError(
      'invalid_run_state',
      'Phase 4 state contains an invalid start timestamp'
    );
  }
  return new Date(value);
};

const ensurePhaseFourStarted = async (
  run: WeeklyFlowRunRecord,
  persistence: WeeklyFlowPersistence,
  now: PhaseFourClock
): Promise<WeeklyFlowRunRecord> => {
  if (run.runCompleted) {
    throw new CollectGoogleNewsRssError('invalid_run_state', 'A completed run cannot execute Phase 4');
  }
  if ((run.lastPhaseCompleted ?? 0) >= 4) {
    throw new CollectGoogleNewsRssError('invalid_run_state', 'Phase 4 is already complete');
  }
  const bothMarksMissing =
    run.newsApiRequestIdHighWaterMark === null && run.articleIdHighWaterMark === null;
  const bothMarksPresent =
    run.newsApiRequestIdHighWaterMark !== null && run.articleIdHighWaterMark !== null;
  if (!bothMarksMissing && !bothMarksPresent) {
    throw new CollectGoogleNewsRssError(
      'invalid_run_state',
      'Phase 4 high-water marks must both be null or both be present'
    );
  }
  if (bothMarksPresent) {
    if (run.lastPhaseStarted !== 4 || run.lastPhaseCompleted !== 3) {
      throw new CollectGoogleNewsRssError(
        'invalid_run_state',
        'Persisted Phase 4 boundaries require Phase 4 to be the active incomplete phase'
      );
    }
    phaseFourStartedAt(run);
    return run;
  }
  if (run.lastPhaseStarted === 4) {
    throw new CollectGoogleNewsRssError(
      'invalid_run_state',
      'Phase 4 cannot recalculate missing high-water marks after it has started'
    );
  }
  if (run.lastPhaseCompleted !== 3) {
    throw new CollectGoogleNewsRssError(
      'invalid_run_state',
      'Phase 4 requires Phase 3 completion'
    );
  }
  return persistence.recordPhaseFourStarted(run.id, now());
};

export const createGoogleNewsRssWorker = (
  config: PhaseFourConfig,
  request: WorkerNodeRequest = globalThis.fetch
): GoogleNewsRssWorker => {
  const settings = {
    baseUrl: config.workerNodeBaseUrl,
    requestTimeoutSeconds: config.workerNodeRequestTimeoutSeconds
  };
  return {
    start: () => startGoogleNewsRssJob(settings, request),
    getStatus: (jobId, startedAt) =>
      getGoogleNewsRssJobStatus(
        settings,
        { expectedJobId: jobId, phaseStartedAt: startedAt },
        request
      ),
    cancel: (jobId) => cancelGoogleNewsRssJob(settings, jobId, request)
  };
};

const asStopError = (
  category: 'unsuccessful_result' | 'job_timeout' | 'unverified_outcome',
  message: string,
  cause?: unknown
): CollectGoogleNewsRssError => new CollectGoogleNewsRssError(category, message, { cause });

export const collectGoogleNewsRss = async (
  selectedRun: WeeklyFlowRunRecord,
  config: PhaseFourConfig,
  dependencies: CollectGoogleNewsRssDependencies
): Promise<CollectGoogleNewsRssResult> => {
  const run = await ensurePhaseFourStarted(selectedRun, dependencies.persistence, dependencies.now);
  const startedAt = phaseFourStartedAt(run);
  const pollIntervalMilliseconds = milliseconds(
    config.rssStatusPollIntervalSeconds,
    1_000,
    'RSS poll interval'
  );
  const jobTimeoutMilliseconds = milliseconds(
    config.rssJobTimeoutHours,
    60 * 60 * 1_000,
    'RSS job timeout'
  );
  let jobId = run.rssJobId;
  let startedThisInvocation = false;
  let greatestObservedRssArticlesAddedCount = run.rssArticlesAddedCount ?? 0;

  while (true) {
    if (jobId === null) {
      if (startedThisInvocation) {
        throw asStopError(
          'unverified_outcome',
          'Phase 4 cannot start more than one RSS job in one invocation'
        );
      }
      const startResult = await dependencies.worker.start();
      jobId = startResult.jobId;
      startedThisInvocation = true;
      await dependencies.persistence.recordPhaseFourProgress(run.id, {
        observedAt: dependencies.now(),
        rssJobId: jobId,
        status: startResult.status
      });
      dependencies.onEvent?.({
        action: 'job_started',
        jobId,
        status: startResult.status
      });
    }

    let assessment;
    try {
      assessment = await monitorGoogleNewsRssJob({
        getStatus: () => dependencies.worker.getStatus(jobId as string, startedAt),
        onStatus: async (job) => {
          await dependencies.persistence.recordPhaseFourProgress(run.id, {
            observedAt: dependencies.now(),
            rssJobId: job.jobId,
            status: job.status
          });
          const durationEnd = job.endedAt === undefined
            ? dependencies.now().getTime()
            : Date.parse(job.endedAt);
          dependencies.onEvent?.({
            action: 'job_status',
            jobId: job.jobId,
            status: job.status,
            durationMilliseconds: Math.max(0, durationEnd - Date.parse(job.createdAt))
          });
        },
        pollIntervalMilliseconds,
        toleratedConsecutiveFailures: config.rssToleratedConsecutiveStatusFailures,
        jobTimeoutMilliseconds,
        now: dependencies.now,
        delay: dependencies.delay
      });
    } catch (error: unknown) {
      const replacementEligible =
        !startedThisInvocation &&
        error instanceof GoogleNewsRssClientError &&
        error.category === 'unavailable_job';
      if (replacementEligible) {
        dependencies.onEvent?.({
          action: 'replacement_eligible',
          jobId: jobId as string,
          recoveryAction: 'saved_job_unavailable'
        });
        jobId = null;
        continue;
      }
      throw asStopError('unverified_outcome', 'RSS job outcome could not be verified', error);
    }

    if (assessment.kind === 'verified_success') {
      greatestObservedRssArticlesAddedCount = Math.max(
        greatestObservedRssArticlesAddedCount,
        assessment.result.articlesAddedCount
      );
      const databaseResult = await dependencies.persistence.readPhaseFourDatabaseResult(run.id);
      const rssArticlesAddedCount = Math.max(
        greatestObservedRssArticlesAddedCount,
        assessment.result.articlesAddedCount
      );
      const fields = {
        firstRssRequestId: databaseResult.firstRssRequestId,
        firstRssArticleId: databaseResult.firstRssArticleId,
        rssArticlesAddedCount,
        rssJobId: assessment.job.jobId
      };
      const completedAt = dependencies.now();
      const phaseResult = {
        endingReason: assessment.result.endingReason,
        endingMessage: assessment.result.endingMessage,
        rssArticlesAddedCount,
        articleCount: databaseResult.articleCount
      };
      if (databaseResult.articleCount === 0) {
        if (databaseResult.firstRssArticleId !== null) {
          throw new CollectGoogleNewsRssError(
            'invalid_run_state',
            'A zero Article count cannot contain a first RSS Article ID'
          );
        }
        await dependencies.persistence.recordPhaseFourZeroWorkCompletion(
          run.id,
          completedAt,
          phaseResult,
          { ...fields, firstRssArticleId: null }
        );
        dependencies.onEvent?.({
          action: 'verified_success',
          jobId: assessment.job.jobId,
          status: assessment.job.status,
          rssArticlesAddedCount
        });
        return {
          kind: 'zero_work',
          articleCount: 0,
          ...fields,
          firstRssArticleId: null
        };
      }
      await dependencies.persistence.recordPhaseFourCompleted(
        run.id,
        completedAt,
        phaseResult,
        { ...fields, articleCount: databaseResult.articleCount }
      );
      dependencies.onEvent?.({
        action: 'verified_success',
        jobId: assessment.job.jobId,
        status: assessment.job.status,
        rssArticlesAddedCount
      });
      return {
        kind: 'ready_for_phase_5',
        articleCount: databaseResult.articleCount,
        ...fields
      };
    }

    if (assessment.kind === 'unsuccessful') {
      if (assessment.job.result !== undefined) {
        greatestObservedRssArticlesAddedCount = Math.max(
          greatestObservedRssArticlesAddedCount,
          assessment.job.result.articlesAddedCount
        );
        await dependencies.persistence.recordPhaseFourProgress(run.id, {
          observedAt: dependencies.now(),
          rssJobId: assessment.job.jobId,
          status: assessment.job.status,
          rssArticlesAddedCount: assessment.job.result.articlesAddedCount
        });
      }
      if (startedThisInvocation) {
        throw asStopError(
          'unsuccessful_result',
          `RSS job ended without verified success: ${assessment.reason}`
        );
      }
      dependencies.onEvent?.({
        action: 'replacement_eligible',
        jobId: assessment.job.jobId,
        status: assessment.job.status,
        recoveryAction: assessment.reason
      });
      jobId = null;
      continue;
    }

    const activeTimedOut =
      assessment.job.status === 'queued' || assessment.job.status === 'running';
    if (activeTimedOut) {
      let cancellation;
      try {
        cancellation = await confirmGoogleNewsRssCancellation({
          cancel: () => dependencies.worker.cancel(assessment.job.jobId),
          getStatus: () => dependencies.worker.getStatus(assessment.job.jobId, startedAt),
          pollIntervalMilliseconds,
          delay: dependencies.delay
        });
      } catch (error: unknown) {
        throw asStopError(
          'unverified_outcome',
          'Timed-out RSS job cancellation could not be verified',
          error
        );
      }
      await dependencies.persistence.recordPhaseFourProgress(run.id, {
        observedAt: dependencies.now(),
        rssJobId: assessment.job.jobId,
        status:
          cancellation.kind === 'unavailable'
            ? 'timed_out_unavailable'
            : 'timed_out_inactive'
      });
      dependencies.onEvent?.({
        action: 'cancellation_confirmed',
        jobId: assessment.job.jobId,
        status: assessment.job.status,
        cancellationOutcome: cancellation.kind,
        recoveryAction: cancellation.via
      });
    }

    if (startedThisInvocation) {
      throw asStopError(
        'job_timeout',
        'RSS job exceeded its 24-hour limit; its result was not trusted'
      );
    }
    if (!activeTimedOut) {
      dependencies.onEvent?.({
        action: 'replacement_eligible',
        jobId: assessment.job.jobId,
        status: assessment.job.status,
        recoveryAction: 'terminal_job_exceeded_time_limit'
      });
    }
    jobId = null;
  }
};
