import type { OpsConfig } from '../../config';
import type {
  JsonRecord,
  PhaseFiveMonitoringLimit,
  WeeklyFlowPersistence,
  WeeklyFlowRunRecord
} from '../persistence';
import {
  SemanticScorerClientError,
  cancelSemanticScorerJob,
  getSemanticScorerJobStatus,
  startSemanticScorerJob,
  type SemanticScorerJob,
  type SemanticScorerRequest,
  type SemanticScorerStartResult
} from './05_semanticScorerClient';

type PhaseFiveConfig = Pick<
  OpsConfig,
  | 'workerNodeBaseUrl'
  | 'workerNodeRequestTimeoutSeconds'
  | 'semanticScorerStatusPollIntervalSeconds'
  | 'semanticScorerToleratedConsecutiveStatusFailures'
  | 'semanticScorerMonitoringLimitHours'
>;

export type PhaseFiveClock = () => Date;
export type PhaseFiveDelay = (milliseconds: number) => Promise<void>;

export interface SemanticScorerWorker {
  start(): Promise<SemanticScorerStartResult>;
  getStatus(jobId: string, phaseStartedAt: Date): Promise<SemanticScorerJob>;
  cancel(jobId: string): Promise<'canceled' | 'cancel_requested' | 'not_found'>;
}

export interface RunSemanticScoringDependencies {
  persistence: WeeklyFlowPersistence;
  worker: SemanticScorerWorker;
  now: PhaseFiveClock;
  delay: PhaseFiveDelay;
  onEvent?: (event: PhaseFiveEvent) => void;
}

export interface PhaseFiveEvent {
  action:
    | 'persistence_gap'
    | 'job_started'
    | 'job_status'
    | 'replacement_eligible'
    | 'monitoring_limit_reached'
    | 'cancellation_observed'
    | 'verified_success';
  jobId?: string;
  status?: string;
  recoveryAction?: string;
  cancellationOutcome?: string;
}

export interface RunSemanticScoringResult {
  kind: 'ready_for_phase_6';
  semanticScorerJobId: string;
  jobCreatedAt: string;
  completedAt: string;
}

export class RunSemanticScoringError extends Error {
  constructor(
    public readonly category:
      | 'invalid_run_state'
      | 'unsuccessful_result'
      | 'monitoring_limit'
      | 'unverified_outcome',
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'RunSemanticScoringError';
  }
}

const activeStatuses = new Set(['queued', 'running']);

const toPositiveMilliseconds = (value: number, unit: number, field: string): number => {
  const result = value * unit;
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new RunSemanticScoringError(
      'invalid_run_state',
      `${field} must convert to a positive safe millisecond value`
    );
  }
  return result;
};

const phaseFiveData = (run: WeeklyFlowRunRecord): JsonRecord => {
  const value = run.phaseData.phase5;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RunSemanticScoringError(
      'invalid_run_state',
      'Phase 5 state is missing its persisted start record'
    );
  }
  return value as JsonRecord;
};

const phaseFiveStartedAt = (run: WeeklyFlowRunRecord): Date => {
  const value = phaseFiveData(run).startedAt;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new RunSemanticScoringError(
      'invalid_run_state',
      'Phase 5 state contains an invalid start timestamp'
    );
  }
  return new Date(value);
};

interface PersistedMarker {
  jobId: string;
  jobCreatedAt: string;
  reachedAt: Date;
}

const monitoringMarker = (run: WeeklyFlowRunRecord): PersistedMarker | null => {
  const marker = phaseFiveData(run).monitoringLimit;
  if (marker === undefined) return null;
  if (typeof marker !== 'object' || marker === null || Array.isArray(marker)) {
    throw new RunSemanticScoringError('invalid_run_state', 'Phase 5 monitoring marker is invalid');
  }
  const candidate = marker as JsonRecord;
  if (
    typeof candidate.jobId !== 'string' ||
    candidate.jobId.trim() === '' ||
    typeof candidate.jobCreatedAt !== 'string' ||
    !Number.isFinite(Date.parse(candidate.jobCreatedAt)) ||
    typeof candidate.reachedAt !== 'string' ||
    !Number.isFinite(Date.parse(candidate.reachedAt))
  ) {
    throw new RunSemanticScoringError('invalid_run_state', 'Phase 5 monitoring marker identity is invalid');
  }
  return {
    jobId: candidate.jobId,
    jobCreatedAt: candidate.jobCreatedAt,
    reachedAt: new Date(candidate.reachedAt)
  };
};

