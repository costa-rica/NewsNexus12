import { randomUUID } from 'node:crypto';
import { QueueJobStore, resolveDefaultQueueStorePath } from './jobStore';
import { QueueJobRecord } from './types';
import { QueueStatusView, getCheckStatusByJobId, getQueueStatus } from './queueStatus';

export interface CancelableProcessHandle {
  kill: (signal?: NodeJS.Signals | number) => boolean;
}

export interface QueueExecutionContext {
  jobId: string;
  endpointName: string;
  signal: AbortSignal;
  registerCancelableProcess: (processHandle: CancelableProcessHandle) => void;
}

export type QueueJobHandler = (context: QueueExecutionContext) => Promise<void>;

export interface EnqueueJobInput {
  endpointName: string;
  run: QueueJobHandler;
  jobId?: string;
}

export interface EnqueueJobResult {
  jobId: string;
  status: 'queued';
}

export interface CancelJobResult {
  jobId: string;
  outcome: 'canceled' | 'cancel_requested' | 'not_found';
}

export interface QueueEngineOptions {
  createJobId?: () => string;
  now?: () => Date;
  cancelGraceMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

interface PendingQueueItem {
  jobId: string;
  endpointName: string;
  run: QueueJobHandler;
}

interface ActiveJobState {
  jobId: string;
  abortController: AbortController;
  cancelRequested: boolean;
  processHandles: Set<CancelableProcessHandle>;
  sigkillTimer?: ReturnType<typeof setTimeout>;
}

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  return 'job_failed';
};

export class GlobalQueueEngine {
  private readonly store: QueueJobStore;
  private readonly createJobId: () => string;
  private readonly now: () => Date;
  private readonly cancelGraceMs: number;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;

  private readonly pendingQueue: PendingQueueItem[] = [];
  private activeJob: ActiveJobState | null = null;
  private processLoopRunning = false;
  private idleWaiters: Array<() => void> = [];

  constructor(store: QueueJobStore, options: QueueEngineOptions = {}) {
    this.store = store;
    this.createJobId = options.createJobId ?? (() => randomUUID());
    this.now = options.now ?? (() => new Date());
    this.cancelGraceMs = options.cancelGraceMs ?? 10_000;
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  }

  public async enqueueJob(input: EnqueueJobInput): Promise<EnqueueJobResult> {
    await this.store.ensureInitialized();

    const jobId = input.jobId ?? this.createJobId();
    const nowIso = this.now().toISOString();

    const jobRecord: QueueJobRecord = {
      jobId,
      endpointName: input.endpointName,
      status: 'queued',
      createdAt: nowIso
    };

    await this.store.appendJob(jobRecord);

    this.pendingQueue.push({
      jobId,
      endpointName: input.endpointName,
      run: input.run
    });

    this.triggerProcessLoop();

    return {
      jobId,
      status: 'queued'
    };
  }

  public async getCheckStatus(jobId: string): Promise<QueueJobRecord | null> {
    return getCheckStatusByJobId(this.store, jobId);
  }

  public async getQueueStatusView(): Promise<QueueStatusView> {
    return getQueueStatus(this.store);
  }

  public async getLatestJobByEndpointName(
    endpointName: string
  ): Promise<QueueJobRecord | null> {
    await this.store.ensureInitialized();

    const jobs = await this.store.getJobs();
    const matchingJobs = jobs.filter((job) => job.endpointName === endpointName);

    if (matchingJobs.length === 0) {
      return null;
    }

    return matchingJobs.reduce((latest, candidate) => {
      return new Date(candidate.createdAt).getTime() >= new Date(latest.createdAt).getTime()
        ? candidate
        : latest;
    });
  }

  public async cancelJob(jobId: string): Promise<CancelJobResult> {
    await this.store.ensureInitialized();

    const queuedIndex = this.pendingQueue.findIndex((job) => job.jobId === jobId);
    if (queuedIndex >= 0) {
      this.pendingQueue.splice(queuedIndex, 1);
      await this.store.updateJob(jobId, (job) => ({
        ...job,
        status: 'canceled',
        endedAt: this.now().toISOString(),
        failureReason: 'canceled_before_start'
      }));

      this.resolveIdleIfEmpty();
      return { jobId, outcome: 'canceled' };
    }

    if (this.activeJob?.jobId === jobId) {
      this.activeJob.cancelRequested = true;
      this.activeJob.abortController.abort();

      this.sendSignalToActiveProcesses(this.activeJob, 'SIGTERM');
      this.scheduleForceKillIfNeeded(this.activeJob);

      return { jobId, outcome: 'cancel_requested' };
    }

    return { jobId, outcome: 'not_found' };
  }

