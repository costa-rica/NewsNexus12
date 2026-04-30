export const queueJobStatuses = [
  'queued',
  'running',
  'completed',
  'failed',
  'canceled'
] as const;

export type QueueJobStatus = (typeof queueJobStatuses)[number];

export interface QueueJobRecord {
  jobId: string;
  endpointName: string;
  status: QueueJobStatus;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  failureReason?: string;
  parameters?: Record<string, unknown>;
  result?: Record<string, unknown>;
  logs?: string[];
}

export interface QueueJobStoreData {
  jobs: QueueJobRecord[];
}

export interface QueueStatusSummary {
  totalJobs: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  canceled: number;
}
