import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { OpsConfig } from '../../src/config';
import {
  RunStateAssignmentError,
  runStateAssignment,
  type StateAssignerWorker
} from '../../src/weekly-flow-02/phases/06_runStateAssignment';
import {
  STATE_ASSIGNER_ENDPOINT_NAME,
  StateAssignerClientError,
  type StateAssignerInputs,
  type StateAssignerJob,
  type StateAssignerJobResult,
  type StateAssignerStartResult,
  type StateAssignerStatusResult
} from '../../src/weekly-flow-02/phases/06_stateAssignerClient';
import { createInMemoryPersistence, createRunRecord } from './persistenceTestSupport';

const config: Pick<
  OpsConfig,
  | 'workerNodeBaseUrl'
  | 'workerNodeRequestTimeoutSeconds'
  | 'stateAssignerTargetArticleThresholdDaysOld'
  | 'stateAssignerStatusPollIntervalSeconds'
  | 'stateAssignerToleratedConsecutiveStatusFailures'
  | 'stateAssignerMonitoringLimitHours'
> = {
  workerNodeBaseUrl: 'http://worker-node.test:3002/',
  workerNodeRequestTimeoutSeconds: 60,
  stateAssignerTargetArticleThresholdDaysOld: 180,
  stateAssignerStatusPollIntervalSeconds: 300,
  stateAssignerToleratedConsecutiveStatusFailures: 2,
  stateAssignerMonitoringLimitHours: 12
};

const phaseStartedAt = '2026-10-05T09:00:00.000Z';
const inputs: StateAssignerInputs = {
  targetArticleThresholdDaysOld: 180,
  targetArticleStateReviewCount: 12
};

const phaseFiveRun = () =>
  createRunRecord({
    lastPhaseStarted: 5,
    lastPhaseCompleted: 5,
    articleCount: 12,
    phaseData: { phase5: { status: 'completed' } }
  });

const continuedRun = (overrides = {}) =>
  createRunRecord({
    lastPhaseStarted: 6,
    lastPhaseCompleted: 5,
    articleCount: 12,
    stateAssignerJobId: 'saved-job',
    targetArticleThresholdDaysOld: 180,
    phaseData: {
      phase6: {
        status: 'started',
        startedAt: phaseStartedAt,
        input: inputs
      }
    },
    ...overrides
  });

const result = (
  overrides: Partial<StateAssignerJobResult> = {}
): StateAssignerJobResult => ({
  selectedCount: 12,
  completedCount: 10,
  skippedCount: 1,
  failedCount: 1,
  ...inputs,
  ...overrides
});

const job = (
  jobId: string,
  status: StateAssignerJob['status'],
  options: {
    createdAt?: string;
    failureReason?: string;
    result?: StateAssignerJobResult;
  } = {}
): StateAssignerJob & { parameters: StateAssignerInputs } => ({
  jobId,
  endpointName: STATE_ASSIGNER_ENDPOINT_NAME,
  status,
  createdAt: options.createdAt ?? '2026-10-05T09:00:01.000Z',
  parameters: inputs,
  ...(status === 'running' || status === 'completed'
    ? { startedAt: '2026-10-05T09:00:02.000Z' }
    : {}),
  ...(['completed', 'failed', 'canceled'].includes(status)
    ? { endedAt: '2026-10-05T09:10:00.000Z' }
    : {}),
  ...(options.failureReason === undefined ? {} : { failureReason: options.failureReason }),
  ...(status === 'completed' ? { result: options.result ?? result() } : {})
});

const compatible = (
  jobId: string,
  status: StateAssignerJob['status'],
  options: Parameters<typeof job>[2] = {}
): StateAssignerStatusResult => ({ kind: 'compatible', job: job(jobId, status, options) });

const incompatible = (
  jobId: string,
  status: StateAssignerJob['status'],
  createdAt = '2026-10-05T09:00:01.000Z',
  failureReason?: string
): StateAssignerStatusResult => {
  const lifecycle = job(jobId, status, { createdAt, failureReason });
  const { parameters: _parameters, result: _result, ...withoutContract } = lifecycle;
  return {
    kind: 'incompatible_contract',
    job: withoutContract,
    missingParameterFields: ['targetArticleThresholdDaysOld']
  };
};

