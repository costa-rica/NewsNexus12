import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { OpsConfig } from '../../src/config';
import {
  RunSemanticScoringError,
  runSemanticScoring,
  type SemanticScorerWorker
} from '../../src/weekly-flow-02/phases/05_runSemanticScoring';
import {
  SEMANTIC_SCORER_ENDPOINT_NAME,
  SemanticScorerClientError,
  type SemanticScorerJob,
  type SemanticScorerStartResult
} from '../../src/weekly-flow-02/phases/05_semanticScorerClient';
import { createInMemoryPersistence, createRunRecord } from './persistenceTestSupport';

const config: Pick<
  OpsConfig,
  | 'workerNodeBaseUrl'
  | 'workerNodeRequestTimeoutSeconds'
  | 'semanticScorerStatusPollIntervalSeconds'
  | 'semanticScorerToleratedConsecutiveStatusFailures'
  | 'semanticScorerMonitoringLimitHours'
> = {
  workerNodeBaseUrl: 'http://worker-node.test:3002/',
  workerNodeRequestTimeoutSeconds: 60,
  semanticScorerStatusPollIntervalSeconds: 300,
  semanticScorerToleratedConsecutiveStatusFailures: 2,
  semanticScorerMonitoringLimitHours: 6
};

const phaseStartedAt = '2026-10-05T09:00:00.000Z';

const phaseFourRun = () =>
  createRunRecord({
    lastPhaseStarted: 4,
    lastPhaseCompleted: 4,
    articleCount: 12,
    phaseData: { phase4: { status: 'completed' } }
  });

const continuedRun = (overrides = {}) =>
  createRunRecord({
    lastPhaseStarted: 5,
    lastPhaseCompleted: 4,
    articleCount: 12,
    semanticScorerJobId: 'saved-job',
    phaseData: {
      phase5: { status: 'started', startedAt: phaseStartedAt }
    },
    ...overrides
  });

const job = (
  jobId: string,
  status: SemanticScorerJob['status'],
  options: { createdAt?: string; failureReason?: string } = {}
): SemanticScorerJob => ({
  jobId,
  endpointName: SEMANTIC_SCORER_ENDPOINT_NAME,
  status,
  createdAt: options.createdAt ?? '2026-10-05T09:00:01.000Z',
  ...(status === 'running' || status === 'completed'
    ? { startedAt: '2026-10-05T09:00:02.000Z' }
    : {}),
  ...(['completed', 'failed', 'canceled'].includes(status)
    ? { endedAt: '2026-10-05T09:10:00.000Z' }
    : {}),
  ...(options.failureReason === undefined ? {} : { failureReason: options.failureReason })
});

const startResult = (jobId: string): SemanticScorerStartResult => ({
  jobId,
  status: 'queued' as const,
  endpointName: SEMANTIC_SCORER_ENDPOINT_NAME
});

const dependencies = (
  persistence: ReturnType<typeof createInMemoryPersistence>['persistence'],
  worker: SemanticScorerWorker,
  clock = { value: new Date('2026-10-05T09:00:00.000Z') },
  delays: number[] = []
) => ({
  persistence,
  worker,
  now: () => new Date(clock.value),
  delay: async (milliseconds: number) => {
    delays.push(milliseconds);
    clock.value = new Date(clock.value.getTime() + milliseconds);
  }
});

