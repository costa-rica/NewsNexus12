import type { OpsConfig } from '../../config';
import {
  AiApproverV02ClientError,
  type AiApproverV02Counts,
  type AiApproverV02Detail,
  type AiApproverV02Inputs,
  type AiApproverV02Worker
} from './07_aiApproverV02Client';
import type {
  JsonRecord,
  PhaseSevenAttempt,
  WeeklyFlowPersistence,
  WeeklyFlowRunRecord
} from '../persistence';

export type RunAiApproverV02ErrorCategory =
  | 'invalid_run_state'
  | 'unsuccessful_terminal_result'
  | 'monitoring_limit'
  | 'orphaned_accepted_run'
  | 'unverified_outcome';

export class RunAiApproverV02Error extends Error {
  constructor(
    public readonly category: RunAiApproverV02ErrorCategory,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'RunAiApproverV02Error';
  }
}

export interface RunAiApproverV02Dependencies {
  persistence: WeeklyFlowPersistence;
  worker: AiApproverV02Worker;
  now: () => Date;
  delay: (milliseconds: number) => Promise<void>;
  onEvent?: (event: Record<string, unknown>) => void;
}

export type RunAiApproverV02Result =
  | { kind: 'completed'; v02RunId: number; jobId: string; counts: AiApproverV02Counts }
  | { kind: 'zero_work'; zeroWorkAfterPriorAttempts: boolean };

interface PhaseSevenState {
  inputs: AiApproverV02Inputs;
  attempts: PhaseSevenAttempt[];
  currentV02RunId: number | null;
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const positiveInteger = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new RunAiApproverV02Error('invalid_run_state', `${field} must be a positive safe integer`);
  }
  return value;
};

const timestamp = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new RunAiApproverV02Error('invalid_run_state', `${field} must be a valid timestamp`);
  }
  return value;
};

const phaseSevenState = (run: WeeklyFlowRunRecord): PhaseSevenState => {
  if (!isRecord(run.phaseData.phase7)) {
    throw new RunAiApproverV02Error('invalid_run_state', 'Phase 7 state is missing');
  }
  const data = run.phaseData.phase7;
  if (!isRecord(data.input)) {
    throw new RunAiApproverV02Error('invalid_run_state', 'Phase 7 input mirror is missing');
  }
  const articleCount = positiveInteger(run.articleCount, 'articleCount');
  if (
    data.input.selectionMode !== 'article_position_count' ||
    data.input.requestedArticleCount !== articleCount ||
    data.input.allowPastApprovedBoundary !== true ||
    data.input.allowDescriptionFallback !== true
  ) {
    throw new RunAiApproverV02Error('invalid_run_state', 'Phase 7 input mirror is invalid');
  }
  if (!Array.isArray(data.attempts)) {
    throw new RunAiApproverV02Error('invalid_run_state', 'Phase 7 attempt history is invalid');
  }
  const attempts = data.attempts.map((raw, index): PhaseSevenAttempt => {
    if (!isRecord(raw)) {
      throw new RunAiApproverV02Error('invalid_run_state', `Phase 7 attempt ${index} is invalid`);
    }
    return {
      ...(structuredClone(raw) as unknown as PhaseSevenAttempt),
      v02RunId: positiveInteger(raw.v02RunId, `attempts[${index}].v02RunId`),
      previewCreatedAt: timestamp(raw.previewCreatedAt, `attempts[${index}].previewCreatedAt`),
      previewExpiresAt: timestamp(raw.previewExpiresAt, `attempts[${index}].previewExpiresAt`),
      plannedEligibleCount: positiveInteger(
        raw.plannedEligibleCount,
        `attempts[${index}].plannedEligibleCount`
      ),
      continuationReason:
        typeof raw.continuationReason === 'string' && raw.continuationReason
          ? raw.continuationReason
          : 'unknown'
    };
  });
  const currentV02RunId =
    data.currentV02RunId === undefined || data.currentV02RunId === null
      ? null
      : positiveInteger(data.currentV02RunId, 'currentV02RunId');
  if (
    currentV02RunId !== null &&
    !attempts.some((attempt) => attempt.v02RunId === currentV02RunId)
  ) {
    throw new RunAiApproverV02Error('invalid_run_state', 'Phase 7 current attempt is missing');
  }
  return {
    inputs: {
      selectionMode: 'article_position_count',
      requestedArticleCount: articleCount,
      allowPastApprovedBoundary: true,
      allowDescriptionFallback: true
    },
    attempts,
    currentV02RunId
  };
};

const currentAttempt = (state: PhaseSevenState): PhaseSevenAttempt | null =>
  state.currentV02RunId === null
    ? null
    : state.attempts.find((attempt) => attempt.v02RunId === state.currentV02RunId) ?? null;

const countsRecord = (detail: AiApproverV02Detail): JsonRecord => ({
  plannedEligibleCount: detail.run.plannedEligibleCount,
  attemptedCount: detail.run.attemptedCount,
  completedCount: detail.run.completedCount,
  failedCount: detail.run.failedCount,
  invalidResponseCount: detail.run.invalidResponseCount,
  skippedCount: detail.run.skippedCount
});

