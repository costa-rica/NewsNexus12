import { AiApproverRunV02Status } from '@newsnexus/db-models';
import { WorkerHttpClient, WorkerHttpError } from '../http';
import { V02Reconciliation } from '../database';

export interface V02PreviewResponse {
  id: number;
  status: 'draft';
  selectionMode: 'article_position_count';
  requestedArticleCount: number;
  allowDescriptionFallback: boolean;
  allowPastApprovedBoundary: boolean;
  plannedEligibleCount: number;
  selectionSnapshot: Array<{ articleId: number }>;
  previewToken: string;
  previewExpiresAt: string;
}

export interface V02PreviewEvidence {
  draftRunId: number;
  previewExpiresAt: string;
  plannedEligibleCount: number;
  selectedArticleIds: number[];
  cohortArticleIds: number[];
  overlapArticleIds: number[];
  overlapCount: number;
  overlapPercentage: number;
}

export interface V02AcceptedEvidence extends V02PreviewEvidence {
  v02RunId: number;
  jobId: string;
}

interface V02RunView {
  id: number;
  jobId: string | null;
  status: AiApproverRunV02Status;
  endingReason: string | null;
}

interface V02StatusResponse {
  run: V02RunView;
  queueStatus: {
    jobId: string;
    status: 'queued' | 'running' | 'completed' | 'failed' | 'canceled';
    failureReason?: string;
  } | null;
}

export interface V02TerminalEvidence {
  v02RunId: number;
  jobId: string;
  runStatus: AiApproverRunV02Status;
  queueStatus: 'completed' | 'failed' | 'canceled';
  endingReason: string | null;
}

export interface V02OutcomeEvidence {
  selectedArticleIds: number[];
  attemptedArticleIds: number[];
  completedArticleIds: number[];
  failedArticleIds: number[];
  invalidResponseArticleIds: number[];
  skippedArticleIds: number[];
  unattemptedArticleIds: number[];
  unresolvedArticleIds: number[];
  selectedCount: number;
  attemptedCount: number;
  completedCount: number;
  failedCount: number;
  invalidResponseCount: number;
  skippedCount: number;
  unattemptedCount: number;
}

const positiveInteger = (value: unknown, label: string): number => {
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(`invalid V02 ${label}`);
  return Number(value);
};

const uniqueIds = (values: unknown, label: string): number[] => {
  if (!Array.isArray(values)) throw new Error(`invalid V02 ${label}`);
  const ids = values.map((value) => positiveInteger(
    typeof value === 'object' && value !== null ? (value as { articleId?: unknown }).articleId : value,
    label
  ));
  if (new Set(ids).size !== ids.length) throw new Error(`duplicate IDs in V02 ${label}`);
  return ids;
};

export const createV02Preview = async (input: {
  client: WorkerHttpClient;
  requestedArticleCount: number;
  cohortArticleIds: number[];
}): Promise<{ evidence: V02PreviewEvidence; previewToken: string }> => {
  const preview = await input.client.requestJson<V02PreviewResponse>('python', '/ai-approver-v02/preview', {
    method: 'POST',
    body: JSON.stringify({
      selectionMode: 'article_position_count',
      requestedArticleCount: input.requestedArticleCount,
      allowDescriptionFallback: true,
      allowPastApprovedBoundary: true
    })
  });
  const draftRunId = positiveInteger(preview.id, 'draft run ID');
  const selectedArticleIds = uniqueIds(preview.selectionSnapshot, 'selection snapshot');
  if (preview.status !== 'draft' || typeof preview.previewToken !== 'string' || preview.previewToken.length === 0) {
    throw new Error('invalid V02 preview response');
  }
  if (
    preview.selectionMode !== 'article_position_count' ||
    preview.requestedArticleCount !== input.requestedArticleCount ||
    preview.allowDescriptionFallback !== true ||
    preview.allowPastApprovedBoundary !== true
  ) throw new Error('V02 preview did not echo the requested selection contract');
  const expiry = new Date(preview.previewExpiresAt);
  if (Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) throw new Error('invalid V02 preview expiry');
  if (preview.plannedEligibleCount !== selectedArticleIds.length) {
    throw new Error('V02 planned eligible count does not match the frozen selection');
  }
  const cohort = new Set(input.cohortArticleIds);
  const overlapArticleIds = selectedArticleIds.filter((id) => cohort.has(id));
  return {
    previewToken: preview.previewToken,
    evidence: {
      draftRunId,
      previewExpiresAt: expiry.toISOString(),
      plannedEligibleCount: preview.plannedEligibleCount,
      selectedArticleIds,
      cohortArticleIds: [...input.cohortArticleIds],
      overlapArticleIds,
      overlapCount: overlapArticleIds.length,
      overlapPercentage: input.cohortArticleIds.length === 0
        ? 0
        : Number(((overlapArticleIds.length / input.cohortArticleIds.length) * 100).toFixed(2))
    }
  };
};

