import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { OpsConfig } from '../../src/config';
import {
  AiApproverV02ClientError,
  type AiApproverV02Detail,
  type AiApproverV02Inputs,
  type AiApproverV02Worker
} from '../../src/weekly-flow-02/phases/07_aiApproverV02Client';
import {
  RunAiApproverV02Error,
  runAiApproverV02
} from '../../src/weekly-flow-02/phases/07_runAiApproverV02';
import { createInMemoryPersistence, createRunRecord } from './persistenceTestSupport';

const config = {
  aiApproverV02StatusPollIntervalSeconds: 300,
  aiApproverV02ToleratedConsecutiveStatusFailures: 2,
  aiApproverV02MonitoringLimitHours: 12
} as OpsConfig;

const inputs: AiApproverV02Inputs = {
  selectionMode: 'article_position_count',
  requestedArticleCount: 2,
  allowPastApprovedBoundary: true,
  allowDescriptionFallback: true
};

const eligibleRun = () =>
  createRunRecord({
    id: 7,
    lastPhaseStarted: 6,
    lastPhaseCompleted: 6,
    articleCount: 2,
    phaseData: { phase6: { status: 'completed' } }
  });

const detail = (
  status: 'queued' | 'running' | 'completed' | 'failed' | 'canceled' | 'circuit_breaker',
  options: { runId?: number; jobId?: string | null; queue?: boolean; createdAt?: string } = {}
): AiApproverV02Detail => {
  const runId = options.runId ?? 41;
  const jobId = options.jobId === undefined ? '0007' : options.jobId;
  const createdAt = options.createdAt ?? '2026-10-06T10:00:01Z';
  const terminal = ['completed', 'failed', 'canceled', 'circuit_breaker'].includes(status);
  const activeOrCompleted = status === 'running' || status === 'completed';
  return {
    run: {
      v02RunId: runId,
      status,
      jobId,
      ...inputs,
      plannedEligibleCount: 2,
      attemptedCount: status === 'completed' ? 2 : 0,
      completedCount: status === 'completed' ? 2 : 0,
      failedCount: 0,
      invalidResponseCount: 0,
      skippedCount: 0,
      createdAt,
      ...(activeOrCompleted ? { startedAt: '2026-10-06T10:00:03Z' } : {}),
      ...(terminal ? { endedAt: '2026-10-06T10:05:00Z' } : {}),
      ...(terminal ? { endingReason: status } : {})
    },
    queueStatus:
      options.queue === false || jobId === null
        ? null
        : {
            jobId,
            endpointName: '/ai-approver-v02/start',
            status:
              status === 'circuit_breaker'
                ? 'failed'
                : status,
            createdAt: '2026-10-06T10:00:02Z',
            ...(activeOrCompleted ? { startedAt: '2026-10-06T10:00:03Z' } : {}),
            ...(terminal ? { endedAt: '2026-10-06T10:05:01Z' } : {}),
            parameters: { runId }
          }
  };
};

const worker = (
  overrides: Partial<AiApproverV02Worker> = {}
): AiApproverV02Worker => ({
  preview: async () => ({
    kind: 'work',
    preview: {
      v02RunId: 41,
      previewToken: 'ephemeral',
      previewCreatedAt: '2026-10-06T10:00:01Z',
      previewExpiresAt: '2026-10-06T10:15:01Z',
      plannedEligibleCount: 2
    }
  }),
  start: async () => ({ v02RunId: 41, jobId: '0007', status: 'queued' }),
  detail: async () => detail('completed'),
  cancel: async () => 'canceled',
  ...overrides
});

