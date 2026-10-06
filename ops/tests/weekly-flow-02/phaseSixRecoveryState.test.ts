import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PhaseSixRecoveryStateError,
  findPhaseSixIncompatibleAttempt,
  parsePhaseSixIncompatibleRecovery,
  serializePhaseSixIncompatibleRecovery,
  upsertPhaseSixIncompatibleAttempt
} from '../../src/weekly-flow-02/phaseSixRecoveryState';

const source = {
  sourceJobId: 'source-job',
  sourceJobCreatedAt: '2026-10-05T09:00:01.000Z',
  detectedAt: '2026-10-05T09:05:00.000Z',
  missingParameterFields: ['targetArticleThresholdDaysOld'],
  lastStatus: 'running',
  cancellationRequestedAt: '2026-10-05T09:06:00.000Z',
  cancellationOutcome: 'cancel_requested',
  verification: { kind: 'inactive' }
};

describe('Phase 6 recovery state', () => {
  it('parses V06 history and distinguishes reused job IDs by createdAt', () => {
    const recovery = parsePhaseSixIncompatibleRecovery({
      attempts: [
        {
          jobId: '0001',
          jobCreatedAt: '2026-10-05T09:00:01.000Z',
          detectedAt: '2026-10-05T09:01:00.000Z',
          missingParameterFields: ['targetArticleStateReviewCount']
        }
      ]
    });

    assert.ok(recovery);
    assert.ok(
      findPhaseSixIncompatibleAttempt(
        recovery,
        '0001',
        '2026-10-05T09:00:01.000Z'
      )
    );
    assert.equal(
      findPhaseSixIncompatibleAttempt(
        recovery,
        '0001',
        '2026-10-05T10:00:01.000Z'
      ),
      null
    );
  });

  it('normalizes a V04 source without a replacement and preserves attributable details', () => {
    const recovery = parsePhaseSixIncompatibleRecovery(source);

    assert.ok(recovery);
    assert.equal(recovery.attempts.length, 1);
    assert.equal(recovery.attempts[0].jobId, 'source-job');
    assert.equal(recovery.attempts[0].lastStatus, 'running');
    assert.equal(recovery.attempts[0].cancellationOutcome, 'cancel_requested');
    assert.deepEqual(recovery.attempts[0].verification, { kind: 'inactive' });
  });

  it('normalizes only the proven V04 source when a replacement exists', () => {
    const recovery = parsePhaseSixIncompatibleRecovery({
      ...source,
      lastStatus: 'completed',
      replacementJobId: 'compatible-replacement',
      replacementStartedAt: '2026-10-05T09:10:00.000Z'
    });

    assert.ok(recovery);
    assert.deepEqual(recovery.attempts.map((attempt) => attempt.jobId), ['source-job']);
    assert.equal(recovery.attempts[0].lastStatus, undefined);
    assert.equal(recovery.attempts[0].cancellationRequestedAt, undefined);
    assert.equal(recovery.attempts[0].cancellationOutcome, undefined);
    assert.equal(recovery.attempts[0].verification, undefined);
  });

  it('upserts repeated observations without duplicating an identity', () => {
    const first = upsertPhaseSixIncompatibleAttempt(null, {
      jobId: '0001',
      jobCreatedAt: '2026-10-05T09:00:01.000Z',
      detectedAt: new Date('2026-10-05T09:01:00.000Z'),
      missingParameterFields: ['targetArticleThresholdDaysOld'],
      lastStatus: 'running'
    });
    const updated = upsertPhaseSixIncompatibleAttempt(first, {
      jobId: '0001',
      jobCreatedAt: '2026-10-05T09:00:01.000Z',
      detectedAt: new Date('2026-10-05T09:01:00.000Z'),
      missingParameterFields: ['targetArticleThresholdDaysOld'],
      lastStatus: 'canceled',
      cancellationOutcome: 'cancel_requested',
      verification: { kind: 'inactive' }
    });

    assert.equal(updated.attempts.length, 1);
    assert.equal(updated.attempts[0].lastStatus, 'canceled');
    assert.equal(updated.attempts[0].cancellationOutcome, 'cancel_requested');
    assert.deepEqual(updated.attempts[0].verification, { kind: 'inactive' });
    assert.deepEqual(
      parsePhaseSixIncompatibleRecovery(serializePhaseSixIncompatibleRecovery(updated)),
      updated
    );
  });

  it('rejects duplicate V06 identities and invalid legacy source evidence', () => {
    const duplicate = {
      jobId: 'same',
      jobCreatedAt: '2026-10-05T09:00:01.000Z',
      detectedAt: '2026-10-05T09:01:00.000Z',
      missingParameterFields: ['targetArticleThresholdDaysOld']
    };
    assert.throws(
      () => parsePhaseSixIncompatibleRecovery({ attempts: [duplicate, duplicate] }),
      PhaseSixRecoveryStateError
    );
    assert.throws(
      () =>
        parsePhaseSixIncompatibleRecovery({
          ...source,
          sourceJobCreatedAt: 'not-a-date'
        }),
      PhaseSixRecoveryStateError
    );
  });
});
