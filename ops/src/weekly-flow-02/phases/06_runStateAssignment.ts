import type { OpsConfig } from '../../config';
import type {
  JsonRecord,
  PhaseSixContinuationReason,
  PhaseSixMonitoringLimit,
  WeeklyFlowPersistence,
  WeeklyFlowRunRecord
} from '../persistence';
import {
  findPhaseSixIncompatibleAttempt,
  parsePhaseSixIncompatibleRecovery,
  upsertPhaseSixIncompatibleAttempt,
  type PhaseSixIncompatibleAttempt,
  type PhaseSixIncompatibleRecoveryV06
} from '../phaseSixRecoveryState';
import {
  StateAssignerClientError,
  cancelStateAssignerJob,
  getStateAssignerJobStatus,
  startStateAssignerJob,
  type StateAssignerInputs,
  type StateAssignerJob,
  type StateAssignerRequest,
  type StateAssignerStartResult,
  type StateAssignerStatusResult
} from './06_stateAssignerClient';

type PhaseSixConfig = Pick<
  OpsConfig,
  | 'workerNodeBaseUrl'
  | 'workerNodeRequestTimeoutSeconds'
  | 'stateAssignerTargetArticleThresholdDaysOld'
  | 'stateAssignerStatusPollIntervalSeconds'
  | 'stateAssignerToleratedConsecutiveStatusFailures'
  | 'stateAssignerMonitoringLimitHours'
>;

export type PhaseSixClock = () => Date;
export type PhaseSixDelay = (milliseconds: number) => Promise<void>;

export interface StateAssignerWorker {
  start(inputs: StateAssignerInputs): Promise<StateAssignerStartResult>;
  getStatus(
    jobId: string,
    phaseStartedAt: Date,
    expectedInputs: StateAssignerInputs
  ): Promise<StateAssignerStatusResult>;
  cancel(jobId: string): Promise<'canceled' | 'cancel_requested' | 'not_found'>;
}

export interface RunStateAssignmentDependencies {
  persistence: WeeklyFlowPersistence;
  worker: StateAssignerWorker;
  now: PhaseSixClock;
  delay: PhaseSixDelay;
  onEvent?: (event: PhaseSixEvent) => void;
}

export interface PhaseSixEvent {
  action:
    | 'persistence_gap'
    | 'job_started'
    | 'job_status'
    | 'replacement_eligible'
    | 'incompatible_contract'
    | 'monitoring_limit_reached'
    | 'cancellation_observed'
    | 'verified_success';
  jobId?: string;
  status?: string;
  recoveryAction?: string;
  cancellationOutcome?: string;
  requestedArticleCount?: number;
  selectedCount?: number;
  elapsedMilliseconds?: number;
}

export interface RunStateAssignmentResult {
  kind: 'ready_for_phase_7';
  stateAssignerJobId: string;
  jobCreatedAt: string;
  completedAt: string;
  selectedCount: number;
  completedCount: number;
  skippedCount: number;
  failedCount: number;
}

export class RunStateAssignmentError extends Error {
  constructor(
    public readonly category:
      | 'invalid_run_state'
      | 'unsuccessful_result'
      | 'incompatible_contract'
      | 'monitoring_limit'
      | 'unverified_outcome',
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'RunStateAssignmentError';
  }
}

const activeStatuses = new Set(['queued', 'running']);

const toPositiveMilliseconds = (value: number, unit: number, field: string): number => {
  const result = value * unit;
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new RunStateAssignmentError(
      'invalid_run_state',
      `${field} must convert to a positive safe millisecond value`
    );
  }
  return result;
};

const phaseSixData = (run: WeeklyFlowRunRecord): JsonRecord => {
  const value = run.phaseData.phase6;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RunStateAssignmentError(
      'invalid_run_state',
      'Phase 6 state is missing its persisted start record'
    );
  }
  return value as JsonRecord;
};

const phaseSixStartedAt = (run: WeeklyFlowRunRecord): Date => {
  const value = phaseSixData(run).startedAt;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new RunStateAssignmentError(
      'invalid_run_state',
      'Phase 6 state contains an invalid start timestamp'
    );
  }
  return new Date(value);
};

