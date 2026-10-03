import type { WeeklyFlowInvocation } from './cli';
import type { WeeklyFlowRunRecord } from './persistence';

export const WEEKLY_FLOW_CONTINUATION_WINDOW_HOURS = 72;
const CONTINUATION_WINDOW_MS = WEEKLY_FLOW_CONTINUATION_WINDOW_HOURS * 60 * 60 * 1000;

export type WeeklyFlowRunSelection =
  | { action: 'new'; reason: string }
  | { action: 'continue'; reason: string; run: WeeklyFlowRunRecord };

export class WeeklyFlowRunSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WeeklyFlowRunSelectionError';
  }
}

const validateNow = (now: Date): number => {
  const time = now.getTime();
  if (!Number.isFinite(time)) throw new WeeklyFlowRunSelectionError('Current time is invalid');
  return time;
};

const ageInMilliseconds = (run: WeeklyFlowRunRecord, now: Date): number => {
  const nowTime = validateNow(now);
  const startedTime = run.runStartedAt.getTime();
  if (!Number.isFinite(startedTime)) {
    throw new WeeklyFlowRunSelectionError(`Run ${run.id} has an invalid runStartedAt`);
  }
  const age = nowTime - startedTime;
  if (age < 0) {
    throw new WeeklyFlowRunSelectionError(`Run ${run.id} has a future runStartedAt`);
  }
  return age;
};

const canContinue = (run: WeeklyFlowRunRecord): boolean =>
  !run.runCompleted && (run.lastPhaseCompleted ?? 0) >= 3;

export const selectWeeklyFlowRun = (
  invocation: WeeklyFlowInvocation,
  candidate: WeeklyFlowRunRecord | null,
  now: Date
): WeeklyFlowRunSelection => {
  validateNow(now);

  if (invocation.mode === 'new') {
    return { action: 'new', reason: 'explicit new run requested' };
  }

  if (invocation.mode === 'continue') {
    if (!candidate) {
      throw new WeeklyFlowRunSelectionError('No requested weekly flow run was found');
    }
    if (candidate.runCompleted) {
      throw new WeeklyFlowRunSelectionError(`Run ${candidate.id} is already complete`);
    }
    if (!canContinue(candidate)) {
      throw new WeeklyFlowRunSelectionError(
        `Run ${candidate.id} stopped during Phases 1–3 and must be replaced by a new run`
      );
    }
    ageInMilliseconds(candidate, now);
    return { action: 'continue', reason: 'explicit continuation requested', run: candidate };
  }

  if (!candidate) return { action: 'new', reason: 'no previous run exists' };
  if (candidate.runCompleted) return { action: 'new', reason: 'latest run is complete' };
  if (!canContinue(candidate)) {
    return { action: 'new', reason: 'latest run stopped during Phases 1–3' };
  }
  if (ageInMilliseconds(candidate, now) > CONTINUATION_WINDOW_MS) {
    return { action: 'new', reason: 'latest incomplete run is older than 72 hours' };
  }
  return {
    action: 'continue',
    reason: 'latest incomplete run passed Phase 3 within 72 hours',
    run: candidate
  };
};
