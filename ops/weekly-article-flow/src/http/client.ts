export type WorkerKind = 'node' | 'python';

export interface QueueJobRecord {
  jobId: string;
  endpointName: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'canceled';
  result?: Record<string, unknown>;
  failureReason?: string;
  parameters?: Record<string, unknown>;
}

export interface QueueStatusView {
  totalJobs: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  canceled: number;
}

export interface WorkerHttpClientOptions {
  workerNodeUrl: URL;
  workerPythonUrl: URL;
  requestTimeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class WorkerHttpError extends Error {
  public readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'WorkerHttpError';
    this.status = status;
  }
}

const safeBody = (value: string): string => value
  .replace(/("?(?:token|secret|password|key)[^:=\s]*"?\s*[:=]\s*)[^,}\s]+/gi, '$1[redacted]')
  .slice(0, 500);

const delay = (milliseconds: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('polling canceled'));
    }, { once: true });
  });

export class WorkerHttpClient {
  private readonly workerNodeUrl: URL;
  private readonly workerPythonUrl: URL;
  private readonly requestTimeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: WorkerHttpClientOptions) {
    this.workerNodeUrl = options.workerNodeUrl;
    this.workerPythonUrl = options.workerPythonUrl;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async requestJson<T>(
    worker: WorkerKind,
    pathname: string,
    init: RequestInit = {}
  ): Promise<T> {
    if (!pathname.startsWith('/') || pathname.startsWith('//')) {
      throw new WorkerHttpError('worker request path must be absolute and origin-relative');
    }
    const base = worker === 'node' ? this.workerNodeUrl : this.workerPythonUrl;
    const url = new URL(pathname, base);
    if (url.origin !== base.origin) {
      throw new WorkerHttpError('worker request escaped the allowlisted origin');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchFn(url, {
        ...init,
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...init.headers
        }
      });
      const text = await response.text();
      if (!response.ok) {
        throw new WorkerHttpError(
          `worker request failed (${response.status}): ${safeBody(text) || response.statusText}`,
          response.status
        );
      }
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new WorkerHttpError('worker returned invalid JSON', response.status);
      }
    } catch (error) {
      if (error instanceof WorkerHttpError) {
        throw error;
      }
      if (controller.signal.aborted) {
        throw new WorkerHttpError('worker request timed out');
      }
      throw new WorkerHttpError(error instanceof Error ? error.message : 'worker request failed');
    } finally {
      clearTimeout(timer);
    }
  }

  async startJob<TBody extends Record<string, unknown>>(
    worker: WorkerKind,
    endpointPath: string,
    body: TBody
  ): Promise<{ jobId: string; status: 'queued'; endpointName: string }> {
    return this.requestJson(worker, endpointPath, { method: 'POST', body: JSON.stringify(body) });
  }

  async getQueueJob(worker: WorkerKind, jobId: string): Promise<QueueJobRecord> {
    const result = await this.requestJson<{ job: QueueJobRecord }>(
      worker,
      `/queue-info/check-status/${encodeURIComponent(jobId)}`
    );
    return result.job;
  }

  async getLatestQueueJob(worker: WorkerKind, endpointName: string): Promise<QueueJobRecord | null> {
    const query = new URLSearchParams({ endpointName });
    const result = await this.requestJson<{ job: QueueJobRecord | null }>(
      worker,
      `/queue-info/latest-job?${query.toString()}`
    );
    return result.job;
  }

  async getQueueStatus(worker: WorkerKind): Promise<QueueStatusView> {
    const path = worker === 'node' ? '/queue-info/queue_status' : '/queue-info/queue-status';
    return this.requestJson(worker, path);
  }

  async cancelQueueJob(worker: WorkerKind, jobId: string): Promise<Record<string, unknown>> {
    const path = worker === 'node'
      ? `/queue-info/cancel_job/${encodeURIComponent(jobId)}`
      : `/queue-info/cancel-job/${encodeURIComponent(jobId)}`;
    return this.requestJson(worker, path, { method: 'POST' });
  }

  async pollQueueJob(
    worker: WorkerKind,
    jobId: string,
    options: { deadline: Date; initialMs: number; maxMs: number; signal?: AbortSignal }
  ): Promise<QueueJobRecord> {
    let waitMs = options.initialMs;
    while (Date.now() < options.deadline.getTime()) {
      const job = await this.getQueueJob(worker, jobId);
      if (['completed', 'failed', 'canceled'].includes(job.status)) {
        return job;
      }
      const remainingMs = options.deadline.getTime() - Date.now();
      await delay(Math.min(waitMs, remainingMs), options.signal);
      waitMs = Math.min(options.maxMs, waitMs * 2);
    }
    throw new WorkerHttpError(`queue job timed out: ${jobId}`);
  }
}
