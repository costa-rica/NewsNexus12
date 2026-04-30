import type { OrchestratorRunStatus, OrchestratorRunStepStatus, OrchestratorRunStepName } from '@newsnexus/db-models';

export type { OrchestratorRunStatus, OrchestratorRunStepStatus, OrchestratorRunStepName };

export interface OrchestratorConfig {
  aiApproverEnabled: boolean;
  semanticScorerEnabled: boolean;
}

export interface StepConfig {
  stepName: OrchestratorRunStepName;
  stepOrder: number;
  enabled: boolean;
  timeoutSeconds: number;
  worker: 'node' | 'python' | 'internal';
  endpointName: string;
}

export const STEP_DEFAULTS: StepConfig[] = [
  {
    stepName: 'delete_articles',
    stepOrder: 1,
    enabled: true,
    timeoutSeconds: 30 * 60,
    worker: 'node',
    endpointName: '/delete-articles/start-job',
  },
  {
    stepName: 'google_rss',
    stepOrder: 2,
    enabled: true,
    timeoutSeconds: 24 * 60 * 60,
    worker: 'node',
    endpointName: '/request-google-rss/start-job',
  },
  {
    stepName: 'state_assigner',
    stepOrder: 3,
    enabled: true,
    timeoutSeconds: 8 * 60 * 60,
    worker: 'node',
    endpointName: '/state-assigner/start-job',
  },
  {
    stepName: 'ai_approver',
    stepOrder: 4,
    enabled: true,
    timeoutSeconds: 8 * 60 * 60,
    worker: 'python',
    endpointName: '/ai-approver/start-job',
  },
  {
    stepName: 'semantic_scorer',
    stepOrder: 5,
    enabled: true,
    timeoutSeconds: 4 * 60 * 60,
    worker: 'node',
    endpointName: '/semantic-scorer/start-job',
  },
  {
    stepName: 'report',
    stepOrder: 6,
    enabled: true,
    timeoutSeconds: 5 * 60,
    worker: 'internal',
    endpointName: 'internal/report',
  },
];

export type OrchestratorRunRow = {
  id: number;
  status: OrchestratorRunStatus;
  startedAt: Date;
  endedAt: Date | null;
  articleIdMinExclusive: number | null;
  articleIdMaxInclusive: number | null;
  reportFilePath: string | null;
  failureReason: string | null;
  aiApproverEnabled: boolean;
  semanticScorerEnabled: boolean;
  userId: number | null;
};

export type OrchestratorRunStepRow = {
  id: number;
  orchestratorRunId: number;
  stepName: OrchestratorRunStepName;
  stepOrder: number;
  enabled: boolean;
  status: OrchestratorRunStepStatus;
  childJobId: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  result: Record<string, unknown> | null;
  endingReason: string | null;
  endingMessage: string | null;
};

export interface ChildJobHandle {
  jobId: string;
  poll: () => Promise<ChildJobPollResult>;
  cancel: () => Promise<void>;
}

export type ChildJobPollResult =
  | { status: 'pending' }
  | { status: 'completed'; result: Record<string, unknown> | null }
  | { status: 'failed'; reason: string }
  | { status: 'canceled' };