const matchesMarker = (job: SemanticScorerJob, marker: PersistedMarker | null): boolean =>
  marker !== null && marker.jobId === job.jobId && marker.jobCreatedAt === job.createdAt;

const ensurePhaseFiveStarted = async (
  selectedRun: WeeklyFlowRunRecord,
  persistence: WeeklyFlowPersistence,
  now: PhaseFiveClock
): Promise<WeeklyFlowRunRecord> => {
  if (selectedRun.runCompleted) {
    throw new RunSemanticScoringError('invalid_run_state', 'A completed run cannot execute Phase 5');
  }
  if ((selectedRun.lastPhaseCompleted ?? 0) >= 5) {
    throw new RunSemanticScoringError('invalid_run_state', 'Phase 5 is already complete');
  }
  if (selectedRun.lastPhaseCompleted !== 4 || (selectedRun.articleCount ?? 0) <= 0) {
    throw new RunSemanticScoringError(
      'invalid_run_state',
      'Phase 5 requires completed Phase 4 with a positive articleCount'
    );
  }
  if (selectedRun.lastPhaseStarted === 5) {
    phaseFiveStartedAt(selectedRun);
    return selectedRun;
  }
  if (selectedRun.lastPhaseStarted !== 4) {
    throw new RunSemanticScoringError('invalid_run_state', 'Phase 5 is not the next phase');
  }
  return persistence.recordPhaseFiveStarted(selectedRun.id, now());
};

export const createSemanticScorerWorker = (
  config: PhaseFiveConfig,
  request: SemanticScorerRequest = globalThis.fetch
): SemanticScorerWorker => {
  const settings = {
    baseUrl: config.workerNodeBaseUrl,
    requestTimeoutSeconds: config.workerNodeRequestTimeoutSeconds
  };
  return {
    start: () => startSemanticScorerJob(settings, request),
    getStatus: (jobId, startedAt) =>
      getSemanticScorerJobStatus(
        settings,
        { expectedJobId: jobId, phaseStartedAt: startedAt },
        request
      ),
    cancel: (jobId) => cancelSemanticScorerJob(settings, jobId, request)
  };
};

const progressFromJob = (job: SemanticScorerJob, observedAt: Date) => ({
  observedAt,
  semanticScorerJobId: job.jobId,
  status: job.status,
  jobCreatedAt: job.createdAt,
  ...(job.startedAt === undefined ? {} : { startedAt: job.startedAt }),
  ...(job.endedAt === undefined ? {} : { endedAt: job.endedAt }),
  ...(job.failureReason === undefined ? {} : { failureReason: job.failureReason })
});

const asPhaseError = (message: string, cause?: unknown): RunSemanticScoringError =>
  new RunSemanticScoringError('unverified_outcome', message, { cause });

