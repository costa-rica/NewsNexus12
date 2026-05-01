import { GlobalQueueEngine } from '../queue/queueEngine';
import { globalQueueEngine } from '../queue/globalQueue';
import type { ChildJobHandle, ChildJobPollResult } from './types';
import logger from '../logger';

const getWorkerPythonBaseUrl = (): string => {
  const url = (process.env.URL_BASE_NEWS_NEXUS_WORKER_PYTHON ?? '').trim().replace(/\/+$/, '');
  if (!url) throw new Error('URL_BASE_NEWS_NEXUS_WORKER_PYTHON is not configured');
  return url;
};

const getWorkerNodeBaseUrl = (): string => {
  const port = process.env.PORT ?? '3002';
  return `http://localhost:${port}`;
};

type NodeJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled';

const mapNodeStatus = (status: NodeJobStatus, failureReason?: string): ChildJobPollResult => {
  switch (status) {
    case 'queued':
    case 'running':
      return { status: 'pending' };
    case 'completed':
      return { status: 'completed', result: null };
    case 'failed':
      return { status: 'failed', reason: failureReason ?? 'job failed' };
    case 'canceled':
      return { status: 'canceled' };
  }
};

const fetchJson = async <T>(url: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    const responseBody = await response.text().catch(() => '');
    const detail = responseBody.trim() !== '' ? `: ${responseBody}` : '';
    throw new Error(`HTTP ${response.status} from ${url}${detail}`);
  }
  return response.json() as Promise<T>;
};

export const startNodeJob = async (
  endpointName: string,
  body: Record<string, unknown>,
  orchestratorRunId: number,
  engine: GlobalQueueEngine = globalQueueEngine
): Promise<ChildJobHandle> => {
  const baseUrl = getWorkerNodeBaseUrl();
  const url = `${baseUrl}${endpointName}`;

  const data = await fetchJson<{ jobId: string }>(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Orchestrator-Run-Id': String(orchestratorRunId),
    },
    body: JSON.stringify(body),
  });

  const { jobId } = data;
  logger.info('childJobClient: started node job', { jobId, endpointName });

  return {
    jobId,
    poll: async (): Promise<ChildJobPollResult> => {
      const record = await engine.getCheckStatus(jobId);
      if (!record) {
        return { status: 'failed', reason: `job ${jobId} not found in queue` };
      }
      if (record.status === 'completed') {
        return { status: 'completed', result: record.result ?? null };
      }
      return mapNodeStatus(record.status, record.failureReason);
    },
    cancel: async (): Promise<void> => {
      try {
        await engine.cancelJob(jobId);
      } catch (err) {
        logger.warn('childJobClient: cancel node job failed', {
          jobId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
};

export const startPythonJob = async (
  endpointPath: string,
  body: Record<string, unknown>,
  orchestratorRunId: number
): Promise<ChildJobHandle> => {
  const baseUrl = getWorkerPythonBaseUrl();
  const url = `${baseUrl}${endpointPath}`;

  const data = await fetchJson<{ jobId: string }>(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Orchestrator-Run-Id': String(orchestratorRunId),
    },
    body: JSON.stringify(body),
  });

  const { jobId } = data;
  logger.info('childJobClient: started python job', { jobId, endpointPath });

  return {
    jobId,
    poll: async (): Promise<ChildJobPollResult> => {
      const statusUrl = `${baseUrl}/queue-info/check-status/${jobId}`;
      const statusData = await fetchJson<{ job: { status: string; result?: Record<string, unknown>; failureReason?: string } }>(statusUrl);
      const job = statusData.job;
      switch (job.status) {
        case 'queued':
        case 'running':
          return { status: 'pending' };
        case 'completed':
          return { status: 'completed', result: job.result ?? null };
        case 'failed':
          return { status: 'failed', reason: job.failureReason ?? 'python job failed' };
        case 'canceled':
          return { status: 'canceled' };
        default:
          return { status: 'pending' };
      }
    },
    cancel: async (): Promise<void> => {
      try {
        const cancelUrl = `${baseUrl}/queue-info/cancel-job/${jobId}`;
        await fetchJson(cancelUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      } catch (err) {
        logger.warn('childJobClient: cancel python job failed', {
          jobId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
};