const phaseSixInputs = (run: WeeklyFlowRunRecord): StateAssignerInputs => {
  if (
    !Number.isSafeInteger(run.articleCount) ||
    (run.articleCount ?? 0) <= 0 ||
    !Number.isSafeInteger(run.targetArticleThresholdDaysOld) ||
    (run.targetArticleThresholdDaysOld ?? 0) <= 0
  ) {
    throw new RunStateAssignmentError(
      'invalid_run_state',
      'Phase 6 requires persisted positive Article count and age threshold inputs'
    );
  }
  const input = phaseSixData(run).input;
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new RunStateAssignmentError('invalid_run_state', 'Phase 6 input audit mirror is missing');
  }
  const mirror = input as JsonRecord;
  if (
    mirror.targetArticleStateReviewCount !== run.articleCount ||
    mirror.targetArticleThresholdDaysOld !== run.targetArticleThresholdDaysOld
  ) {
    throw new RunStateAssignmentError('invalid_run_state', 'Phase 6 input audit mirror has drifted');
  }
  return {
    targetArticleStateReviewCount: run.articleCount as number,
    targetArticleThresholdDaysOld: run.targetArticleThresholdDaysOld as number
  };
};

interface PersistedMonitoringMarker {
  jobId: string;
  jobCreatedAt: string;
  reachedAt: Date;
}

const monitoringMarker = (run: WeeklyFlowRunRecord): PersistedMonitoringMarker | null => {
  const marker = phaseSixData(run).monitoringLimit;
  if (marker === undefined) return null;
  if (typeof marker !== 'object' || marker === null || Array.isArray(marker)) {
    throw new RunStateAssignmentError('invalid_run_state', 'Phase 6 monitoring marker is invalid');
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
    throw new RunStateAssignmentError(
      'invalid_run_state',
      'Phase 6 monitoring marker identity is invalid'
    );
  }
  return {
    jobId: candidate.jobId,
    jobCreatedAt: candidate.jobCreatedAt,
    reachedAt: new Date(candidate.reachedAt)
  };
};

const incompatibleRecovery = (
  run: WeeklyFlowRunRecord
): PhaseSixIncompatibleRecoveryV06 | null => {
  const marker = phaseSixData(run).incompatibleContractRecovery;
  try {
    return parsePhaseSixIncompatibleRecovery(marker);
  } catch (error: unknown) {
    throw new RunStateAssignmentError(
      'invalid_run_state',
      'Phase 6 incompatible-contract recovery state is invalid',
      { cause: error }
    );
  }
};

const matchesMonitoringMarker = (
  job: StateAssignerJob,
  marker: PersistedMonitoringMarker | null
): boolean => marker !== null && marker.jobId === job.jobId && marker.jobCreatedAt === job.createdAt;


const ensurePhaseSixStarted = async (
  selectedRun: WeeklyFlowRunRecord,
  config: PhaseSixConfig,
  persistence: WeeklyFlowPersistence,
  now: PhaseSixClock
): Promise<WeeklyFlowRunRecord> => {
  if (selectedRun.runCompleted) {
    throw new RunStateAssignmentError('invalid_run_state', 'A completed run cannot execute Phase 6');
  }
  if ((selectedRun.lastPhaseCompleted ?? 0) >= 6) {
    throw new RunStateAssignmentError('invalid_run_state', 'Phase 6 is already complete');
  }
  if (selectedRun.lastPhaseCompleted !== 5 || (selectedRun.articleCount ?? 0) <= 0) {
    throw new RunStateAssignmentError(
      'invalid_run_state',
      'Phase 6 requires completed Phase 5 with a positive articleCount'
    );
  }
  if (selectedRun.lastPhaseStarted === 6) {
    phaseSixStartedAt(selectedRun);
    phaseSixInputs(selectedRun);
    return selectedRun;
  }
  if (selectedRun.lastPhaseStarted !== 5) {
    throw new RunStateAssignmentError('invalid_run_state', 'Phase 6 is not the next phase');
  }
  return persistence.recordPhaseSixStarted(
    selectedRun.id,
    now(),
    config.stateAssignerTargetArticleThresholdDaysOld
  );
};