describe('runAiApproverV02', () => {
  it('previews, starts, polls immediately, and atomically completes the weekly run', async () => {
    const memory = createInMemoryPersistence([eligibleRun()]);
    const result = await runAiApproverV02(memory.runs[0], config, {
      persistence: memory.persistence,
      worker: worker(),
      now: () => new Date('2026-10-06T10:06:00Z'),
      delay: async () => assert.fail('completed result must not delay')
    });

    assert.equal(result.kind, 'completed');
    assert.equal(memory.runs[0].runCompleted, true);
    assert.equal(memory.runs[0].lastPhaseCompleted, 7);
    assert.deepEqual(
      memory.calls.filter((call) => ['start:7', 'preview:7', 'bind:7', 'complete:7'].includes(call)),
      ['start:7', 'preview:7', 'bind:7', 'complete:7']
    );
  });

  it('atomically completes typed initial zero work without starting a job', async () => {
    const memory = createInMemoryPersistence([eligibleRun()]);
    let starts = 0;
    const result = await runAiApproverV02(memory.runs[0], config, {
      persistence: memory.persistence,
      worker: worker({
        preview: async () => ({ kind: 'zero_work' }),
        start: async () => {
          starts += 1;
          throw new Error('must not start');
        }
      }),
      now: () => new Date('2026-10-06T10:00:00Z'),
      delay: async () => undefined
    });

    assert.deepEqual(result, { kind: 'zero_work', zeroWorkAfterPriorAttempts: false });
    assert.equal(starts, 0);
    assert.equal(memory.runs[0].aiApproverV02JobId, null);
  });

  it('allows a later invocation after failure but starts only once per invocation', async () => {
    const memory = createInMemoryPersistence([eligibleRun()]);
    await assert.rejects(
      runAiApproverV02(memory.runs[0], config, {
        persistence: memory.persistence,
        worker: worker({ detail: async () => detail('failed') }),
        now: () => new Date('2026-10-06T10:06:00Z'),
        delay: async () => undefined
      }),
      (error: unknown) =>
        error instanceof RunAiApproverV02Error &&
        error.category === 'unsuccessful_terminal_result'
    );

    let previewCount = 0;
    const later = worker({
      preview: async () => {
        previewCount += 1;
        return {
          kind: 'work',
          preview: {
            v02RunId: 42,
            previewToken: 'second-token',
            previewCreatedAt: '2026-10-06T10:10:00Z',
            previewExpiresAt: '2026-10-06T10:25:00Z',
            plannedEligibleCount: 2
          }
        };
      },
      start: async () => ({ v02RunId: 42, jobId: '0008', status: 'queued' }),
      detail: async (context) =>
        context.expectedV02RunId === 41
          ? detail('failed')
          : detail('completed', { runId: 42, jobId: '0008', createdAt: '2026-10-06T10:10:00Z' })
    });
    const result = await runAiApproverV02(memory.runs[0], config, {
      persistence: memory.persistence,
      worker: later,
      now: () => new Date('2026-10-06T10:12:00Z'),
      delay: async () => undefined
    });
    assert.equal(result.kind, 'completed');
    assert.equal(previewCount, 1);
  });

  it('adopts a job after an ambiguous start response and then completes', async () => {
    const memory = createInMemoryPersistence([eligibleRun()]);
    await assert.rejects(
      runAiApproverV02(memory.runs[0], config, {
        persistence: memory.persistence,
        worker: worker({
          start: async () => {
            throw new AiApproverV02ClientError('transient_request', 'response lost');
          }
        }),
        now: () => new Date('2026-10-06T10:01:00Z'),
        delay: async () => undefined
      }),
      /response lost/
    );
    assert.equal(memory.runs[0].aiApproverV02JobId, null);

    const result = await runAiApproverV02(memory.runs[0], config, {
      persistence: memory.persistence,
      worker: worker({ detail: async () => detail('completed') }),
      now: () => new Date('2026-10-06T10:06:00Z'),
      delay: async () => undefined
    });
    assert.equal(result.kind, 'completed');
    assert.equal(memory.runs[0].aiApproverV02JobId, '0007');
  });

  it('marks and cancels an over-limit job using fake time', async () => {
    const memory = createInMemoryPersistence([eligibleRun()]);
    let canceled = 0;
    await assert.rejects(
      runAiApproverV02(memory.runs[0], config, {
        persistence: memory.persistence,
        worker: worker({
          detail: async () => detail('running'),
          cancel: async () => {
            canceled += 1;
            return 'canceled';
          }
        }),
        now: () => new Date('2026-10-06T22:00:03Z'),
        delay: async () => assert.fail('immediate over-limit cancellation must not delay')
      }),
      (error: unknown) =>
        error instanceof RunAiApproverV02Error && error.category === 'monitoring_limit'
    );
    assert.equal(canceled, 1);
    const attempts = ((memory.runs[0].phaseData.phase7 as Record<string, unknown>)
      .attempts as Array<Record<string, unknown>>);
    assert.equal(typeof attempts[0].monitoringLimitedAt, 'string');
  });

  it('stops an active durable run when queue evidence is missing', async () => {
    const memory = createInMemoryPersistence([eligibleRun()]);
    await assert.rejects(
      runAiApproverV02(memory.runs[0], config, {
        persistence: memory.persistence,
        worker: worker({ detail: async () => detail('running', { queue: false }) }),
        now: () => new Date('2026-10-06T10:06:00Z'),
        delay: async () => undefined
      }),
      (error: unknown) =>
        error instanceof RunAiApproverV02Error && error.category === 'unverified_outcome'
    );
  });
});
