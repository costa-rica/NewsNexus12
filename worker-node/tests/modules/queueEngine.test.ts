import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { QueueJobStore } from '../../src/modules/queue/jobStore';
import { CancelableProcessHandle, GlobalQueueEngine } from '../../src/modules/queue/queueEngine';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const waitForCondition = async (predicate: () => Promise<boolean>, timeoutMs = 1000): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await wait(5);
  }
  throw new Error('Timed out waiting for condition');
};

describe('GlobalQueueEngine', () => {
  let tempDirPath = '';
  let store: QueueJobStore;
  let idCounter = 0;

  const nextJobId = (): string => {
    idCounter += 1;
    return `job-${idCounter}`;
  };

  beforeEach(async () => {
    tempDirPath = await fs.mkdtemp(path.join(os.tmpdir(), 'queue-engine-test-'));
    store = new QueueJobStore(path.join(tempDirPath, 'queue-jobs.json'));
    await store.ensureInitialized();
    idCounter = 0;
  });

  afterEach(async () => {
    await fs.rm(tempDirPath, { recursive: true, force: true });
  });

  it('processes jobs in FIFO order with global single concurrency', async () => {
    const started: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const engine = new GlobalQueueEngine(store, {
      createJobId: nextJobId
    });

    await engine.enqueueJob({
      endpointName: '/semantic-scorer/start-job',
      run: async () => {
        started.push('job-1');
        await firstGate;
      }
    });

    await engine.enqueueJob({
      endpointName: '/state-assigner/start-job',
      run: async () => {
        started.push('job-2');
      }
    });

    await waitForCondition(async () => (await store.getJobById('job-1'))?.status === 'running');

    expect(started).toEqual(['job-1']);
    expect((await store.getJobById('job-2'))?.status).toBe('queued');

    releaseFirst?.();
    await engine.onIdle();

    expect(started).toEqual(['job-1', 'job-2']);
    expect((await store.getJobById('job-1'))?.status).toBe('completed');
    expect((await store.getJobById('job-2'))?.status).toBe('completed');
  });

  it('persists optional non-secret job parameters', async () => {
    const engine = new GlobalQueueEngine(store, {
      createJobId: nextJobId
    });

    await engine.enqueueJob({
      endpointName: '/state-assigner/start-job',
      parameters: {
        targetArticleThresholdDaysOld: 180,
        targetArticleStateReviewCount: 25
      },
      run: async () => undefined
    });
    await engine.onIdle();

    expect((await store.getJobById('job-1'))?.parameters).toEqual({
      targetArticleThresholdDaysOld: 180,
      targetArticleStateReviewCount: 25
    });
  });

  it('omits parameters when an enqueue caller does not supply them', async () => {
    const engine = new GlobalQueueEngine(store, {
      createJobId: nextJobId
    });

    await engine.enqueueJob({
      endpointName: '/semantic-scorer/start-job',
      run: async () => undefined
    });
    await engine.onIdle();

    expect((await store.getJobById('job-1'))?.parameters).toBeUndefined();
  });

  it('cancels a queued job immediately', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const engine = new GlobalQueueEngine(store, {
      createJobId: nextJobId
    });

    await engine.enqueueJob({
      endpointName: '/request-google-rss/start-job',
      run: async () => {
        await firstGate;
      }
    });
    await engine.enqueueJob({
      endpointName: '/state-assigner/start-job',
      run: async () => {
        throw new Error('should not run canceled queued job');
      }
    });

    const cancelResult = await engine.cancelJob('job-2');
    expect(cancelResult).toEqual({ jobId: 'job-2', outcome: 'canceled' });

    releaseFirst?.();
    await engine.onIdle();

    const canceledJob = await store.getJobById('job-2');
    expect(canceledJob?.status).toBe('canceled');
    expect(canceledJob?.endedAt).toBeDefined();
  });

  it('cancels a running job and escalates from SIGTERM to SIGKILL when needed', async () => {
    const receivedSignals: Array<NodeJS.Signals | number | undefined> = [];

    const fakeProcess: CancelableProcessHandle = {
      kill: (signal?: NodeJS.Signals | number): boolean => {
        receivedSignals.push(signal);
        return true;
      }
    };

    const engine = new GlobalQueueEngine(store, {
      createJobId: nextJobId,
      cancelGraceMs: 10
    });

    await engine.enqueueJob({
      endpointName: '/semantic-scorer/start-job',
      run: async ({ signal, registerCancelableProcess }) => {
        registerCancelableProcess(fakeProcess);
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              setTimeout(() => reject(new Error('aborted by cancel')), 25);
            },
            { once: true }
          );
        });
      }
    });

    await waitForCondition(async () => (await store.getJobById('job-1'))?.status === 'running');

    const cancelResult = await engine.cancelJob('job-1');
    expect(cancelResult).toEqual({ jobId: 'job-1', outcome: 'cancel_requested' });

    await engine.onIdle();

    const canceledJob = await store.getJobById('job-1');
    expect(canceledJob?.status).toBe('canceled');
    expect(canceledJob?.failureReason).toBe('canceled_by_request');
    expect(receivedSignals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('does not retry failed jobs', async () => {
    let attempts = 0;
    const engine = new GlobalQueueEngine(store, {
      createJobId: nextJobId
    });

    await engine.enqueueJob({
      endpointName: '/request-google-rss/start-job',
      run: async () => {
        attempts += 1;
        throw new Error('failed once');
      }
    });

    await engine.onIdle();

    const failedJob = await store.getJobById('job-1');
    expect(attempts).toBe(1);
    expect(failedJob?.status).toBe('failed');
    expect(failedJob?.failureReason).toContain('failed once');
  });
});
