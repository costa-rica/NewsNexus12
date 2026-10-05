import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createSequelizePhaseFourDataStore,
  createSequelizeWeeklyFlowPersistence
} from '../../src/weekly-flow-02/sequelizePersistence';
import {
  GOOGLE_NEWS_RSS_SOURCE_NAME,
  WeeklyFlowPersistenceError,
  persistenceErrorDiagnostics,
  type PhaseFourDataStore,
  type WeeklyFlowRunRecord
} from '../../src/weekly-flow-02/persistence';
import type { PhaseFourDataModels } from '../../src/weekly-flow-02/sequelizePersistence';
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

  it('protects Phase 5 start, marker state, and dedicated completion', async () => {
    const run = mockRun({
      id: 50,
      lastPhaseStarted: 4,
      lastPhaseCompleted: 4,
      articleCount: 3,
      phaseData: { phase4: { status: 'completed' } }
    });
    const persistence = createSequelizeWeeklyFlowPersistence(mockModel([run]).model);
    const phaseStartedAt = new Date('2026-10-05T09:00:00Z');
    await persistence.recordPhaseFiveStarted(50, phaseStartedAt);
    await assert.rejects(persistence.recordPhaseFiveStarted(50, new Date()), /already started/);
    await persistence.recordPhaseFiveProgress(50, {
      observedAt: new Date('2026-10-05T09:01:00Z'),
      semanticScorerJobId: 'semantic-1',
      status: 'running',
      jobCreatedAt: '2026-10-05T09:00:01.000Z',
      monitoringLimit: {
        jobId: 'semantic-1',
        jobCreatedAt: '2026-10-05T09:00:01.000Z',
        reachedAt: new Date('2026-10-05T15:00:00Z')
      }
    });
    await persistence.recordPhaseFiveProgress(50, {
      observedAt: new Date('2026-10-05T15:01:00Z'),
      status: 'canceled'
    });
    assert.equal(
      (run.phaseData.phase5 as Record<string, unknown>).monitoringLimit !== undefined,
      true
    );
    await assert.rejects(
      persistence.recordPhaseFiveCompleted(50, new Date(), {}, {
        semanticScorerJobId: 'semantic-1',
        jobCreatedAt: '2026-10-05T09:00:01.000Z'
      }),
      /monitoring-limited/
    );
    await assert.rejects(
      persistence.recordPhaseCompleted(50, 5, new Date(), {}),
      /recordPhaseFiveCompleted/
    );
    await persistence.recordPhaseFiveProgress(50, {
      observedAt: new Date('2026-10-05T15:02:00Z'),
      semanticScorerJobId: 'semantic-2',
      status: 'completed',
      jobCreatedAt: '2026-10-05T15:01:00.000Z'
    });
    const completed = await persistence.recordPhaseFiveCompleted(50, new Date(), { status: 'completed' }, {
      semanticScorerJobId: 'semantic-2',
      jobCreatedAt: '2026-10-05T15:01:00.000Z'
    });
    assert.equal(completed.lastPhaseCompleted, 5);
    assert.equal(completed.runCompleted, false);
    assert.equal(completed.articleCount, 3);
  });

  it('allows a reused Phase 5 job ID only when its creation time differs from the marker', async () => {
    const run = mockRun({
      id: 51,
      lastPhaseStarted: 4,
      lastPhaseCompleted: 4,
      articleCount: 2
    });
    const persistence = createSequelizeWeeklyFlowPersistence(mockModel([run]).model);
    await persistence.recordPhaseFiveStarted(51, new Date('2026-10-05T10:00:00Z'));
    await persistence.recordPhaseFiveProgress(51, {
      observedAt: new Date('2026-10-05T16:00:00Z'),
      semanticScorerJobId: 'reused-semantic-id',
      status: 'running',
      jobCreatedAt: '2026-10-05T10:00:01.000Z',
      monitoringLimit: {
        jobId: 'reused-semantic-id',
        jobCreatedAt: '2026-10-05T10:00:01.000Z',
        reachedAt: new Date('2026-10-05T16:00:00Z')
      }
    });
    await persistence.recordPhaseFiveProgress(51, {
      observedAt: new Date('2026-10-05T16:01:00Z'),
      status: 'completed',
      jobCreatedAt: '2026-10-05T16:00:30.000Z'
    });

    const completed = await persistence.recordPhaseFiveCompleted(
      51,
      new Date('2026-10-05T16:01:00Z'),
      { status: 'completed' },
      {
        semanticScorerJobId: 'reused-semantic-id',
        jobCreatedAt: '2026-10-05T16:00:30.000Z'
      }
    );
    assert.equal(completed.lastPhaseCompleted, 5);
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

  it('persists immutable Phase 4 marks and compact recoverable progress', async () => {
    const run = mockRun({
      id: 7,
      lastPhaseStarted: 3,
      lastPhaseCompleted: 3
    });
    const fixture = mockModel([run]);
    const dataStore: PhaseFourDataStore = {
      async readHighWaterMarks() {
        return {
          newsApiRequestIdHighWaterMark: 80,
          articleIdHighWaterMark: 140
        };
      },
      async readPostMarkResult(marks) {
        assert.deepEqual(marks, {
          newsApiRequestIdHighWaterMark: 80,
          articleIdHighWaterMark: 140
        });
        return {
          firstRssRequestId: 81,
          firstRssArticleId: 141,
          articleCount: 9
        };
      }
    };
    const persistence = createSequelizeWeeklyFlowPersistence(fixture.model, dataStore);
    const startedAt = new Date('2026-10-04T12:00:00.000Z');

    const started = await persistence.recordPhaseFourStarted(7, startedAt);
    assert.equal(started.newsApiRequestIdHighWaterMark, 80);
    assert.equal(started.articleIdHighWaterMark, 140);
    assert.deepEqual(started.phaseData.phase4, {
      status: 'started',
      startedAt: startedAt.toISOString(),
      newsApiRequestIdHighWaterMark: 80,
      articleIdHighWaterMark: 140
    });

    const firstProgressAt = new Date('2026-10-04T12:05:00.000Z');
    await persistence.recordPhaseFourProgress(7, {
      observedAt: firstProgressAt,
      rssJobId: 'job-12',
      status: 'running',
      rssArticlesAddedCount: 4
    });
    const laterProgress = await persistence.recordPhaseFourProgress(7, {
      observedAt: new Date('2026-10-04T12:10:00.000Z'),
      status: 'running',
      rssArticlesAddedCount: 0
    });
    assert.equal(laterProgress.rssJobId, 'job-12');
    assert.equal(laterProgress.rssArticlesAddedCount, 4);
    assert.deepEqual(await persistence.readPhaseFourDatabaseResult(7), {
      firstRssRequestId: 81,
      firstRssArticleId: 141,
      articleCount: 9
    });

    await assert.rejects(
      persistence.recordPhaseFourStarted(7, startedAt),
      /high-water marks are already set/
    );

    const completed = await persistence.recordPhaseFourCompleted(
      7,
      new Date('2026-10-04T12:20:00.000Z'),
      { endingReason: 'queries_exhausted' },
      {
        firstRssRequestId: 81,
        firstRssArticleId: 141,
        rssArticlesAddedCount: 0,
        articleCount: 9,
        rssJobId: 'job-12'
      }
    );
    assert.equal(completed.lastPhaseCompleted, 4);
    assert.equal(completed.articleCount, 9);
    assert.equal(completed.rssArticlesAddedCount, 4);
    assert.equal(completed.runCompleted, false);
  });

  it('atomically records Phase 4 zero work and completes the run', async () => {
    const run = mockRun({
      id: 9,
      lastPhaseStarted: 3,
      lastPhaseCompleted: 3
    });
    const fixture = mockModel([run]);
    const dataStore: PhaseFourDataStore = {
      async readHighWaterMarks() {
        return {
          newsApiRequestIdHighWaterMark: 20,
          articleIdHighWaterMark: 40
        };
      },
      async readPostMarkResult() {
        return { firstRssRequestId: 21, firstRssArticleId: null, articleCount: 0 };
      }
    };
    const persistence = createSequelizeWeeklyFlowPersistence(fixture.model, dataStore);
    await persistence.recordPhaseFourStarted(9, new Date('2026-10-04T12:00:00.000Z'));
    const completedAt = new Date('2026-10-04T12:30:00.000Z');
    const completed = await persistence.recordPhaseFourZeroWorkCompletion(
      9,
      completedAt,
      { endingReason: 'queries_exhausted' },
      {
        firstRssRequestId: 21,
        firstRssArticleId: null,
        rssArticlesAddedCount: 0,
        rssJobId: 'job-9'
      }
    );

    assert.equal(completed.lastPhaseCompleted, 4);
    assert.equal(completed.articleCount, 0);
    assert.equal(completed.runCompleted, true);
    assert.equal(completed.runCompletedAt, completedAt);
    assert.deepEqual(completed.phaseData.phase4, {
      status: 'completed',
      startedAt: '2026-10-04T12:00:00.000Z',
      newsApiRequestIdHighWaterMark: 20,
      articleIdHighWaterMark: 40,
      completedAt: completedAt.toISOString(),
      result: { endingReason: 'queries_exhausted' }
    });
  });

  it('preserves an earlier RSS-added count during zero-work completion', async () => {
    const run = mockRun({
      id: 11,
      lastPhaseStarted: 4,
      lastPhaseCompleted: 3,
      newsApiRequestIdHighWaterMark: 20,
      articleIdHighWaterMark: 40,
      rssArticlesAddedCount: 8,
      phaseData: { phase4: { status: 'started' } }
    });
    const fixture = mockModel([run]);
    const persistence = createSequelizeWeeklyFlowPersistence(fixture.model);

    const completed = await persistence.recordPhaseFourZeroWorkCompletion(
      11,
      new Date('2026-10-04T12:30:00.000Z'),
      { endingReason: 'queries_exhausted' },
      {
        firstRssRequestId: null,
        firstRssArticleId: null,
        rssArticlesAddedCount: 0,
        rssJobId: 'job-11'
      }
    );

    assert.equal(completed.articleCount, 0);
    assert.equal(completed.rssArticlesAddedCount, 8);
    assert.equal(completed.runCompleted, true);
  });

  it('leaves both Phase 4 and the run incomplete when zero-work update fails', async () => {
    const run = mockRun({
      id: 10,
      lastPhaseStarted: 4,
      lastPhaseCompleted: 3,
      newsApiRequestIdHighWaterMark: 5,
      articleIdHighWaterMark: 8,
      phaseData: { phase4: { status: 'started' } }
    });
    run.update = async () => {
      throw new Error('update failed');
    };
    const fixture = mockModel([run]);
    const persistence = createSequelizeWeeklyFlowPersistence(fixture.model);

    await assert.rejects(
      persistence.recordPhaseFourZeroWorkCompletion(
        10,
        new Date('2026-10-04T12:30:00.000Z'),
        { endingReason: 'queries_exhausted' },
        {
          firstRssRequestId: null,
          firstRssArticleId: null,
          rssArticlesAddedCount: 0,
          rssJobId: 'job-10'
        }
      ),
      /Phase 4 zero-work completion could not be persisted/
    );
    assert.equal(run.lastPhaseCompleted, 3);
    assert.equal(run.runCompleted, false);
    assert.equal(run.runCompletedAt, null);
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

  it('keeps a concise adapter message while preserving the database error cause', async () => {
    const fixture = mockModel();
    const databaseError = Object.assign(new Error('column does not exist'), {
      code: '42703',
      table: 'WeeklyArticleFlowRuns02',
      column: 'articleIdHighWaterMark',
      sql: 'SELECT "articleIdHighWaterMark" FROM "WeeklyArticleFlowRuns02"'
    });
    fixture.model.findOne = async () => {
      throw databaseError;
    };
    const persistence = createSequelizeWeeklyFlowPersistence(fixture.model);

    await assert.rejects(persistence.getLatestRun(), (error: unknown) => {
      assert.ok(error instanceof WeeklyFlowPersistenceError);
      assert.equal(error.message, 'Latest weekly flow run lookup failed');
      assert.equal(error.cause, databaseError);
      assert.deepEqual(persistenceErrorDiagnostics(error).databaseError, {
        name: 'Error',
        message: 'column does not exist',
        stack: databaseError.stack,
        code: '42703',
        table: 'WeeklyArticleFlowRuns02',
        column: 'articleIdHighWaterMark',
        sql: 'SELECT "articleIdHighWaterMark" FROM "WeeklyArticleFlowRuns02"'
      });
      return true;
    });
  });

  it('suppresses all database details when an error references the Users table', () => {
    for (const databaseError of [
      Object.assign(new Error('duplicate key'), {
        table: 'Users',
        detail: 'Key (email)=(private@example.test) already exists'
      }),
      Object.assign(new Error('query failed'), {
        sql: 'SELECT email, password FROM "public"."Users" WHERE id = 4',
        parameters: ['private@example.test']
      })
    ]) {
      const error = new WeeklyFlowPersistenceError('Database operation failed', {
        cause: databaseError
      });
      const diagnostics = persistenceErrorDiagnostics(error);

      assert.deepEqual(diagnostics, {
        databaseErrorSuppressed: true,
        databaseErrorSuppressionReason: 'Error references the Users table'
      });
      assert.doesNotMatch(JSON.stringify(diagnostics), /private@example\.test|password/i);
    }
  });
});

describe('createSequelizePhaseFourDataStore', () => {
  it('reads empty and string aggregates and uses the exact RSS source', async () => {
    const sourceQueries: Array<Record<string, unknown>> = [];
    const articleQueries: Array<Record<string, unknown>> = [];
    const fakeNewsApiRequestModel = {
      async max() {
        return null;
      },
      async min() {
        return '21';
      }
    };
    const models = {
      NewsApiRequest: fakeNewsApiRequestModel,
      NewsArticleAggregatorSource: {
        async findOne(options: Record<string, unknown>) {
          sourceQueries.push(options);
          return { id: 3 };
        }
      },
      Article: {
        async max() {
          return '12';
        },
        async findOne(options: Record<string, unknown>) {
          articleQueries.push(options);
          return { id: 22 };
        },
        async count(options: Record<string, unknown>) {
          articleQueries.push(options);
          return '7';
        }
      }
    } as unknown as PhaseFourDataModels;
    const dataStore = createSequelizePhaseFourDataStore(models);

    assert.deepEqual(await dataStore.readHighWaterMarks(), {
      newsApiRequestIdHighWaterMark: 0,
      articleIdHighWaterMark: 12
    });
    assert.deepEqual(
      await dataStore.readPostMarkResult({
        newsApiRequestIdHighWaterMark: 20,
        articleIdHighWaterMark: 15
      }),
      {
        firstRssRequestId: 21,
        firstRssArticleId: 22,
        articleCount: 7
      }
    );
    assert.equal(GOOGLE_NEWS_RSS_SOURCE_NAME, 'Google News RSS');
    assert.deepEqual(sourceQueries[0]?.where, {
      nameOfOrg: 'Google News RSS'
    });
    const include = articleQueries[0]?.include as Array<Record<string, unknown>>;
    assert.equal(include[0]?.model, fakeNewsApiRequestModel);
    assert.equal(include[0]?.required, true);
  });

  it('rejects unsafe database aggregates', async () => {
    const models = {
      NewsApiRequest: {
        async max() {
          return '9007199254740992';
        }
      },
      NewsArticleAggregatorSource: {},
      Article: {
        async max() {
          return 1;
        }
      }
    } as unknown as PhaseFourDataModels;
    const dataStore = createSequelizePhaseFourDataStore(models);

    await assert.rejects(
      dataStore.readHighWaterMarks(),
      /NewsApiRequests maximum ID must be a non-negative safe integer/
    );
  });
});