export const acceptV02Preview = async (
  client: WorkerHttpClient,
  evidence: V02PreviewEvidence,
  previewToken: string
): Promise<V02AcceptedEvidence> => {
  const accepted = await client.requestJson<{ runId: number; jobId: string; status: 'queued' }>(
    'python',
    '/ai-approver-v02/start',
    { method: 'POST', body: JSON.stringify({ runId: evidence.draftRunId, previewToken }) }
  );
  if (positiveInteger(accepted.runId, 'accepted run ID') !== evidence.draftRunId) {
    throw new Error('V02 accepted a different run ID');
  }
  if (accepted.status !== 'queued' || typeof accepted.jobId !== 'string' || accepted.jobId.length === 0) {
    throw new Error('invalid V02 acceptance response');
  }
  return { ...evidence, v02RunId: accepted.runId, jobId: accepted.jobId };
};

const terminalRunStatuses = new Set<AiApproverRunV02Status>([
  'completed', 'canceled', 'failed', 'circuit_breaker'
]);
const terminalQueueStatuses = new Set(['completed', 'failed', 'canceled']);

const pause = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const pollV02Terminal = async (input: {
  client: WorkerHttpClient;
  v02RunId: number;
  jobId: string;
  deadline: Date;
  polling: { initialMs: number; maxMs: number };
}): Promise<V02TerminalEvidence> => {
  let waitMs = input.polling.initialMs;
  while (Date.now() < input.deadline.getTime()) {
    let response: V02StatusResponse;
    try {
      response = await input.client.requestJson<V02StatusResponse>(
          'python',
          `/ai-approver-v02/runs/${encodeURIComponent(input.v02RunId)}`
        );
    } catch (error) {
      if (!(error instanceof WorkerHttpError)) throw error;
      if (error.status !== null && error.status < 500) throw error;
      const remaining = input.deadline.getTime() - Date.now();
      if (remaining <= 0) break;
      await pause(Math.min(waitMs, remaining));
      waitMs = Math.min(input.polling.maxMs, waitMs * 2);
      continue;
    }
      if (response.run.id !== input.v02RunId || response.run.jobId !== input.jobId) {
        throw new Error('V02 status identifiers do not match accepted evidence');
      }
      if (
        terminalRunStatuses.has(response.run.status) &&
        response.queueStatus !== null &&
        response.queueStatus.jobId === input.jobId &&
        terminalQueueStatuses.has(response.queueStatus.status)
      ) {
        return {
          v02RunId: input.v02RunId,
          jobId: input.jobId,
          runStatus: response.run.status,
          queueStatus: response.queueStatus.status as V02TerminalEvidence['queueStatus'],
          endingReason: response.run.endingReason
        };
      }
      const remaining = input.deadline.getTime() - Date.now();
      await pause(Math.min(waitMs, remaining));
      waitMs = Math.min(input.polling.maxMs, waitMs * 2);
  }
  try {
    await input.client.requestJson('python', `/ai-approver-v02/runs/${encodeURIComponent(input.v02RunId)}/cancel`, {
      method: 'POST'
    });
  } catch {
    // The timeout remains authoritative even if cancellation cannot be confirmed.
  }
  throw new Error(`AI Approver V02 timed out: ${input.v02RunId}`);
};