export const createStateAssignerWorker = (
  config: PhaseSixConfig,
  request: StateAssignerRequest = globalThis.fetch
): StateAssignerWorker => {
  const settings = {
    baseUrl: config.workerNodeBaseUrl,
    requestTimeoutSeconds: config.workerNodeRequestTimeoutSeconds
  };
  return {
    start: (inputs) => startStateAssignerJob(settings, inputs, request),
    getStatus: (jobId, startedAt, inputs) =>
      getStateAssignerJobStatus(
        settings,
        { expectedJobId: jobId, phaseStartedAt: startedAt, expectedInputs: inputs },
        request
      ),
    cancel: (jobId) => cancelStateAssignerJob(settings, jobId, request)
  };
};

const progressFromJob = (job: StateAssignerJob, observedAt: Date) => ({
  observedAt,
  stateAssignerJobId: job.jobId,
  status: job.status,
  jobCreatedAt: job.createdAt,
  ...(job.startedAt === undefined ? {} : { startedAt: job.startedAt }),
  ...(job.endedAt === undefined ? {} : { endedAt: job.endedAt }),
  ...(job.failureReason === undefined ? {} : { failureReason: job.failureReason }),
  ...(job.result === undefined ? {} : { selectedCount: job.result.selectedCount })
});

const asPhaseError = (message: string, cause?: unknown): RunStateAssignmentError =>
  new RunStateAssignmentError('unverified_outcome', message, { cause });

