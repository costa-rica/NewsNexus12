export type WeeklyFlowInvocation =
  | { mode: 'default' }
  | { mode: 'new' }
  | { mode: 'continue'; runId: number | null };

export class WeeklyFlowCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WeeklyFlowCliError';
  }
}

const parseRunId = (value: string): number => {
  const runId = Number(value);
  if (!Number.isSafeInteger(runId) || runId <= 0 || String(runId) !== value) {
    throw new WeeklyFlowCliError('--continue-run ID must be a positive integer');
  }
  return runId;
};

export const parseWeeklyFlowInvocation = (args: readonly string[]): WeeklyFlowInvocation => {
  if (args.length === 0) return { mode: 'default' };
  if (args.length === 1 && args[0] === '--new-run') return { mode: 'new' };
  if (args[0] === '--continue-run' && args.length <= 2) {
    return {
      mode: 'continue',
      runId: args.length === 2 ? parseRunId(args[1]) : null
    };
  }
  throw new WeeklyFlowCliError(
    'Usage: weekly-flow-02:start [--new-run | --continue-run [positive-run-id]]'
  );
};