const cancelMonitoringLimitedJob = async (
  runId: number,
  job: SemanticScorerJob,
  phaseStartedAt: Date,
  pollIntervalMilliseconds: number,
  dependencies: RunSemanticScoringDependencies,
  existingMarker?: PersistedMarker
): Promise<never> => {
  const reachedAt = existingMarker?.reachedAt ?? dependencies.now();
  const marker: PhaseFiveMonitoringLimit = {
    jobId: job.jobId,
    jobCreatedAt: job.createdAt,
    reachedAt
  };
  await dependencies.persistence.recordPhaseFiveProgress(runId, {
    ...progressFromJob(job, reachedAt),
    monitoringLimit: marker
  });
  dependencies.onEvent?.({ action: 'monitoring_limit_reached', jobId: job.jobId, status: job.status });

  let outcome: 'canceled' | 'cancel_requested' | 'not_found';
  try {
    outcome = await dependencies.worker.cancel(job.jobId);
  } catch (error: unknown) {
    throw asPhaseError('Monitoring-limited semantic job cancellation failed', error);
  }
  const cancellationRequestedAt = dependencies.now();
  const persistCancellation = async (verification?: JsonRecord): Promise<void> => {
    await dependencies.persistence.recordPhaseFiveProgress(runId, {
      observedAt: dependencies.now(),
      semanticScorerJobId: job.jobId,
      status: `monitoring_limit_${outcome}`,
      jobCreatedAt: job.createdAt,
      monitoringLimit: {
        ...marker,
        cancellationRequestedAt,
        cancellationOutcome: outcome,
        ...(verification === undefined ? {} : { verification })
      }
    });
  };
  await persistCancellation();
  dependencies.onEvent?.({
    action: 'cancellation_observed',
    jobId: job.jobId,
    cancellationOutcome: outcome
  });

  if (outcome === 'cancel_requested') await dependencies.delay(pollIntervalMilliseconds);
  if (outcome !== 'canceled') {
    try {
      const verificationJob = await dependencies.worker.getStatus(job.jobId, phaseStartedAt);
      await persistCancellation({
        kind: activeStatuses.has(verificationJob.status) ? 'active' : 'inactive',
        status: verificationJob.status,
        observedAt: dependencies.now().toISOString()
      });
    } catch (error: unknown) {
      const unavailable =
        error instanceof SemanticScorerClientError && error.category === 'unavailable_job';
      await persistCancellation({
        kind: unavailable ? 'unavailable' : 'unverified',
        observedAt: dependencies.now().toISOString()
      });
      if (!unavailable) {
        throw asPhaseError('Monitoring-limited semantic job cancellation could not be verified', error);
      }
    }
  }
  throw new RunSemanticScoringError(
    'monitoring_limit',
    'Semantic scoring reached its monitoring limit; the marked job result was not trusted'
  );
};