const startResult = (jobId: string): StateAssignerStartResult => ({
  jobId,
  status: 'queued',
  endpointName: STATE_ASSIGNER_ENDPOINT_NAME
});

const dependencies = (
  persistence: ReturnType<typeof createInMemoryPersistence>['persistence'],
  worker: StateAssignerWorker,
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

describe('runStateAssignment', () => {
  it('persists start and exact inputs before accepting a partial completed result', async () => {
    const memory = createInMemoryPersistence([phaseFiveRun()]);
    const starts: StateAssignerInputs[] = [];
    const worker: StateAssignerWorker = {
      start: async (received) => {
        starts.push(received);
        return startResult('new-job');
      },
      getStatus: async () => compatible('new-job', 'completed'),
      cancel: async () => 'canceled'
    };

    const phaseResult = await runStateAssignment(
      memory.runs[0],
      config,
      dependencies(memory.persistence, worker)
    );

    assert.deepEqual(starts, [inputs]);
    assert.equal(phaseResult.kind, 'ready_for_phase_7');
    assert.equal(phaseResult.skippedCount, 1);
    assert.equal(phaseResult.failedCount, 1);
    assert.deepEqual(memory.calls, ['start:6', 'progress:6', 'progress:6', 'complete:6']);
    assert.equal(memory.runs[0].lastPhaseCompleted, 6);
    assert.equal(memory.runs[0].runCompleted, false);
  });

  it('accepts zero selection and polls immediately without overlapping delays', async () => {
    const memory = createInMemoryPersistence([continuedRun()]);
    const delays: number[] = [];
    const statuses = [
      compatible('saved-job', 'running'),
      compatible('saved-job', 'completed', {
        result: result({ selectedCount: 0, completedCount: 0, skippedCount: 0, failedCount: 0 })
      })
    ];
    const worker: StateAssignerWorker = {
      start: async () => startResult('unexpected'),
      getStatus: async () => statuses.shift() as StateAssignerStatusResult,
      cancel: async () => 'canceled'
    };

    const phaseResult = await runStateAssignment(
      memory.runs[0],
      config,
      dependencies(memory.persistence, worker, undefined, delays)
    );

    assert.equal(phaseResult.selectedCount, 0);
    assert.deepEqual(delays, [300_000]);
  });

  it('resets tolerated transient failures after a valid active response', async () => {
    const memory = createInMemoryPersistence([continuedRun()]);
    const delays: number[] = [];
    const outcomes: Array<StateAssignerStatusResult | Error> = [
      new StateAssignerClientError('transient_request', 'temporary'),
      compatible('saved-job', 'running'),
      new StateAssignerClientError('transient_request', 'temporary'),
      compatible('saved-job', 'completed')
    ];
    const worker: StateAssignerWorker = {
      start: async () => startResult('unexpected'),
      getStatus: async () => {
        const outcome = outcomes.shift();
        if (outcome instanceof Error) throw outcome;
        return outcome as StateAssignerStatusResult;
      },
      cancel: async () => 'canceled'
    };

    await runStateAssignment(
      memory.runs[0],
      config,
      dependencies(memory.persistence, worker, undefined, delays)
    );
    assert.deepEqual(delays, [300_000, 300_000, 300_000]);
  });

  it('stops on the third consecutive transient failure and on permanent responses', async () => {
    for (const terminalError of [
      new StateAssignerClientError('transient_request', 'third temporary failure'),
      new StateAssignerClientError('permanent_request', 'forbidden')
    ]) {
      const memory = createInMemoryPersistence([continuedRun()]);
      let calls = 0;
      const worker: StateAssignerWorker = {
        start: async () => startResult('unexpected'),
        getStatus: async () => {
          calls += 1;
          if (terminalError.category === 'transient_request' && calls < 3) {
            throw new StateAssignerClientError('transient_request', 'temporary');
          }
          throw terminalError;
        },
        cancel: async () => 'canceled'
      };

      await assert.rejects(
        runStateAssignment(memory.runs[0], config, dependencies(memory.persistence, worker)),
        (error: unknown) =>
          error instanceof RunStateAssignmentError && error.category === 'unverified_outcome'
      );
      assert.equal(calls, terminalError.category === 'transient_request' ? 3 : 1);
    }
  });

  it('uses one ordinary replacement for a failed saved job and never replaces its failure', async () => {
    const memory = createInMemoryPersistence([continuedRun()]);
    let starts = 0;
    const worker: StateAssignerWorker = {
      start: async () => {
        starts += 1;
        return startResult('replacement');
      },
      getStatus: async (jobId) =>
        jobId === 'saved-job'
          ? compatible('saved-job', 'failed', { failureReason: 'worker_restart' })
          : compatible('replacement', 'failed', { failureReason: 'assignment_failed' }),
      cancel: async () => 'canceled'
    };

    await assert.rejects(
      runStateAssignment(memory.runs[0], config, dependencies(memory.persistence, worker)),
      (error: unknown) =>
        error instanceof RunStateAssignmentError && error.category === 'unsuccessful_result'
    );
    assert.equal(starts, 1);
  });

  it('replaces canceled and unavailable saved jobs once', async () => {
    for (const firstOutcome of ['canceled', 'unavailable'] as const) {
      const memory = createInMemoryPersistence([continuedRun()]);
      let starts = 0;
      const worker: StateAssignerWorker = {
        start: async () => {
          starts += 1;
          return startResult(`replacement-${firstOutcome}`);
        },
        getStatus: async (jobId) => {
          if (jobId === 'saved-job') {
            if (firstOutcome === 'unavailable') {
              throw new StateAssignerClientError('unavailable_job', 'missing', 404);
            }
            return compatible('saved-job', 'canceled');
          }
          return compatible(jobId, 'completed', {
            createdAt: '2026-10-05T09:20:00.000Z'
          });
        },
        cancel: async () => 'canceled'
      };

      const phaseResult = await runStateAssignment(
        memory.runs[0],
        config,
        dependencies(memory.persistence, worker)
      );
      assert.equal(phaseResult.stateAssignerJobId, `replacement-${firstOutcome}`);
      assert.equal(starts, 1);
    }
  });

  it('recovers a Phase 6 start whose worker job ID was never saved', async () => {
    const run = continuedRun({ stateAssignerJobId: null });
    const memory = createInMemoryPersistence([run]);
    let starts = 0;
    const worker: StateAssignerWorker = {
      start: async () => {
        starts += 1;
        return startResult('gap-recovery');
      },
      getStatus: async () => compatible('gap-recovery', 'completed'),
      cancel: async () => 'canceled'
    };

    const phaseResult = await runStateAssignment(
      memory.runs[0],
      config,
      dependencies(memory.persistence, worker)
    );
    assert.equal(phaseResult.stateAssignerJobId, 'gap-recovery');
    assert.equal(starts, 1);
  });

  it('caps the 12-hour wait, saves its marker before cancellation, and exits nonzero', async () => {
    const memory = createInMemoryPersistence([continuedRun()]);
    const delays: number[] = [];
    let markerPresentAtCancellation = false;
    const worker: StateAssignerWorker = {
      start: async () => startResult('unexpected'),
      getStatus: async () => compatible('saved-job', 'running'),
      cancel: async () => {
        const phase6 = memory.runs[0].phaseData.phase6 as Record<string, unknown>;
        markerPresentAtCancellation = phase6.monitoringLimit !== undefined;
        return 'canceled';
      }
    };
    const longPollConfig = {
      ...config,
      stateAssignerStatusPollIntervalSeconds: 50_000
    };

    await assert.rejects(
      runStateAssignment(
        memory.runs[0],
        longPollConfig,
        dependencies(memory.persistence, worker, undefined, delays)
      ),
      (error: unknown) =>
        error instanceof RunStateAssignmentError && error.category === 'monitoring_limit'
    );
    assert.deepEqual(delays, [43_200_000]);
    assert.equal(markerPresentAtCancellation, true);
    assert.equal(memory.runs[0].lastPhaseCompleted, 5);
  });

  it('verifies a monitoring-limit cancellation 404 and never trusts late completion', async () => {
    const memory = createInMemoryPersistence([continuedRun()]);
    const statuses = [
      compatible('saved-job', 'running'),
      compatible('saved-job', 'completed')
    ];
    const worker: StateAssignerWorker = {
      start: async () => startResult('unexpected'),
      getStatus: async () => statuses.shift() as StateAssignerStatusResult,
      cancel: async () => 'not_found'
    };
    const shortConfig = {
      ...config,
      stateAssignerStatusPollIntervalSeconds: 3_600,
      stateAssignerMonitoringLimitHours: 1
    };

    await assert.rejects(
      runStateAssignment(memory.runs[0], shortConfig, dependencies(memory.persistence, worker)),
      (error: unknown) =>
        error instanceof RunStateAssignmentError && error.category === 'monitoring_limit'
    );
    assert.equal(memory.runs[0].lastPhaseCompleted, 5);
  });

  it('stops when monitoring-limit cancellation or verification is unverified', async () => {
    for (const failurePoint of ['cancel', 'verify'] as const) {
      const memory = createInMemoryPersistence([continuedRun()]);
      let statusCalls = 0;
      const worker: StateAssignerWorker = {
        start: async () => startResult('unexpected'),
        getStatus: async () => {
          statusCalls += 1;
          if (statusCalls === 1) return compatible('saved-job', 'running');
          throw new StateAssignerClientError('transient_request', 'verification unavailable');
        },
        cancel: async () => {
          if (failurePoint === 'cancel') throw new Error('cancel unavailable');
          return 'not_found';
        }
      };
      const shortConfig = {
        ...config,
        stateAssignerStatusPollIntervalSeconds: 3_600,
        stateAssignerMonitoringLimitHours: 1
      };

      await assert.rejects(
        runStateAssignment(memory.runs[0], shortConfig, dependencies(memory.persistence, worker)),
        (error: unknown) =>
          error instanceof RunStateAssignmentError && error.category === 'unverified_outcome'
      );
    }
  });

  it('replaces an inactive monitoring-limited job on a later continuation', async () => {
    const run = continuedRun({
      phaseData: {
        phase6: {
          status: 'started',
          startedAt: phaseStartedAt,
          input: inputs,
          monitoringLimit: {
            jobId: 'saved-job',
            jobCreatedAt: '2026-10-05T09:00:01.000Z',
            reachedAt: '2026-10-05T21:00:00.000Z'
          }
        }
      }
    });
    const memory = createInMemoryPersistence([run]);
    const worker: StateAssignerWorker = {
      start: async () => startResult('limit-replacement'),
      getStatus: async (jobId) =>
        jobId === 'saved-job'
          ? compatible('saved-job', 'canceled')
          : compatible('limit-replacement', 'completed', {
              createdAt: '2026-10-05T22:00:00.000Z'
            }),
      cancel: async () => 'canceled'
    };

    const phaseResult = await runStateAssignment(
      memory.runs[0],
      config,
      dependencies(memory.persistence, worker)
    );
    const phase6 = memory.runs[0].phaseData.phase6 as Record<string, unknown>;
    assert.equal(phaseResult.stateAssignerJobId, 'limit-replacement');
    assert.notEqual(phase6.monitoringLimit, undefined);
    assert.equal(memory.runs[0].articleCount, 12);
    assert.equal(memory.runs[0].targetArticleThresholdDaysOld, 180);
  });

  it('marks and cancels an active incompatible source before exiting without replacement', async () => {
    const memory = createInMemoryPersistence([continuedRun()]);
    let starts = 0;
    let markerPresentAtCancellation = false;
    const worker: StateAssignerWorker = {
      start: async () => {
        starts += 1;
        return startResult('unexpected');
      },
      getStatus: async () => incompatible('saved-job', 'running'),
      cancel: async () => {
        const phase6 = memory.runs[0].phaseData.phase6 as Record<string, unknown>;
        markerPresentAtCancellation = phase6.incompatibleContractRecovery !== undefined;
        return 'canceled';
      }
    };

    await assert.rejects(
      runStateAssignment(memory.runs[0], config, dependencies(memory.persistence, worker)),
      (error: unknown) =>
        error instanceof RunStateAssignmentError && error.category === 'incompatible_contract'
    );
    assert.equal(markerPresentAtCancellation, true);
    assert.equal(starts, 0);
  });

  it('verifies running incompatible cancellation and handles queued cancellation directly', async () => {
    for (const activeStatus of ['queued', 'running'] as const) {
      const memory = createInMemoryPersistence([continuedRun()]);
      let statusCalls = 0;
      const worker: StateAssignerWorker = {
        start: async () => startResult('unexpected'),
        getStatus: async () => {
          statusCalls += 1;
          if (statusCalls === 1) return incompatible('saved-job', activeStatus);
          return incompatible('saved-job', 'canceled');
        },
        cancel: async () => (activeStatus === 'queued' ? 'canceled' : 'cancel_requested')
      };

      await assert.rejects(
        runStateAssignment(memory.runs[0], config, dependencies(memory.persistence, worker)),
        (error: unknown) =>
          error instanceof RunStateAssignmentError && error.category === 'incompatible_contract'
      );
      assert.equal(statusCalls, activeStatus === 'queued' ? 1 : 2);
    }
  });

  it('does not replace a terminal incompatible job started by the current invocation', async () => {
    const memory = createInMemoryPersistence([phaseFiveRun()]);
    let starts = 0;
    const worker: StateAssignerWorker = {
      start: async () => {
        starts += 1;
        return startResult('fresh-incompatible');
      },
      getStatus: async () => incompatible('fresh-incompatible', 'failed'),
      cancel: async () => 'canceled'
    };

    await assert.rejects(
      runStateAssignment(memory.runs[0], config, dependencies(memory.persistence, worker)),
      (error: unknown) =>
        error instanceof RunStateAssignmentError && error.category === 'incompatible_contract'
    );
    assert.equal(starts, 1);
  });

  it('starts one compatible marked replacement for a completed incompatible source', async () => {
    const memory = createInMemoryPersistence([continuedRun()]);
    let starts = 0;
    const worker: StateAssignerWorker = {
      start: async (received) => {
        assert.deepEqual(received, inputs);
        starts += 1;
        return startResult('replacement');
      },
      getStatus: async (jobId) =>
        jobId === 'saved-job'
          ? incompatible('saved-job', 'completed')
          : compatible('replacement', 'completed', {
              createdAt: '2026-10-05T09:20:00.000Z'
            }),
      cancel: async () => 'canceled'
    };

    const phaseResult = await runStateAssignment(
      memory.runs[0],
      config,
      dependencies(memory.persistence, worker)
    );

    const marker = (memory.runs[0].phaseData.phase6 as Record<string, unknown>)
      .incompatibleContractRecovery as Record<string, unknown>;
    assert.equal(phaseResult.stateAssignerJobId, 'replacement');
    assert.equal(marker.sourceJobId, 'saved-job');
    assert.equal(marker.replacementJobId, 'replacement');
    assert.equal(memory.runs[0].articleCount, 12);
    assert.equal(memory.runs[0].targetArticleThresholdDaysOld, 180);
    assert.equal(starts, 1);
    assert.ok(memory.calls.includes('replacement:6'));
  });

  it('replaces an inactive worker-restart incompatible source', async () => {
    const memory = createInMemoryPersistence([continuedRun()]);
    const worker: StateAssignerWorker = {
      start: async () => startResult('restart-replacement'),
      getStatus: async (jobId) =>
        jobId === 'saved-job'
          ? incompatible(
              'saved-job',
              'failed',
              '2026-10-05T09:00:01.000Z',
              'worker_restart'
            )
          : compatible('restart-replacement', 'completed', {
              createdAt: '2026-10-05T09:30:00.000Z'
            }),
      cancel: async () => 'canceled'
    };

    const phaseResult = await runStateAssignment(
      memory.runs[0],
      config,
      dependencies(memory.persistence, worker)
    );
    assert.equal(phaseResult.stateAssignerJobId, 'restart-replacement');
  });

  it('cancels an incompatible marked replacement and never starts another', async () => {
    const run = continuedRun({
      stateAssignerJobId: 'replacement',
      phaseData: {
        phase6: {
          status: 'started',
          startedAt: phaseStartedAt,
          input: inputs,
          incompatibleContractRecovery: {
            sourceJobId: 'source-job',
            sourceJobCreatedAt: '2026-10-05T09:00:01.000Z',
            detectedAt: '2026-10-05T09:10:00.000Z',
            missingParameterFields: ['targetArticleThresholdDaysOld'],
            lastStatus: 'completed',
            replacementStartedAt: '2026-10-05T09:20:00.000Z',
            replacementJobId: 'replacement'
          }
        }
      }
    });
    const memory = createInMemoryPersistence([run]);
    let starts = 0;
    let cancellations = 0;
    const worker: StateAssignerWorker = {
      start: async () => {
        starts += 1;
        return startResult('forbidden');
      },
      getStatus: async () =>
        incompatible('replacement', 'running', '2026-10-05T09:20:01.000Z'),
      cancel: async () => {
        cancellations += 1;
        return 'canceled';
      }
    };

    await assert.rejects(
      runStateAssignment(memory.runs[0], config, dependencies(memory.persistence, worker)),
      (error: unknown) =>
        error instanceof RunStateAssignmentError && error.category === 'incompatible_contract'
    );
    assert.equal(cancellations, 1);
    assert.equal(starts, 0);
  });

  it('stops after an incompatible replacement ID persistence failure', async () => {
    const memory = createInMemoryPersistence([continuedRun()]);
    const original = memory.persistence.recordPhaseSixIncompatibleReplacementStarted;
    memory.persistence.recordPhaseSixIncompatibleReplacementStarted = async () => {
      throw new Error('write failed');
    };
    let starts = 0;
    const worker: StateAssignerWorker = {
      start: async () => {
        starts += 1;
        return startResult('unsaved-replacement');
      },
      getStatus: async () => incompatible('saved-job', 'completed'),
      cancel: async () => 'canceled'
    };

    await assert.rejects(
      runStateAssignment(memory.runs[0], config, dependencies(memory.persistence, worker)),
      (error: unknown) =>
        error instanceof RunStateAssignmentError && error.category === 'unverified_outcome'
    );
    assert.equal(starts, 1);
    assert.equal(memory.runs[0].stateAssignerJobId, 'saved-job');
    const marker = (memory.runs[0].phaseData.phase6 as Record<string, unknown>)
      .incompatibleContractRecovery as Record<string, unknown>;
    assert.equal(marker.replacementJobId, undefined);

    memory.persistence.recordPhaseSixIncompatibleReplacementStarted = original;
    const retryWorker: StateAssignerWorker = {
      start: async () => startResult('later-replacement'),
      getStatus: async (jobId) =>
        jobId === 'saved-job'
          ? incompatible('saved-job', 'completed')
          : compatible('later-replacement', 'completed', {
              createdAt: '2026-10-05T09:30:00.000Z'
            }),
      cancel: async () => 'canceled'
    };
    const retry = await runStateAssignment(
      memory.runs[0],
      config,
      dependencies(memory.persistence, retryWorker)
    );
    assert.equal(retry.stateAssignerJobId, 'later-replacement');
  });

  it('rejects malformed persisted inputs before contacting the worker', async () => {
    const run = continuedRun({ targetArticleThresholdDaysOld: 181 });
    const memory = createInMemoryPersistence([run]);
    let calls = 0;
    const worker: StateAssignerWorker = {
      start: async () => {
        calls += 1;
        return startResult('unexpected');
      },
      getStatus: async () => {
        calls += 1;
        return compatible('saved-job', 'completed');
      },
      cancel: async () => 'canceled'
    };

    await assert.rejects(
      runStateAssignment(memory.runs[0], config, dependencies(memory.persistence, worker)),
      (error: unknown) =>
        error instanceof RunStateAssignmentError && error.category === 'invalid_run_state'
    );
    assert.equal(calls, 0);
  });
});