export const cancelV02Run = async (
  client: WorkerHttpClient,
  v02RunId: number
): Promise<Record<string, unknown>> => client.requestJson(
  'python',
  `/ai-approver-v02/runs/${encodeURIComponent(v02RunId)}/cancel`,
  { method: 'POST' }
);

export const reconcileV02Outcomes = (evidence: V02Reconciliation): V02OutcomeEvidence => {
  const selectedArticleIds = uniqueIds(evidence.selectedArticleIds, 'selected article IDs');
  const selected = new Set(selectedArticleIds);
  const predictionIds = uniqueIds(evidence.predictions.map(({ articleId }) => articleId), 'prediction IDs');
  if (predictionIds.some((id) => !selected.has(id))) throw new Error('V02 prediction is outside the frozen selection');

  const completedArticleIds = evidence.predictions.filter(({ resultStatus }) => resultStatus === 'completed').map(({ articleId }) => articleId);
  const failedArticleIds = evidence.predictions.filter(({ resultStatus }) => resultStatus === 'failed').map(({ articleId }) => articleId);
  const invalidResponseArticleIds = evidence.predictions.filter(({ resultStatus }) => resultStatus === 'invalid_response').map(({ articleId }) => articleId);
  if (completedArticleIds.length + failedArticleIds.length + invalidResponseArticleIds.length !== predictionIds.length) {
    throw new Error('V02 prediction has an unsupported terminal result');
  }

  if (evidence.run.attemptedCount !== predictionIds.length || evidence.run.attemptedCount + evidence.run.skippedCount > selectedArticleIds.length) {
    throw new Error('V02 run counts do not reconcile with predictions and selection');
  }
  if (
    evidence.run.completedCount !== completedArticleIds.length ||
    evidence.run.failedCount !== failedArticleIds.length ||
    evidence.run.invalidResponseCount !== invalidResponseArticleIds.length
  ) throw new Error('V02 terminal counts do not reconcile with predictions');

  const attempted = new Set(predictionIds);
  const processedCount = evidence.run.attemptedCount + evidence.run.skippedCount;
  const orderedSelection = [...selectedArticleIds].sort((a, b) => b - a);
  const processedSelection = orderedSelection.slice(0, processedCount);
  const processed = new Set(processedSelection);
  if (predictionIds.some((id) => !processed.has(id))) {
    throw new Error('V02 prediction lies outside the processed frozen-selection prefix');
  }
  const completedRun = evidence.run.status === 'completed';
  if (completedRun && processedCount !== selectedArticleIds.length) {
    throw new Error('completed V02 run left frozen selections unprocessed');
  }
  const skippedArticleIds = processedSelection.filter((id) => !attempted.has(id));
  if (skippedArticleIds.length !== evidence.run.skippedCount) throw new Error('V02 skipped IDs do not reconcile');
  const unattemptedArticleIds = orderedSelection.slice(processedCount);
  const unresolvedArticleIds: number[] = [];
  const unattemptedCount = unattemptedArticleIds.length;
  return {
    selectedArticleIds: orderedSelection,
    attemptedArticleIds: predictionIds,
    completedArticleIds,
    failedArticleIds,
    invalidResponseArticleIds,
    skippedArticleIds,
    unattemptedArticleIds,
    unresolvedArticleIds,
    selectedCount: selectedArticleIds.length,
    attemptedCount: predictionIds.length,
    completedCount: completedArticleIds.length,
    failedCount: failedArticleIds.length,
    invalidResponseCount: invalidResponseArticleIds.length,
    skippedCount: evidence.run.skippedCount,
    unattemptedCount
  };
};
