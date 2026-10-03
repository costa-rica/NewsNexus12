import type {
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
  initialRuns: WeeklyFlowRunRecord[] = []
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
