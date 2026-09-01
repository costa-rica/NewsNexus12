import { WeeklyArticleFlowMode } from '@newsnexus/db-models';
import {
  validateRssResult,
  validateSemanticResult,
  validateStateResult,
  ValidatedRssResult,
  ValidatedSemanticResult,
  ValidatedStateResult
} from '../contracts';
import { QueueJobRecord, WorkerHttpClient, WorkerKind } from '../http';

export interface WorkerStageEvidence<T> {
  jobId: string;
  queueStatus: QueueJobRecord['status'];
  result: T;
}

const waitForJob = async (
  client: WorkerHttpClient,
  worker: WorkerKind,
  jobId: string,
  deadline: Date,
  polling: { initialMs: number; maxMs: number }
): Promise<QueueJobRecord> => {
  try {
    return await client.pollQueueJob(worker, jobId, { deadline, ...polling });
  } catch (error) {
    try {
      await client.cancelQueueJob(worker, jobId);
    } catch {
      // Preserve the original timeout or polling error.
    }
    throw error;
  }
};

const requireCompletedQueueResult = (job: QueueJobRecord): Record<string, unknown> => {
  if (job.status !== 'completed' || !job.result) {
    throw new Error(`worker job did not complete successfully: ${job.status}`);
  }
  return job.result;
};

export const classifyRssEnding = (
  mode: WeeklyArticleFlowMode,
  endingReason: string,
  targetConfigured: boolean
): 'accepted' | 'rate_limited' | 'canceled' | 'failed' => {
  if (endingReason === 'queries_exhausted') {
    return 'accepted';
  }
  if (
    endingReason === 'target_articles_collected' &&
    (mode === 'dev_canary' || (mode === 'dev_destructive_recovery' && targetConfigured))
  ) {
    return 'accepted';
  }
  if (endingReason === 'rate_limited') {
    return 'rate_limited';
  }
  if (endingReason === 'canceled' || endingReason === 'aborted') {
    return 'canceled';
  }
  return 'failed';
};

export const runRssWorkerStage = async (input: {
  client: WorkerHttpClient;
  runId: number;
  mode: WeeklyArticleFlowMode;
  targetArticlesAddedCount?: number;
  previousJobId?: string;
  onJobStarted?: (jobId: string) => Promise<void>;
  deadline: Date;
  polling: { initialMs: number; maxMs: number };
}): Promise<WorkerStageEvidence<ValidatedRssResult>> => {
  if (
    (input.mode === 'manual_production' || input.mode === 'scheduled_production') &&
    input.targetArticlesAddedCount !== undefined
  ) {
    throw new Error('production RSS must not use a target count');
  }
  let jobId = input.previousJobId;
  if (!jobId) {
    jobId = (await input.client.startJob(
      'node',
      '/request-google-rss/start-job',
      {
        weeklyArticleFlowRunId: input.runId,
        ...(input.targetArticlesAddedCount !== undefined
          ? { targetArticlesAddedCount: input.targetArticlesAddedCount }
          : {})
      }
    )).jobId;
    await input.onJobStarted?.(jobId);
  }
  const job = await waitForJob(input.client, 'node', jobId, input.deadline, input.polling);
  return {
    jobId,
    queueStatus: job.status,
    result: validateRssResult(requireCompletedQueueResult(job))
  };
};

export const runSemanticWorkerStage = async (input: {
  client: WorkerHttpClient;
  previousJobId?: string;
  onJobStarted?: (jobId: string) => Promise<void>;
  deadline: Date;
  polling: { initialMs: number; maxMs: number };
}): Promise<WorkerStageEvidence<ValidatedSemanticResult>> => {
  let jobId = input.previousJobId;
  if (!jobId) {
    jobId = (await input.client.startJob('node', '/semantic-scorer/start-job', {})).jobId;
    await input.onJobStarted?.(jobId);
  }
  const job = await waitForJob(input.client, 'node', jobId, input.deadline, input.polling);
  return {
    jobId,
    queueStatus: job.status,
    result: validateSemanticResult(requireCompletedQueueResult(job))
  };
};

export const runStateWorkerStage = async (input: {
  client: WorkerHttpClient;
  articleIds: number[];
  requestedCapacity: number;
  previousJobId?: string;
  onJobStarted?: (jobId: string) => Promise<void>;
  deadline: Date;
  polling: { initialMs: number; maxMs: number };
}): Promise<WorkerStageEvidence<ValidatedStateResult>> => {
  if (input.articleIds.length === 0 || input.requestedCapacity < input.articleIds.length) {
    throw new Error('state assignment requires exact IDs and sufficient capacity');
  }
  let jobId = input.previousJobId;
  if (!jobId) {
    jobId = (await input.client.startJob(
      'node',
      '/state-assigner/start-job',
      {
        articleIds: input.articleIds,
        targetArticleStateReviewCount: input.requestedCapacity
      }
    )).jobId;
    await input.onJobStarted?.(jobId);
  }
  const job = await waitForJob(input.client, 'node', jobId, input.deadline, input.polling);
  return {
    jobId,
    queueStatus: job.status,
    result: validateStateResult(requireCompletedQueueResult(job))
  };
};
