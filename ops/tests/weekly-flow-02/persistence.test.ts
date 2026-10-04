import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createSequelizeWeeklyFlowPersistence
} from '../../src/weekly-flow-02/sequelizePersistence';
import {
  WeeklyFlowPersistenceError,
  type WeeklyFlowRunRecord
} from '../../src/weekly-flow-02/persistence';
import { createRunRecord } from './persistenceTestSupport';

type AdapterModel = Parameters<typeof createSequelizeWeeklyFlowPersistence>[0];

interface MockRun extends WeeklyFlowRunRecord {
  update(values: Record<string, unknown>): Promise<MockRun>;
}

const mockRun = (overrides: Partial<WeeklyFlowRunRecord> = {}): MockRun => {
  const run = createRunRecord(overrides) as MockRun;
  run.update = async (values) => {
    Object.assign(run, values);
    run.updatedAt = new Date('2026-10-03T13:00:00.000Z');
    return run;
  };
  return run;
};

const mockModel = (initialRuns: MockRun[] = []) => {
  const runs = initialRuns;
  const findOneOptions: unknown[] = [];
  const model = {
    async findOne(options: unknown) {
      findOneOptions.push(options);
      return [...runs].sort((left, right) => right.id - left.id)[0] ?? null;
    },
    async findByPk(runId: number) {
      return runs.find((run) => run.id === runId) ?? null;
    },
    async create(values: { runStartedAt: Date }) {
      const run = mockRun({
        id: runs.reduce((highest, candidate) => Math.max(highest, candidate.id), 0) + 1,
        runStartedAt: values.runStartedAt,
        createdAt: values.runStartedAt,
        updatedAt: values.runStartedAt
      });
      runs.push(run);
      return run;
    }
  };
  return {
    model: model as unknown as AdapterModel,
    runs,
    findOneOptions
  };
};

describe('createSequelizeWeeklyFlowPersistence', () => {
  it('finds only the latest run and returns null for an absent requested run', async () => {
    const fixture = mockModel([mockRun({ id: 1 }), mockRun({ id: 2 })]);
    const persistence = createSequelizeWeeklyFlowPersistence(fixture.model);

    assert.equal((await persistence.getLatestRun())?.id, 2);
    assert.deepEqual(fixture.findOneOptions, [{ order: [['id', 'DESC']] }]);
    assert.equal(await persistence.getRunById(999), null);
  });

  it('creates a run and records ordered phase progress with typed backup fields', async () => {
    const fixture = mockModel();
    const persistence = createSequelizeWeeklyFlowPersistence(fixture.model);
    const startedAt = new Date('2026-10-03T12:00:00.000Z');
    const completedAt = new Date('2026-10-03T12:01:00.000Z');
    const created = await persistence.createRun(startedAt);

    await persistence.recordPhaseStarted(created.id, 1, startedAt);
    const completed = await persistence.recordPhaseCompleted(
      created.id,
      1,
      completedAt,
      { rowsDeleted: 4 },
      {
        backupPath: '/tmp/fixture.zip',
        backupByteSize: '9007199254740993',
        backupSha256: 'a'.repeat(64),
        backupManifestVersion: 1
      }
    );

    assert.equal(completed.lastPhaseStarted, 1);
    assert.equal(completed.lastPhaseCompleted, 1);
    assert.equal(completed.backupByteSize, '9007199254740993');
    assert.deepEqual(completed.phaseData.phase1, {
      status: 'completed',
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      result: { rowsDeleted: 4 }
    });
  });

  it('rejects missing runs and out-of-order transitions', async () => {
    const fixture = mockModel([mockRun({ id: 4 })]);
    const persistence = createSequelizeWeeklyFlowPersistence(fixture.model);

    await assert.rejects(
      persistence.recordPhaseStarted(999, 1, new Date()),
      WeeklyFlowPersistenceError
    );
    await assert.rejects(
      persistence.recordPhaseStarted(4, 2, new Date()),
      /cannot start after completed phase 0/
    );
    await assert.rejects(
      persistence.recordPhaseCompleted(4, 1, new Date(), {}),
      /was not the next started phase/
    );
  });

  it('validates typed Phase 4 high-water marks when reading a run', async () => {
    const valid = mockRun({
      id: 5,
      newsApiRequestIdHighWaterMark: 0,
      articleIdHighWaterMark: Number.MAX_SAFE_INTEGER
    });
    const validPersistence = createSequelizeWeeklyFlowPersistence(
      mockModel([valid]).model
    );

    const record = await validPersistence.getLatestRun();
    assert.equal(record?.newsApiRequestIdHighWaterMark, 0);
    assert.equal(record?.articleIdHighWaterMark, Number.MAX_SAFE_INTEGER);

    const invalid = mockRun({
      id: 6,
      articleIdHighWaterMark: -1
    });
    const invalidPersistence = createSequelizeWeeklyFlowPersistence(
      mockModel([invalid]).model
    );

    await assert.rejects(
      invalidPersistence.getLatestRun(),
      /articleIdHighWaterMark must be a non-negative safe integer/
    );
  });

  it('records sanitized failure data and terminal completion independently', async () => {
    const run = mockRun({ id: 8, lastPhaseStarted: 1 });
    const fixture = mockModel([run]);
    const persistence = createSequelizeWeeklyFlowPersistence(fixture.model);
    const failedAt = new Date('2026-10-03T12:02:00.000Z');

    const failed = await persistence.recordFailure(8, {
      phase: 1,
      category: 'timeout',
      message: 'outcome unverified',
      failedAt
    });
    assert.deepEqual(failed.lastError, {
      phase: 1,
      category: 'timeout',
      message: 'outcome unverified',
      failedAt: failedAt.toISOString()
    });

    const completedAt = new Date('2026-10-03T12:03:00.000Z');
    const completed = await persistence.recordRunCompleted(8, completedAt);
    assert.equal(completed.runCompleted, true);
    assert.equal(completed.runCompletedAt, completedAt);
    assert.deepEqual(completed.lastError, failed.lastError);
  });

  it('does not expose database error details through the adapter boundary', async () => {
    const fixture = mockModel();
    fixture.model.findOne = async () => {
      throw new Error('connection failed PG_PASSWORD=do-not-log');
    };
    const persistence = createSequelizeWeeklyFlowPersistence(fixture.model);

    await assert.rejects(persistence.getLatestRun(), (error: unknown) => {
      assert.ok(error instanceof WeeklyFlowPersistenceError);
      assert.equal(error.message, 'Latest weekly flow run lookup failed');
      assert.doesNotMatch(error.message, /PG_PASSWORD|do-not-log/);
      return true;
    });
  });
});
