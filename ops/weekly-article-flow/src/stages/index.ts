import { WeeklyStageName } from '../database';

export interface StageExecutionContext {
  runId: number;
  deadline: Date;
  signal: AbortSignal;
}

export interface StageExecutionResult {
  stage: WeeklyStageName;
  status: 'completed' | 'skipped';
  evidence: Record<string, unknown>;
}

export type WeeklyStage = (context: StageExecutionContext) => Promise<StageExecutionResult>;