describe('runSemanticScoring', () => {
  it('persists Phase 5 start and job identity before accepting immediate completion', async () => {
    const memory = createInMemoryPersistence([phaseFourRun()]);
    const worker: SemanticScorerWorker = {
      start: async () => startResult('new-job'),
      getStatus: async () => job('new-job', 'completed'),
      cancel: async () => 'canceled'
    };

    const result = await runSemanticScoring(
      memory.runs[0],
      config,
      dependencies(memory.persistence, worker)
    );

    assert.equal(result.kind, 'ready_for_phase_6');
    assert.deepEqual(memory.calls, ['start:5', 'progress:5', 'progress:5', 'complete:5']);
    assert.equal(memory.runs[0].lastPhaseCompleted, 5);
    assert.equal(memory.runs[0].runCompleted, false);
  });

  it('polls a saved active job immediately and serially before completion', async () => {
    const memory = createInMemoryPersistence([continuedRun()]);
    const delays: number[] = [];
    const statuses = [job('saved-job', 'running'), job('saved-job', 'completed')];
    let starts = 0;
    const worker: SemanticScorerWorker = {
      start: async () => {
        starts += 1;
        return startResult('unexpected');
      },
      getStatus: async () => statuses.shift() as SemanticScorerJob,
      cancel: async () => 'canceled'
    };

    await runSemanticScoring(
      memory.runs[0],
      config,
      dependencies(memory.persistence, worker, undefined, delays)
    );

    assert.equal(starts, 0);
    assert.deepEqual(delays, [300_000]);
  });

  it('replaces one terminal saved job but never replaces a failed current job', async () => {
    const memory = createInMemoryPersistence([continuedRun()]);
    let starts = 0;
    const worker: SemanticScorerWorker = {
      start: async () => {
        starts += 1;
        return startResult('replacement');
      },
      getStatus: async (jobId) =>
        jobId === 'saved-job'
          ? job('saved-job', 'failed', { failureReason: 'worker_restart' })
          : job('replacement', 'failed', { failureReason: 'scoring_failed' }),
      cancel: async () => 'canceled'
    };

    await assert.rejects(
      runSemanticScoring(memory.runs[0], config, dependencies(memory.persistence, worker)),
      (error: unknown) =>
        error instanceof RunSemanticScoringError && error.category === 'unsuccessful_result'
    );
    assert.equal(starts, 1);
  });

  it('uses normal replacement for saved-job status 404', async () => {
    const memory = createInMemoryPersistence([continuedRun()]);
    let starts = 0;
    const worker: SemanticScorerWorker = {
      start: async () => {
        starts += 1;
        return startResult('replacement');
      },
      getStatus: async (jobId) => {
        if (jobId === 'saved-job') {
          throw new SemanticScorerClientError('unavailable_job', 'missing', 404);
        }
        return job('replacement', 'completed', { createdAt: '2026-10-05T09:01:00.000Z' });
      },
      cancel: async () => 'canceled'
    };

    const result = await runSemanticScoring(
      memory.runs[0],
      config,
      dependencies(memory.persistence, worker)
    );
    assert.equal(result.semanticScorerJobId, 'replacement');
    assert.equal(starts, 1);
  });

  it('tolerates configured transient failures and resets the count after a valid status', async () => {
    const memory = createInMemoryPersistence([continuedRun()]);
    const delays: number[] = [];
    const outcomes: Array<SemanticScorerJob | Error> = [
      new SemanticScorerClientError('transient_request', 'temporary'),
      job('saved-job', 'running'),
      new SemanticScorerClientError('transient_request', 'temporary'),
      job('saved-job', 'completed')
    ];
    const worker: SemanticScorerWorker = {
      start: async () => startResult('unexpected'),
      getStatus: async () => {
        const outcome = outcomes.shift();
        if (outcome instanceof Error) throw outcome;
        return outcome as SemanticScorerJob;
      },
      cancel: async () => 'canceled'
    };

    await runSemanticScoring(
      memory.runs[0],
      config,
      dependencies(memory.persistence, worker, undefined, delays)
    );
    assert.deepEqual(delays, [300_000, 300_000, 300_000]);
  });

  it('caps the last wait, persists the marker before canceling, and always errors', async () => {
    const memory = createInMemoryPersistence([continuedRun()]);
    const delays: number[] = [];
    let markerPresentAtCancellation = false;
    const worker: SemanticScorerWorker = {
      start: async () => startResult('unexpected'),
      getStatus: async () => job('saved-job', 'running'),
      cancel: async () => {
        const phase5 = memory.runs[0].phaseData.phase5 as Record<string, unknown>;
        markerPresentAtCancellation = phase5.monitoringLimit !== undefined;
        return 'canceled';
      }
    };
    const shortConfig = {
      ...config,
      semanticScorerStatusPollIntervalSeconds: 4_000,
      semanticScorerMonitoringLimitHours: 1
    };

    await assert.rejects(
      runSemanticScoring(
        memory.runs[0],
        shortConfig,
        dependencies(memory.persistence, worker, undefined, delays)
      ),
      (error: unknown) =>
        error instanceof RunSemanticScoringError && error.category === 'monitoring_limit'
    );
    assert.deepEqual(delays, [3_600_000]);
    assert.equal(markerPresentAtCancellation, true);
  });

  it('immediately re-cancels a matching marked active job without a new monitoring window', async () => {
    const run = continuedRun({
      phaseData: {
        phase5: {
          status: 'started',
          startedAt: phaseStartedAt,
          monitoringLimit: {
            jobId: 'saved-job',
            jobCreatedAt: '2026-10-05T09:00:01.000Z',
            reachedAt: '2026-10-05T15:00:00.000Z'
          }
        }
      }
    });
    const memory = createInMemoryPersistence([run]);
    const delays: number[] = [];
    let cancellations = 0;
    const worker: SemanticScorerWorker = {
      start: async () => startResult('unexpected'),
      getStatus: async () => job('saved-job', 'running'),
      cancel: async () => {
        cancellations += 1;
        return 'canceled';
      }
    };

    await assert.rejects(
      runSemanticScoring(
        memory.runs[0],
        config,
        dependencies(memory.persistence, worker, undefined, delays)
      ),
      (error: unknown) =>
        error instanceof RunSemanticScoringError && error.category === 'monitoring_limit'
    );
    assert.equal(cancellations, 1);
    assert.deepEqual(delays, []);
  });

  it('never trusts late completion after cancel_requested verification', async () => {
    const memory = createInMemoryPersistence([continuedRun()]);
    const statuses = [
      job('saved-job', 'running'),
      job('saved-job', 'completed')
    ];
    const shortConfig = {
      ...config,
      semanticScorerStatusPollIntervalSeconds: 3_600,
      semanticScorerMonitoringLimitHours: 1
    };
    const worker: SemanticScorerWorker = {
      start: async () => startResult('unexpected'),
      getStatus: async () => statuses.shift() as SemanticScorerJob,
      cancel: async () => 'cancel_requested'
    };

    await assert.rejects(
      runSemanticScoring(
        memory.runs[0],
        shortConfig,
        dependencies(memory.persistence, worker)
      ),
      (error: unknown) =>
        error instanceof RunSemanticScoringError && error.category === 'monitoring_limit'
    );
    assert.equal(memory.runs[0].lastPhaseCompleted, 4);
  });

  it('allows a nonmatching replacement while preserving an old marker', async () => {
    const run = continuedRun({
      phaseData: {
        phase5: {
          status: 'started',
          startedAt: phaseStartedAt,
          monitoringLimit: {
            jobId: 'saved-job',
            jobCreatedAt: '2026-10-05T09:00:01.000Z',
            reachedAt: '2026-10-05T15:00:00.000Z'
          }
        }
      }
    });
    const memory = createInMemoryPersistence([run]);
    const worker: SemanticScorerWorker = {
      start: async () => startResult('replacement'),
      getStatus: async (jobId) =>
        jobId === 'saved-job'
          ? job('saved-job', 'canceled')
          : job('replacement', 'completed', { createdAt: '2026-10-05T16:00:00.000Z' }),
      cancel: async () => 'canceled'
    };

    const result = await runSemanticScoring(
      memory.runs[0],
      config,
      dependencies(memory.persistence, worker)
    );
    const phase5 = memory.runs[0].phaseData.phase5 as Record<string, unknown>;
    assert.equal(result.semanticScorerJobId, 'replacement');
    assert.notEqual(phase5.monitoringLimit, undefined);
  });

  it('accepts a reused job ID when its validated creation time does not match the marker', async () => {
    const run = continuedRun({
      phaseData: {
        phase5: {
          status: 'started',
          startedAt: phaseStartedAt,
          monitoringLimit: {
            jobId: 'saved-job',
            jobCreatedAt: '2026-10-05T09:00:01.000Z',
            reachedAt: '2026-10-05T15:00:00.000Z'
          }
        }
      }
    });
    const memory = createInMemoryPersistence([run]);
    const worker: SemanticScorerWorker = {
      start: async () => startResult('unexpected'),
      getStatus: async () =>
        job('saved-job', 'completed', { createdAt: '2026-10-05T16:00:00.000Z' }),
      cancel: async () => 'canceled'
    };

    const result = await runSemanticScoring(
      memory.runs[0],
      config,
      dependencies(memory.persistence, worker)
    );
    assert.equal(result.semanticScorerJobId, 'saved-job');
    assert.equal(result.jobCreatedAt, '2026-10-05T16:00:00.000Z');
  });

  it('performs one final lookup when monitoring-limit cancellation returns 404', async () => {
    const memory = createInMemoryPersistence([continuedRun()]);
    const statuses = [job('saved-job', 'queued'), job('saved-job', 'canceled')];
    const worker: SemanticScorerWorker = {
      start: async () => startResult('unexpected'),
      getStatus: async () => statuses.shift() as SemanticScorerJob,
      cancel: async () => 'not_found'
    };
    const shortConfig = {
      ...config,
      semanticScorerStatusPollIntervalSeconds: 3_600,
      semanticScorerMonitoringLimitHours: 1
    };

    await assert.rejects(
      runSemanticScoring(
        memory.runs[0],
        shortConfig,
        dependencies(memory.persistence, worker)
      ),
      (error: unknown) =>
        error instanceof RunSemanticScoringError && error.category === 'monitoring_limit'
    );
    const marker = (memory.runs[0].phaseData.phase5 as Record<string, unknown>)
      .monitoringLimit as Record<string, unknown>;
    assert.equal((marker.verification as Record<string, unknown>).kind, 'inactive');
  });

  it('keeps the marker when cancellation or its final verification is unverified', async () => {
    for (const mode of ['cancel_failure', 'verification_failure'] as const) {
      const memory = createInMemoryPersistence([continuedRun()]);
      let statusCalls = 0;
      const worker: SemanticScorerWorker = {
        start: async () => startResult('unexpected'),
        getStatus: async () => {
          statusCalls += 1;
          if (statusCalls === 1) return job('saved-job', 'running');
          throw new SemanticScorerClientError('transient_request', 'verification unavailable');
        },
        cancel: async () => {
          if (mode === 'cancel_failure') throw new Error('cancel unavailable');
          return 'cancel_requested';
        }
      };
      const shortConfig = {
        ...config,
        semanticScorerStatusPollIntervalSeconds: 3_600,
        semanticScorerMonitoringLimitHours: 1
      };

      await assert.rejects(
        runSemanticScoring(
          memory.runs[0],
          shortConfig,
          dependencies(memory.persistence, worker)
        ),
        (error: unknown) =>
          error instanceof RunSemanticScoringError && error.category === 'unverified_outcome'
      );
      const phase5 = memory.runs[0].phaseData.phase5 as Record<string, unknown>;
      assert.notEqual(phase5.monitoringLimit, undefined);
    }
  });
});
