import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseWeeklyFlowInvocation, WeeklyFlowCliError } from '../../src/weekly-flow-02/cli';
import {
  selectWeeklyFlowRun,
  WeeklyFlowRunSelectionError
} from '../../src/weekly-flow-02/runSelection';
import { createRunRecord } from './persistenceTestSupport';

const now = new Date('2026-10-03T12:00:00.000Z');

describe('parseWeeklyFlowInvocation', () => {
  it('parses default, new-run, and continuation requests', () => {
    assert.deepEqual(parseWeeklyFlowInvocation([]), { mode: 'default' });
    assert.deepEqual(parseWeeklyFlowInvocation(['--new-run']), { mode: 'new' });
    assert.deepEqual(parseWeeklyFlowInvocation(['--continue-run']), {
      mode: 'continue',
      runId: null
    });
    assert.deepEqual(parseWeeklyFlowInvocation(['--continue-run', '42']), {
      mode: 'continue',
      runId: 42
    });
  });

  it('rejects unknown, conflicting, duplicate, and invalid arguments', () => {
    for (const args of [
      ['--unknown'],
      ['--new-run', '--continue-run'],
      ['--new-run', '--new-run'],
      ['--continue-run', '0'],
      ['--continue-run', '-1'],
      ['--continue-run', '1.5'],
      ['--continue-run', '01'],
      ['--continue-run', '1', '2']
    ]) {
      assert.throws(() => parseWeeklyFlowInvocation(args), WeeklyFlowCliError);
    }
  });
});

describe('selectWeeklyFlowRun', () => {
  it('starts a new run when no run exists or the latest run is complete', () => {
    assert.equal(selectWeeklyFlowRun({ mode: 'default' }, null, now).action, 'new');
    assert.equal(
      selectWeeklyFlowRun(
        { mode: 'default' },
        createRunRecord({ runCompleted: true, runCompletedAt: now }),
        now
      ).action,
      'new'
    );
  });

  it('replaces incomplete runs stopped during Phases 1 through 3 regardless of age', () => {
    for (const lastPhaseCompleted of [null, 1, 2] as const) {
      const run = createRunRecord({
        lastPhaseStarted: (lastPhaseCompleted === null ? 1 : lastPhaseCompleted + 1) as 1 | 2 | 3,
        lastPhaseCompleted,
        runStartedAt: new Date('2026-10-03T11:59:00.000Z')
      });
      assert.equal(selectWeeklyFlowRun({ mode: 'default' }, run, now).action, 'new');
    }
  });

  it('continues through exactly 72 hours and replaces runs older than 72 hours', () => {
    const atBoundary = createRunRecord({
      runStartedAt: new Date('2026-09-30T12:00:00.000Z'),
      lastPhaseStarted: 3,
      lastPhaseCompleted: 3
    });
    const older = createRunRecord({
      runStartedAt: new Date('2026-09-30T11:59:59.999Z'),
      lastPhaseStarted: 3,
      lastPhaseCompleted: 3
    });

    assert.equal(selectWeeklyFlowRun({ mode: 'default' }, atBoundary, now).action, 'continue');
    assert.equal(selectWeeklyFlowRun({ mode: 'default' }, older, now).action, 'new');
  });

  it('honors explicit new and eligible continuation requests', () => {
    const run = createRunRecord({ lastPhaseStarted: 3, lastPhaseCompleted: 3 });
    assert.equal(selectWeeklyFlowRun({ mode: 'new' }, run, now).action, 'new');
    assert.equal(
      selectWeeklyFlowRun({ mode: 'continue', runId: run.id }, run, now).action,
      'continue'
    );
  });

  it('rejects unavailable, complete, early, future, and invalid continuation candidates', () => {
    assert.throws(
      () => selectWeeklyFlowRun({ mode: 'continue', runId: null }, null, now),
      WeeklyFlowRunSelectionError
    );
    assert.throws(
      () =>
        selectWeeklyFlowRun(
          { mode: 'continue', runId: 1 },
          createRunRecord({ runCompleted: true, runCompletedAt: now }),
          now
        ),
      /already complete/
    );
    assert.throws(
      () =>
        selectWeeklyFlowRun(
          { mode: 'continue', runId: 1 },
          createRunRecord({ lastPhaseStarted: 2, lastPhaseCompleted: 1 }),
          now
        ),
      /Phases 1–3/
    );
    for (const runStartedAt of [new Date('invalid'), new Date('2026-10-03T12:00:01.000Z')]) {
      assert.throws(
        () =>
          selectWeeklyFlowRun(
            { mode: 'continue', runId: 1 },
            createRunRecord({ runStartedAt, lastPhaseStarted: 3, lastPhaseCompleted: 3 }),
            now
          ),
        WeeklyFlowRunSelectionError
      );
    }
  });
});
