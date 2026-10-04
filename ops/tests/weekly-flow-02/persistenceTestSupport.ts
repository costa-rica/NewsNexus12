import type {
  PhaseFourDatabaseResult,
  PhaseFourHighWaterMarks,
  WeeklyFlowPersistence,
  WeeklyFlowRunRecord
} from '../../src/weekly-flow-02/persistence';

const cloneRun = (run: WeeklyFlowRunRecord): WeeklyFlowRunRecord => ({
  ...run,
  phaseData: structuredClone(run.phaseData),
  lastError: run.lastError ? structuredClone(run.lastError) : null
});

export interface InMemoryPersistence {
  persistence: WeeklyFlowPersistence;
  runs: WeeklyFlowRunRecord[];
  calls: string[];
}

interface InMemoryPersistenceOptions {
  phaseFourHighWaterMarks?: PhaseFourHighWaterMarks;
  phaseFourDatabaseResult?: PhaseFourDatabaseResult;
}

export const createRunRecord = (
  overrides: Partial<WeeklyFlowRunRecord> = {}
): WeeklyFlowRunRecord => {
  const startedAt = new Date('2026-10-03T12:00:00.000Z');
  return {
    id: 1,
    runStartedAt: startedAt,
    runCompleted: false,
    runCompletedAt: null,
    lastPhaseStarted: null,
    lastPhaseCompleted: null,
    phaseData: {},
    lastError: null,
    backupPath: null,
    backupByteSize: null,
    backupSha256: null,
    backupManifestVersion: null,
    newsApiRequestIdHighWaterMark: null,
    articleIdHighWaterMark: null,
    firstRssRequestId: null,
    firstRssArticleId: null,
    rssArticlesAddedCount: null,
    articleCount: null,
    rssJobId: null,
    semanticScorerJobId: null,
    stateAssignerJobId: null,
    aiApproverV02JobId: null,
    targetArticleThresholdDaysOld: null,
    createdAt: startedAt,
    updatedAt: startedAt,
    ...overrides
  };
};