const cancelMonitoringLimitedJob = async (
  runId: number,
  job: StateAssignerJob,
  phaseStartedAt: Date,
  inputs: StateAssignerInputs,
  pollIntervalMilliseconds: number,
  dependencies: RunStateAssignmentDependencies,
  existingMarker?: PersistedMonitoringMarker
): Promise<never> => {
  const reachedAt = existingMarker?.reachedAt ?? dependencies.now();
  const marker: PhaseSixMonitoringLimit = {
    jobId: job.jobId,
    jobCreatedAt: job.createdAt,
    reachedAt
  };
  await dependencies.persistence.recordPhaseSixProgress(runId, {
    ...progressFromJob(job, reachedAt),
    monitoringLimit: marker
  });
  dependencies.onEvent?.({
    action: 'monitoring_limit_reached',
    jobId: job.jobId,
    status: job.status,
    requestedArticleCount: inputs.targetArticleStateReviewCount,
    selectedCount: job.result?.selectedCount
  });

  let outcome: 'canceled' | 'cancel_requested' | 'not_found';
  try {
    outcome = await dependencies.worker.cancel(job.jobId);
  } catch (error: unknown) {
    throw asPhaseError('Monitoring-limited state assigner job cancellation failed', error);
  }
  const cancellationRequestedAt = dependencies.now();
  const persistCancellation = async (verification?: JsonRecord): Promise<void> => {
    await dependencies.persistence.recordPhaseSixProgress(runId, {
      observedAt: dependencies.now(),
      stateAssignerJobId: job.jobId,
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
      const verification = await dependencies.worker.getStatus(job.jobId, phaseStartedAt, inputs);
      await persistCancellation({
        kind: activeStatuses.has(verification.job.status) ? 'active' : 'inactive',
        status: verification.job.status,
        observedAt: dependencies.now().toISOString()
      });
    } catch (error: unknown) {
      const unavailable =
        error instanceof StateAssignerClientError && error.category === 'unavailable_job';
      await persistCancellation({
        kind: unavailable ? 'unavailable' : 'unverified',
        observedAt: dependencies.now().toISOString()
      });
      if (!unavailable) {
        throw asPhaseError(
          'Monitoring-limited state assigner job cancellation could not be verified',
          error
        );
      }
    }
  }
  throw new RunStateAssignmentError(
    'monitoring_limit',
    'State assignment reached its monitoring limit; the marked job result was not trusted'
  );
};

const cancelIncompatibleJob = async (
  runId: number,
  job: StateAssignerJob,
  recovery: PhaseSixIncompatibleRecoveryV06,
  attempt: PhaseSixIncompatibleAttempt,
  phaseStartedAt: Date,
  inputs: StateAssignerInputs,
  pollIntervalMilliseconds: number,
  dependencies: RunStateAssignmentDependencies
): Promise<never> => {
  let outcome: 'canceled' | 'cancel_requested' | 'not_found';
  try {
    outcome = await dependencies.worker.cancel(job.jobId);
  } catch (error: unknown) {
    throw asPhaseError('Incompatible state assigner job cancellation failed', error);
  }
  const cancellationRequestedAt = dependencies.now();
  const persistCancellation = async (verification?: JsonRecord): Promise<void> => {
    const updatedRecovery = upsertPhaseSixIncompatibleAttempt(recovery, {
      ...attempt,
      lastStatus: job.status,
      cancellationRequestedAt,
      cancellationOutcome: outcome,
      ...(verification === undefined ? {} : { verification })
    });
    await dependencies.persistence.recordPhaseSixProgress(runId, {
      observedAt: dependencies.now(),
      stateAssignerJobId: job.jobId,
      status: `incompatible_contract_${outcome}`,
      jobCreatedAt: job.createdAt,
      incompatibleContractRecovery: updatedRecovery
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
      const verification = await dependencies.worker.getStatus(job.jobId, phaseStartedAt, inputs);
      const active = activeStatuses.has(verification.job.status);
      await persistCancellation({
        kind: active ? 'active' : 'inactive',
        status: verification.job.status,
        observedAt: dependencies.now().toISOString()
      });
      if (active) {
        throw asPhaseError('Incompatible state assigner job remains active after cancellation');
      }
    } catch (error: unknown) {
      if (error instanceof RunStateAssignmentError) throw error;
      const unavailable =
        error instanceof StateAssignerClientError && error.category === 'unavailable_job';
      await persistCancellation({
        kind: unavailable ? 'unavailable' : 'unverified',
        observedAt: dependencies.now().toISOString()
      });
      if (!unavailable) {
        throw asPhaseError('Incompatible state assigner job cancellation could not be verified', error);
      }
    }
  }
  throw new RunStateAssignmentError(
    'incompatible_contract',
    'State assigner job omitted required parameters and cannot complete Phase 6'
  );
};

export const runStateAssignment = async (
  selectedRun: WeeklyFlowRunRecord,
  config: PhaseSixConfig,
  dependencies: RunStateAssignmentDependencies
): Promise<RunStateAssignmentResult> => {
  const invocationStartedAt = dependencies.now();
  const run = await ensurePhaseSixStarted(
    selectedRun,
    config,
    dependencies.persistence,
    dependencies.now
  );
  const startedAt = phaseSixStartedAt(run);
  const inputs = phaseSixInputs(run);
  const limitMarker = monitoringMarker(run);
  let contractRecovery = incompatibleRecovery(run);
  const pollIntervalMilliseconds = toPositiveMilliseconds(
    config.stateAssignerStatusPollIntervalSeconds,
    1_000,
    'State assigner poll interval'
  );
  const monitoringLimitMilliseconds = toPositiveMilliseconds(
    config.stateAssignerMonitoringLimitHours,
    60 * 60 * 1_000,
    'State assigner monitoring limit'
  );
  let jobId = run.stateAssignerJobId;
  let startedThisInvocation = false;
  let pendingContinuation: {
    priorJobId: string;
    reason: PhaseSixContinuationReason;
  } | null = null;
  let consecutiveTransientFailures = 0;
  let lastActiveJob: StateAssignerJob | null = null;

  if (run.lastPhaseStarted === 6 && jobId === null) {
    dependencies.onEvent?.({
      action: 'persistence_gap',
      recoveryAction: 'phase_started_without_job_id',
      requestedArticleCount: inputs.targetArticleStateReviewCount
    });
  }

  while (true) {
    if (jobId === null) {
      if (startedThisInvocation) {
        throw asPhaseError('Phase 6 cannot start more than one state assigner job in one invocation');
      }
      let started: StateAssignerStartResult;
      try {
        started = await dependencies.worker.start(inputs);
      } catch (error: unknown) {
        throw asPhaseError('State assigner job could not be started', error);
      }
      jobId = started.jobId;
      startedThisInvocation = true;
      const startedObservedAt = dependencies.now();
      if (pendingContinuation !== null) {
        try {
          await dependencies.persistence.recordPhaseSixContinuationJobStarted(
            run.id,
            pendingContinuation.priorJobId,
            jobId,
            startedObservedAt,
            pendingContinuation.reason
          );
        } catch (error: unknown) {
          throw asPhaseError(
            'State assigner continuation job started but its job ID could not be saved',
            error
          );
        }
      } else {
        await dependencies.persistence.recordPhaseSixProgress(run.id, {
          observedAt: startedObservedAt,
          stateAssignerJobId: jobId,
          status: started.status
        });
      }
      dependencies.onEvent?.({
        action: 'job_started',
        jobId,
        status: started.status,
        recoveryAction: pendingContinuation?.reason,
        requestedArticleCount: inputs.targetArticleStateReviewCount
      });
      pendingContinuation = null;
    }

    let statusResult: StateAssignerStatusResult;
    try {
      statusResult = await dependencies.worker.getStatus(jobId, startedAt, inputs);
      consecutiveTransientFailures = 0;
    } catch (error: unknown) {
      const transient =
        error instanceof StateAssignerClientError && error.category === 'transient_request';
      if (transient) {
        consecutiveTransientFailures += 1;
        if (
          consecutiveTransientFailures <=
          config.stateAssignerToleratedConsecutiveStatusFailures
        ) {
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
              inputs,
              pollIntervalMilliseconds,
              dependencies
            );
          }
        }
      }
      const unavailable =
        error instanceof StateAssignerClientError && error.category === 'unavailable_job';
      if (unavailable && !startedThisInvocation) {
        dependencies.onEvent?.({
          action: 'replacement_eligible',
          jobId,
          recoveryAction: 'saved_job_unavailable'
        });
        pendingContinuation = {
          priorJobId: jobId,
          reason: limitMarker?.jobId === jobId
            ? 'monitoring_limited'
            : 'saved_job_unavailable'
        };
        jobId = null;
        continue;
      }
      throw asPhaseError('State assigner job outcome could not be verified', error);
    }

    const job = statusResult.job;
    await dependencies.persistence.recordPhaseSixProgress(
      run.id,
      progressFromJob(job, dependencies.now())
    );
    dependencies.onEvent?.({
      action: 'job_status',
      jobId: job.jobId,
      status: job.status,
      requestedArticleCount: inputs.targetArticleStateReviewCount,
      selectedCount: job.result?.selectedCount,
      elapsedMilliseconds: dependencies.now().getTime() - invocationStartedAt.getTime()
    });

    const monitoringLimited = matchesMonitoringMarker(job, limitMarker);
    let incompatibleAttempt = findPhaseSixIncompatibleAttempt(
      contractRecovery,
      job.jobId,
      job.createdAt
    );

    if (statusResult.kind === 'incompatible_contract') {
      incompatibleAttempt = {
        ...(incompatibleAttempt ?? {
          jobId: job.jobId,
          jobCreatedAt: job.createdAt,
          detectedAt: dependencies.now(),
          missingParameterFields: statusResult.missingParameterFields
        }),
        missingParameterFields: statusResult.missingParameterFields,
        lastStatus: job.status
      };
      contractRecovery = upsertPhaseSixIncompatibleAttempt(
        contractRecovery,
        incompatibleAttempt
      );
      await dependencies.persistence.recordPhaseSixProgress(run.id, {
        ...progressFromJob(job, dependencies.now()),
        incompatibleContractRecovery: contractRecovery
      });
      dependencies.onEvent?.({
        action: 'incompatible_contract',
        jobId: job.jobId,
        status: job.status,
        recoveryAction: 'attempt_recorded'
      });

      if (activeStatuses.has(job.status)) {
        return cancelIncompatibleJob(
          run.id,
          job,
          contractRecovery,
          incompatibleAttempt,
          startedAt,
          inputs,
          pollIntervalMilliseconds,
          dependencies
        );
      }
      if (startedThisInvocation) {
        throw new RunStateAssignmentError(
          'incompatible_contract',
          'The current invocation started an incompatible state assigner job'
        );
      }
      pendingContinuation = {
        priorJobId: job.jobId,
        reason: 'incompatible_contract'
      };
      jobId = null;
      continue;
    }

    if (incompatibleAttempt !== null) {
      if (activeStatuses.has(job.status)) {
        return cancelIncompatibleJob(
          run.id,
          job,
          contractRecovery as PhaseSixIncompatibleRecoveryV06,
          incompatibleAttempt,
          startedAt,
          inputs,
          pollIntervalMilliseconds,
          dependencies
        );
      }
      if (startedThisInvocation) {
        throw new RunStateAssignmentError(
          'incompatible_contract',
          'The current invocation started a job with an incompatible recorded identity'
        );
      }
      pendingContinuation = {
        priorJobId: job.jobId,
        reason: 'incompatible_contract'
      };
      jobId = null;
      continue;
    }

    if (job.status === 'completed') {
      if (monitoringLimited) {
        if (startedThisInvocation) {
          throw new RunStateAssignmentError(
            'monitoring_limit',
            'A monitoring-limited state assigner job cannot complete Phase 6'
          );
        }
        dependencies.onEvent?.({
          action: 'replacement_eligible',
          jobId: job.jobId,
          status: job.status,
          recoveryAction: 'marked_terminal_job'
        });
        pendingContinuation = {
          priorJobId: job.jobId,
          reason: 'monitoring_limited'
        };
        jobId = null;
        continue;
      }
      if (!job.result) {
        throw new RunStateAssignmentError(
          'unverified_outcome',
          'Completed state assigner job is missing its validated result'
        );
      }
      const completedAt = dependencies.now();
      await dependencies.persistence.recordPhaseSixCompleted(
        run.id,
        completedAt,
        { ...job.result },
        { stateAssignerJobId: job.jobId, jobCreatedAt: job.createdAt }
      );
      dependencies.onEvent?.({
        action: 'verified_success',
        jobId: job.jobId,
        status: job.status,
        requestedArticleCount: inputs.targetArticleStateReviewCount,
        selectedCount: job.result.selectedCount,
        elapsedMilliseconds: completedAt.getTime() - invocationStartedAt.getTime()
      });
      return {
        kind: 'ready_for_phase_7',
        stateAssignerJobId: job.jobId,
        jobCreatedAt: job.createdAt,
        completedAt: completedAt.toISOString(),
        selectedCount: job.result.selectedCount,
        completedCount: job.result.completedCount,
        skippedCount: job.result.skippedCount,
        failedCount: job.result.failedCount
      };
    }

    if (job.status === 'failed' || job.status === 'canceled') {
      if (startedThisInvocation) {
        throw new RunStateAssignmentError(
          'unsuccessful_result',
          `State assigner job ended with status ${job.status}`
        );
      }
      dependencies.onEvent?.({
        action: 'replacement_eligible',
        jobId: job.jobId,
        status: job.status,
        recoveryAction: monitoringLimited ? 'marked_terminal_job' : 'saved_terminal_job'
      });
      pendingContinuation = {
        priorJobId: job.jobId,
        reason: monitoringLimited
          ? 'monitoring_limited'
          : job.status === 'failed'
            ? 'saved_job_failed'
            : 'saved_job_canceled'
      };
      jobId = null;
      continue;
    }

    if (monitoringLimited) {
      return cancelMonitoringLimitedJob(
        run.id,
        job,
        startedAt,
        inputs,
        pollIntervalMilliseconds,
        dependencies,
        limitMarker ?? undefined
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
        inputs,
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
        inputs,
        pollIntervalMilliseconds,
        dependencies
      );
    }
  }
};