export const runSemanticScoring = async (
  selectedRun: WeeklyFlowRunRecord,
  config: PhaseFiveConfig,
  dependencies: RunSemanticScoringDependencies
): Promise<RunSemanticScoringResult> => {
  const invocationStartedAt = dependencies.now();
  const run = await ensurePhaseFiveStarted(selectedRun, dependencies.persistence, dependencies.now);
  const startedAt = phaseFiveStartedAt(run);
  const marker = monitoringMarker(run);
  const pollIntervalMilliseconds = toPositiveMilliseconds(
    config.semanticScorerStatusPollIntervalSeconds,
    1_000,
    'Semantic scorer poll interval'
  );
  const monitoringLimitMilliseconds = toPositiveMilliseconds(
    config.semanticScorerMonitoringLimitHours,
    60 * 60 * 1_000,
    'Semantic scorer monitoring limit'
  );
  let jobId = run.semanticScorerJobId;
  let startedThisInvocation = false;
  let consecutiveTransientFailures = 0;
  let lastActiveJob: SemanticScorerJob | null = null;

  if (run.lastPhaseStarted === 5 && jobId === null) {
    dependencies.onEvent?.({ action: 'persistence_gap', recoveryAction: 'phase_started_without_job_id' });
  }

  while (true) {
    if (jobId === null) {
      if (startedThisInvocation) {
        throw asPhaseError('Phase 5 cannot start more than one semantic job in one invocation');
      }
      let started: SemanticScorerStartResult;
      try {
        started = await dependencies.worker.start();
      } catch (error: unknown) {
        throw asPhaseError('Semantic scorer job could not be started', error);
      }
      jobId = started.jobId;
      startedThisInvocation = true;
      await dependencies.persistence.recordPhaseFiveProgress(run.id, {
        observedAt: dependencies.now(),
        semanticScorerJobId: jobId,
        status: started.status
      });
      dependencies.onEvent?.({ action: 'job_started', jobId, status: started.status });
    }

    let job: SemanticScorerJob;
    try {
      job = await dependencies.worker.getStatus(jobId, startedAt);
      consecutiveTransientFailures = 0;
    } catch (error: unknown) {
      const transient =
        error instanceof SemanticScorerClientError && error.category === 'transient_request';
      if (transient) {
        consecutiveTransientFailures += 1;
        if (consecutiveTransientFailures <= config.semanticScorerToleratedConsecutiveStatusFailures) {
          const elapsed = dependencies.now().getTime() - invocationStartedAt.getTime();
          const remaining = monitoringLimitMilliseconds - elapsed;
          if (remaining > 0) {
            await dependencies.delay(Math.min(pollIntervalMilliseconds, remaining));
            continue;
          }
          if (lastActiveJob !== null) {
            return cancelMonitoringLimitedJob(
              run.id,
              lastActiveJob,
              startedAt,
              pollIntervalMilliseconds,
              dependencies
            );
          }
        }
      }
      const unavailable =
        error instanceof SemanticScorerClientError && error.category === 'unavailable_job';
      if (unavailable && !startedThisInvocation) {
        dependencies.onEvent?.({
          action: 'replacement_eligible',
          jobId,
          recoveryAction: 'saved_job_unavailable'
        });
        jobId = null;
        continue;
      }
      throw asPhaseError('Semantic scorer job outcome could not be verified', error);
    }

    await dependencies.persistence.recordPhaseFiveProgress(
      run.id,
      progressFromJob(job, dependencies.now())
    );
    dependencies.onEvent?.({ action: 'job_status', jobId: job.jobId, status: job.status });

    const marked = matchesMarker(job, marker);
    if (job.status === 'completed') {
      if (marked) {
        if (startedThisInvocation) {
          throw new RunSemanticScoringError('monitoring_limit', 'A marked semantic job cannot complete Phase 5');
        }
        dependencies.onEvent?.({
          action: 'replacement_eligible',
          jobId: job.jobId,
          status: job.status,
          recoveryAction: 'marked_terminal_job'
        });
        jobId = null;
        continue;
      }
      const completedAt = dependencies.now();
      const result = {
        status: job.status,
        jobCreatedAt: job.createdAt,
        ...(job.startedAt === undefined ? {} : { startedAt: job.startedAt }),
        ...(job.endedAt === undefined ? {} : { endedAt: job.endedAt })
      };
      await dependencies.persistence.recordPhaseFiveCompleted(run.id, completedAt, result, {
        semanticScorerJobId: job.jobId,
        jobCreatedAt: job.createdAt
      });
      dependencies.onEvent?.({ action: 'verified_success', jobId: job.jobId, status: job.status });
      return {
        kind: 'ready_for_phase_6',
        semanticScorerJobId: job.jobId,
        jobCreatedAt: job.createdAt,
        completedAt: completedAt.toISOString()
      };
    }

    if (job.status === 'failed' || job.status === 'canceled') {
      if (startedThisInvocation) {
        throw new RunSemanticScoringError(
          'unsuccessful_result',
          `Semantic scorer job ended with status ${job.status}`
        );
      }
      dependencies.onEvent?.({
        action: 'replacement_eligible',
        jobId: job.jobId,
        status: job.status,
        recoveryAction: marked ? 'marked_terminal_job' : 'saved_terminal_job'
      });
      jobId = null;
      continue;
    }

    if (marked) {
      return cancelMonitoringLimitedJob(
        run.id,
        job,
        startedAt,
        pollIntervalMilliseconds,
        dependencies,
        marker ?? undefined
      );
    }

    lastActiveJob = job;
    const elapsed = dependencies.now().getTime() - invocationStartedAt.getTime();
    const remaining = monitoringLimitMilliseconds - elapsed;
    if (remaining <= 0) {
      return cancelMonitoringLimitedJob(
        run.id,
        job,
        startedAt,
        pollIntervalMilliseconds,
        dependencies
      );
    }
    await dependencies.delay(Math.min(pollIntervalMilliseconds, remaining));
    if (dependencies.now().getTime() - invocationStartedAt.getTime() >= monitoringLimitMilliseconds) {
      return cancelMonitoringLimitedJob(
        run.id,
        job,
        startedAt,
        pollIntervalMilliseconds,
        dependencies
      );
    }
  }
};