export const createInMemoryPersistence = (
  initialRuns: WeeklyFlowRunRecord[] = [],
  options: InMemoryPersistenceOptions = {}
): InMemoryPersistence => {
  const runs = initialRuns.map(cloneRun);
  const calls: string[] = [];
  const requireRun = (runId: number): WeeklyFlowRunRecord => {
    const run = runs.find((candidate) => candidate.id === runId);
    if (!run) throw new Error(`Run ${runId} not found`);
    return run;
  };
  const touch = (run: WeeklyFlowRunRecord, at: Date): WeeklyFlowRunRecord => {
    run.updatedAt = at;
    return cloneRun(run);
  };

  const persistence: WeeklyFlowPersistence = {
    async getLatestRun() {
      calls.push('get-latest');
      const latest = [...runs].sort((left, right) => right.id - left.id)[0];
      return latest ? cloneRun(latest) : null;
    },
    async getRunById(runId) {
      calls.push(`get:${runId}`);
      const run = runs.find((candidate) => candidate.id === runId);
      return run ? cloneRun(run) : null;
    },
    async createRun(runStartedAt) {
      calls.push('create');
      const run = createRunRecord({
        id: runs.reduce((highest, candidate) => Math.max(highest, candidate.id), 0) + 1,
        runStartedAt,
        createdAt: runStartedAt,
        updatedAt: runStartedAt
      });
      runs.push(run);
      return cloneRun(run);
    },
    async recordPhaseStarted(runId, phase, startedAt) {
      calls.push(`start:${phase}`);
      const run = requireRun(runId);
      run.lastPhaseStarted = phase;
      run.phaseData[`phase${phase}`] = {
        status: 'started',
        startedAt: startedAt.toISOString()
      };
      return touch(run, startedAt);
    },
    async recordPhaseFourStarted(runId, startedAt) {
      calls.push('start:4');
      const run = requireRun(runId);
      const marks = options.phaseFourHighWaterMarks ?? {
        newsApiRequestIdHighWaterMark: 100,
        articleIdHighWaterMark: 200
      };
      run.lastPhaseStarted = 4;
      run.newsApiRequestIdHighWaterMark = marks.newsApiRequestIdHighWaterMark;
      run.articleIdHighWaterMark = marks.articleIdHighWaterMark;
      run.phaseData.phase4 = {
        status: 'started',
        startedAt: startedAt.toISOString(),
        ...marks
      };
      return touch(run, startedAt);
    },
    async recordPhaseFourProgress(runId, progress) {
      calls.push('progress:4');
      const run = requireRun(runId);
      if (progress.rssJobId !== undefined) run.rssJobId = progress.rssJobId;
      if (progress.rssArticlesAddedCount !== undefined) {
        run.rssArticlesAddedCount = Math.max(
          run.rssArticlesAddedCount ?? 0,
          progress.rssArticlesAddedCount
        );
      }
      run.phaseData.phase4 = {
        ...(run.phaseData.phase4 as Record<string, unknown>),
        progress: {
          observedAt: progress.observedAt.toISOString(),
          ...(progress.rssJobId === undefined ? {} : { rssJobId: progress.rssJobId }),
          ...(progress.status === undefined ? {} : { status: progress.status }),
          ...(progress.rssArticlesAddedCount === undefined
            ? {}
            : { rssArticlesAddedCount: run.rssArticlesAddedCount }),
          ...(progress.details === undefined ? {} : { details: structuredClone(progress.details) })
        }
      };
      return touch(run, progress.observedAt);
    },
    async readPhaseFourDatabaseResult(runId) {
      calls.push('database-result:4');
      requireRun(runId);
      return structuredClone(
        options.phaseFourDatabaseResult ?? {
          firstRssRequestId: 101,
          firstRssArticleId: 201,
          articleCount: 1
        }
      );
    },
    async recordPhaseCompleted(runId, phase, completedAt, phaseResult, fields = {}) {
      calls.push(`complete:${phase}`);
      const run = requireRun(runId);
      run.lastPhaseCompleted = phase;
      Object.assign(run, fields);
      run.phaseData[`phase${phase}`] = {
        ...(run.phaseData[`phase${phase}`] as Record<string, unknown>),
        status: 'completed',
        completedAt: completedAt.toISOString(),
        result: structuredClone(phaseResult)
      };
      return touch(run, completedAt);
    },
    async recordPhaseFourCompleted(runId, completedAt, phaseResult, fields) {
      calls.push('complete:4');
      const run = requireRun(runId);
      run.lastPhaseCompleted = 4;
      run.firstRssRequestId = fields.firstRssRequestId;
      run.firstRssArticleId = fields.firstRssArticleId;
      run.rssArticlesAddedCount =
        fields.rssArticlesAddedCount === null
          ? run.rssArticlesAddedCount
          : Math.max(run.rssArticlesAddedCount ?? 0, fields.rssArticlesAddedCount);
      run.articleCount = fields.articleCount;
      run.rssJobId = fields.rssJobId;
      run.phaseData.phase4 = {
        ...(run.phaseData.phase4 as Record<string, unknown>),
        status: 'completed',
        completedAt: completedAt.toISOString(),
        result: structuredClone(phaseResult)
      };
      return touch(run, completedAt);
    },
    async recordPhaseFourZeroWorkCompletion(runId, completedAt, phaseResult, fields) {
      calls.push('complete-zero:4');
      const run = requireRun(runId);
      run.lastPhaseCompleted = 4;
      run.firstRssRequestId = fields.firstRssRequestId;
      run.firstRssArticleId = fields.firstRssArticleId;
      run.rssArticlesAddedCount =
        fields.rssArticlesAddedCount === null
          ? run.rssArticlesAddedCount
          : Math.max(run.rssArticlesAddedCount ?? 0, fields.rssArticlesAddedCount);
      run.articleCount = 0;
      run.rssJobId = fields.rssJobId;
      run.runCompleted = true;
      run.runCompletedAt = completedAt;
      run.phaseData.phase4 = {
        ...(run.phaseData.phase4 as Record<string, unknown>),
        status: 'completed',
        completedAt: completedAt.toISOString(),
        result: structuredClone(phaseResult)
      };
      return touch(run, completedAt);
    },
    async recordFailure(runId, failure) {
      calls.push(`failure:${failure.phase ?? 'run'}`);
      const run = requireRun(runId);
      run.lastError = {
        phase: failure.phase,
        category: failure.category,
        message: failure.message,
        failedAt: failure.failedAt.toISOString()
      };
      return touch(run, failure.failedAt);
    },
    async recordRunCompleted(runId, completedAt) {
      calls.push('run-complete');
      const run = requireRun(runId);
      run.runCompleted = true;
      run.runCompletedAt = completedAt;
      return touch(run, completedAt);
    }
  };

  return { persistence, runs, calls };
};