const isActive = (status: string): boolean => status === 'queued' || status === 'running';

const monitoringLimitMilliseconds = (config: OpsConfig): number =>
  config.aiApproverV02MonitoringLimitHours * 60 * 60 * 1000;

const pollIntervalMilliseconds = (config: OpsConfig): number =>
  config.aiApproverV02StatusPollIntervalSeconds * 1000;

export async function runAiApproverV02(
  initialRun: WeeklyFlowRunRecord,
  config: OpsConfig,
  dependencies: RunAiApproverV02Dependencies
): Promise<RunAiApproverV02Result> {
  const { persistence, worker, now, delay, onEvent = () => undefined } = dependencies;
  if (
    initialRun.runCompleted ||
    initialRun.lastPhaseCompleted !== 6 ||
    initialRun.articleCount === null ||
    initialRun.articleCount <= 0
  ) {
    throw new RunAiApproverV02Error(
      'invalid_run_state',
      'Phase 7 requires incomplete Phase 6 completion with a positive articleCount'
    );
  }
  const inputs: AiApproverV02Inputs = {
    selectionMode: 'article_position_count',
    requestedArticleCount: initialRun.articleCount,
    allowPastApprovedBoundary: true,
    allowDescriptionFallback: true
  };
  let run = initialRun;
  if (run.lastPhaseStarted !== 7) {
    run = await persistence.recordPhaseSevenStarted(run.id, now(), inputs);
  }
  let state = phaseSevenState(run);
  let attempt = currentAttempt(state);
  let startedThisInvocation = false;
  let transientFailures = 0;

  const refresh = async (): Promise<void> => {
    const refreshed = await persistence.getRunById(run.id);
    if (!refreshed) {
      throw new RunAiApproverV02Error('invalid_run_state', `Weekly flow run ${run.id} disappeared`);
    }
    run = refreshed;
    state = phaseSevenState(run);
    attempt = currentAttempt(state);
  };

  const createAndStart = async (reason: string): Promise<RunAiApproverV02Result | null> => {
    if (startedThisInvocation) {
      throw new RunAiApproverV02Error(
        'unverified_outcome',
        'Phase 7 cannot start a second V02 job in one invocation'
      );
    }
    const preview = await worker.preview(inputs);
    if (preview.kind === 'zero_work') {
      const zeroWorkAfterPriorAttempts = state.attempts.some(
        (historicalAttempt) => historicalAttempt.jobId !== undefined
      );
      await persistence.recordPhaseSevenZeroWorkCompleted(
        run.id,
        now(),
        state.currentV02RunId,
        zeroWorkAfterPriorAttempts
      );
      return { kind: 'zero_work', zeroWorkAfterPriorAttempts };
    }
    run = await persistence.recordPhaseSevenPreview(
      run.id,
      {
        v02RunId: preview.preview.v02RunId,
        previewCreatedAt: preview.preview.previewCreatedAt,
        previewExpiresAt: preview.preview.previewExpiresAt,
        plannedEligibleCount: preview.preview.plannedEligibleCount,
        continuationReason: reason
      },
      state.currentV02RunId,
      run.aiApproverV02JobId
    );
    state = phaseSevenState(run);
    attempt = currentAttempt(state);
    startedThisInvocation = true;
    const started = await worker.start(preview.preview.v02RunId, preview.preview.previewToken);
    run = await persistence.recordPhaseSevenJobBound(
      run.id,
      started.v02RunId,
      started.jobId,
      now(),
      started.status
    );
    state = phaseSevenState(run);
    attempt = currentAttempt(state);
    onEvent({ event: 'started', v02RunId: started.v02RunId, jobId: started.jobId });
    return null;
  };

  if (attempt === null) {
    const result = await createAndStart('initial');
    if (result) return result;
  }

  while (attempt !== null) {
    let detail: AiApproverV02Detail;
    try {
      detail = await worker.detail({
        expectedV02RunId: attempt.v02RunId,
        expectedInputs: state.inputs,
        previewCreatedAt: attempt.previewCreatedAt,
        expectedJobId: attempt.jobId ?? null,
        acceptanceObserved: attempt.acceptedObservedAt !== undefined
      });
      transientFailures = 0;
    } catch (error: unknown) {
      if (error instanceof AiApproverV02ClientError) {
        if (error.category === 'transient_request') {
          transientFailures += 1;
          if (transientFailures <= config.aiApproverV02ToleratedConsecutiveStatusFailures) {
            await delay(pollIntervalMilliseconds(config));
            continue;
          }
        }
        if (error.category === 'unavailable_unaccepted_preview' && !startedThisInvocation) {
          const result = await createAndStart('unavailable_unaccepted_preview');
          if (result) return result;
          continue;
        }
      }
      throw error;
    }

    if (detail.run.jobId !== null && attempt.jobId === undefined) {
      run = await persistence.recordPhaseSevenJobBound(
        run.id,
        attempt.v02RunId,
        detail.run.jobId,
        now(),
        detail.run.status
      );
      state = phaseSevenState(run);
      attempt = currentAttempt(state);
      if (attempt === null) {
        throw new RunAiApproverV02Error('invalid_run_state', 'Adopted Phase 7 attempt disappeared');
      }
    }
    if (detail.run.status === 'queued' && detail.run.jobId === null) {
      throw new RunAiApproverV02Error(
        'orphaned_accepted_run',
        'Accepted V02 run is queued without an attached queue job ID'
      );
    }

    await persistence.recordPhaseSevenProgress(run.id, attempt.v02RunId, {
      observedAt: now(),
      status: detail.run.status,
      ...(detail.queueStatus ? { queueCreatedAt: detail.queueStatus.createdAt } : {}),
      ...(detail.run.endingReason ? { endingReason: detail.run.endingReason } : {}),
      counts: countsRecord(detail)
    });
    await refresh();
    if (attempt === null) {
      throw new RunAiApproverV02Error('invalid_run_state', 'Current Phase 7 attempt disappeared');
    }

    if (detail.run.status === 'completed') {
      if (attempt.monitoringLimitedAt !== undefined) {
        throw new RunAiApproverV02Error(
          'monitoring_limit',
          'A monitoring-limited V02 run cannot complete Phase 7'
        );
      }
      if (!detail.run.jobId) {
        throw new RunAiApproverV02Error('unverified_outcome', 'Completed V02 run has no job ID');
      }
      await persistence.recordPhaseSevenCompleted(
        run.id,
        now(),
        attempt.v02RunId,
        detail.run.jobId,
        { status: 'completed', ...countsRecord(detail), endingReason: detail.run.endingReason ?? null }
      );
      return {
        kind: 'completed',
        v02RunId: attempt.v02RunId,
        jobId: detail.run.jobId,
        counts: detail.run
      };
    }

    if (['failed', 'canceled', 'circuit_breaker'].includes(detail.run.status)) {
      if (startedThisInvocation) {
        throw new RunAiApproverV02Error(
          'unsuccessful_terminal_result',
          `V02 run ${attempt.v02RunId} ended with ${detail.run.status}`
        );
      }
      const result = await createAndStart(`saved_run_${detail.run.status}`);
      if (result) return result;
      continue;
    }

    if (!detail.queueStatus) {
      throw new RunAiApproverV02Error(
        'unverified_outcome',
        'Active durable V02 run has no matching queue evidence'
      );
    }
    const queueAge = now().getTime() - Date.parse(detail.queueStatus.createdAt);
    if (attempt.monitoringLimitedAt !== undefined || queueAge >= monitoringLimitMilliseconds(config)) {
      const limitedAt = now();
      if (attempt.monitoringLimitedAt === undefined) {
        await persistence.recordPhaseSevenProgress(run.id, attempt.v02RunId, {
          observedAt: limitedAt,
          status: detail.run.status,
          queueCreatedAt: detail.queueStatus.createdAt,
          monitoringLimitedAt: limitedAt
        });
      }
      const jobId = detail.run.jobId;
      if (!jobId) {
        throw new RunAiApproverV02Error('unverified_outcome', 'Active V02 run has no job ID');
      }
      const cancellationRequestedAt = now();
      const outcome = await worker.cancel(attempt.v02RunId, jobId);
      await persistence.recordPhaseSevenProgress(run.id, attempt.v02RunId, {
        observedAt: cancellationRequestedAt,
        status: detail.run.status,
        queueCreatedAt: detail.queueStatus.createdAt,
        monitoringLimitedAt: limitedAt,
        cancellationRequestedAt,
        cancellationOutcome: outcome,
        ...(outcome === 'canceled' ? { inactiveVerifiedAt: now() } : {})
      });
      if (outcome === 'cancel_requested') {
        await delay(pollIntervalMilliseconds(config));
        const finalDetail = await worker.detail({
          expectedV02RunId: attempt.v02RunId,
          expectedInputs: state.inputs,
          previewCreatedAt: attempt.previewCreatedAt,
          expectedJobId: jobId,
          acceptanceObserved: true
        });
        if (isActive(finalDetail.run.status)) {
          throw new RunAiApproverV02Error(
            'unverified_outcome',
            'V02 cancellation did not verify an inactive run'
          );
        }
        await persistence.recordPhaseSevenProgress(run.id, attempt.v02RunId, {
          observedAt: now(),
          status: finalDetail.run.status,
          ...(finalDetail.queueStatus ? { queueCreatedAt: finalDetail.queueStatus.createdAt } : {}),
          monitoringLimitedAt: limitedAt,
          cancellationRequestedAt,
          cancellationOutcome: outcome,
          inactiveVerifiedAt: now()
        });
      }
      throw new RunAiApproverV02Error(
        'monitoring_limit',
        `V02 run ${attempt.v02RunId} reached the monitoring limit`
      );
    }
    const remaining = monitoringLimitMilliseconds(config) - queueAge;
    await delay(Math.min(pollIntervalMilliseconds(config), Math.max(0, remaining)));
  }

  throw new RunAiApproverV02Error('invalid_run_state', 'Phase 7 has no current attempt');
}