  public async onIdle(): Promise<void> {
    if (this.pendingQueue.length === 0 && this.activeJob === null) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  public getRunningJobId(): string | null {
    return this.activeJob?.jobId ?? null;
  }

  private triggerProcessLoop(): void {
    if (this.processLoopRunning) {
      return;
    }

    this.processLoopRunning = true;

    void this.processQueueLoop()
      .catch(() => {
        // Unhandled failures are captured per-job and persisted in job status.
      })
      .finally(() => {
        this.processLoopRunning = false;
        if (this.pendingQueue.length > 0) {
          this.triggerProcessLoop();
          return;
        }
        this.resolveIdleIfEmpty();
      });
  }

  private async processQueueLoop(): Promise<void> {
    while (this.pendingQueue.length > 0) {
      const next = this.pendingQueue.shift();
      if (!next) {
        continue;
      }

      await this.executeJob(next);
    }
  }

  private async executeJob(item: PendingQueueItem): Promise<void> {
    const activeJob: ActiveJobState = {
      jobId: item.jobId,
      abortController: new AbortController(),
      cancelRequested: false,
      processHandles: new Set<CancelableProcessHandle>()
    };
    this.activeJob = activeJob;

    await this.store.updateJob(item.jobId, (job) => ({
      ...job,
      status: 'running',
      startedAt: this.now().toISOString()
    }));

    try {
      await item.run({
        jobId: item.jobId,
        endpointName: item.endpointName,
        signal: activeJob.abortController.signal,
        registerCancelableProcess: (processHandle: CancelableProcessHandle) => {
          if (this.activeJob?.jobId !== item.jobId) {
            return;
          }
          this.activeJob.processHandles.add(processHandle);
        }
      });

      if (activeJob.cancelRequested || activeJob.abortController.signal.aborted) {
        await this.persistCanceledStatus(item.jobId, 'canceled_by_request');
      } else {
        await this.store.updateJob(item.jobId, (job) => ({
          ...job,
          status: 'completed',
          endedAt: this.now().toISOString(),
          failureReason: undefined
        }));
      }
    } catch (error) {
      if (activeJob.cancelRequested || activeJob.abortController.signal.aborted) {
        await this.persistCanceledStatus(item.jobId, 'canceled_by_request');
      } else {
        await this.store.updateJob(item.jobId, (job) => ({
          ...job,
          status: 'failed',
          endedAt: this.now().toISOString(),
          failureReason: getErrorMessage(error)
        }));
      }
    } finally {
      if (activeJob.sigkillTimer) {
        this.clearTimeoutFn(activeJob.sigkillTimer);
      }
      this.activeJob = null;
      this.resolveIdleIfEmpty();
    }
  }

  private async persistCanceledStatus(jobId: string, fallbackReason: string): Promise<void> {
    await this.store.updateJob(jobId, (job) => ({
      ...job,
      status: 'canceled',
      endedAt: this.now().toISOString(),
      failureReason: job.failureReason ?? fallbackReason
    }));
  }

  private sendSignalToActiveProcesses(activeJob: ActiveJobState, signal: NodeJS.Signals): void {
    for (const handle of activeJob.processHandles) {
      try {
        handle.kill(signal);
      } catch {
        // Ignore individual process signal failures; status transitions are handled by job lifecycle.
      }
    }
  }

  private scheduleForceKillIfNeeded(activeJob: ActiveJobState): void {
    if (activeJob.sigkillTimer || activeJob.processHandles.size === 0) {
      return;
    }

    activeJob.sigkillTimer = this.setTimeoutFn(() => {
      if (!this.activeJob || this.activeJob.jobId !== activeJob.jobId) {
        return;
      }
      if (!this.activeJob.cancelRequested) {
        return;
      }
      this.sendSignalToActiveProcesses(this.activeJob, 'SIGKILL');
    }, this.cancelGraceMs);
  }

  private resolveIdleIfEmpty(): void {
    if (this.pendingQueue.length > 0 || this.activeJob !== null) {
      return;
    }

    const waiters = [...this.idleWaiters];
    this.idleWaiters = [];
    waiters.forEach((resolve) => resolve());
  }
}

export const createGlobalQueueEngine = (
  queueStorePath: string = resolveDefaultQueueStorePath(),
  options: QueueEngineOptions = {}
): GlobalQueueEngine => {
  const store = new QueueJobStore(queueStorePath);
  return new GlobalQueueEngine(store, options);
};
