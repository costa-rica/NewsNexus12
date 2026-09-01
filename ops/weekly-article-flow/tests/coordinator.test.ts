import { WeeklyFlowConfig } from '../src/config';
import { WorkerResultContractError } from '../src/contracts';
import { WeeklyArticleFlowCoordinator } from '../src/coordinator';
import { WeeklyFlowRepository } from '../src/database';
import { WorkerHttpClient } from '../src/http';

const config = (): WeeklyFlowConfig => ({
  repositoryPath: '/repo',
  resourcesPath: '/resources',
  devHosts: ['dev-host'],
  productionHosts: ['prod-host'],
  devDatabases: ['newsnexus_dev'],
  productionDatabases: ['newsnexus'],
  workerNodeUrl: new URL('http://127.0.0.1:3002'),
  workerPythonUrl: new URL('http://127.0.0.1:5000'),
  lockPath: '/var/lock/weekly.lock',
  backupDirectory: '/resources/backups',
  journalDirectory: '/resources/journal',
  alertStagingPath: '/resources/alert.md',
  alertHelperService: 'alert.service',
  rssSpreadsheetPath: '/resources/queries.xlsx',
  semanticDirectory: '/resources/semantic',
  stateFilesPath: '/resources/state',
  timeouts: {
    preflightSeconds: 900,
    duplicateCleanupSeconds: 3600,
    backupSeconds: 7200,
    deleteSeconds: 1800,
    rssSeconds: 86400,
    semanticSeconds: 14400,
    stateSeconds: 64800,
    aiApproverV02Seconds: 43200,
    runSeconds: 259200
  },
  polling: { initialMs: 1, maxMs: 2 },
  minimumFreeDiskBytes: 1,
  devRssTarget: 10
});

const preflight = async () => ({
  host: 'dev-host',
  databaseName: 'newsnexus_dev',
  databaseUser: 'nick',
  sourceRevision: 'a'.repeat(40),
  repositoryPath: '/repo',
  minimumFreeDiskBytes: 1,
  availableDiskBytes: 1000,
  activePromptVersionId: 7,
  checkedAt: new Date().toISOString()
});

const makeRun = (overrides: Record<string, unknown> = {}) => {
  const run: Record<string, any> = {
    id: 42,
    mode: 'dev_canary',
    status: 'pending',
    currentStage: 'preflight',
    startedAt: new Date(),
    rssArticlesAddedCount: null,
    cohortArticleCount: null,
    stageResults: {},
    update: jest.fn(async (values: Record<string, unknown>) => {
      Object.assign(run, values);
      return run;
    }),
    ...overrides
  };
  return run;
};

const makeRepository = (run: Record<string, any>, cohort = [1, 2]) => ({
  createNewRun: jest.fn(async () => run),
  loadForResume: jest.fn(async () => run),
  transitionRun: jest.fn(async (_run, status, reason = null) => {
    run.status = status;
    run.failureReason = reason;
    return run;
  }),
  startStage: jest.fn(async (_run, stage, evidence = {}) => {
    run.currentStage = stage;
    run.stageResults = {
      ...run.stageResults,
      [stage]: { status: 'running', startedAt: new Date().toISOString(), ...evidence }
    };
  }),
  finishStage: jest.fn(async (_run, stage, status, evidence = {}) => {
    run.stageResults = {
      ...run.stageResults,
      [stage]: { ...run.stageResults[stage], ...evidence, status, endedAt: new Date().toISOString() }
    };
  }),
  updateRunningStageEvidence: jest.fn(async (_run, stage, evidence) => {
    run.stageResults = {
      ...run.stageResults,
      [stage]: { ...run.stageResults[stage], ...evidence, status: 'running' }
    };
  }),
  getCohortArticleIds: jest.fn(async () => cohort)
}) as unknown as WeeklyFlowRepository;

const rssEvidence = (count = 2, endingReason = 'target_articles_collected') => ({
  jobId: 'rss-job',
  queueStatus: 'completed' as const,
  result: {
    schemaVersion: 1 as const,
    endingReason,
    terminalMessage: 'rss done',
    articlesAddedCount: count,
    queryResults: []
  }
});

const semanticEvidence = {
  jobId: 'semantic-job',
  queueStatus: 'completed' as const,
  result: {
    schemaVersion: 1 as const,
    endingReason: 'completed',
    terminalMessage: 'semantic done',
    selectedArticleIds: [1, 2],
    scoredArticleIds: [1, 2],
    skippedArticles: [],
    failedArticles: [],
    unattemptedArticleIds: []
  }
};

const stateEvidence = (breaker = false) => ({
  jobId: 'state-job',
  queueStatus: 'completed' as const,
  result: {
    schemaVersion: 1 as const,
    endingReason: breaker ? 'circuit_breaker' : 'completed',
    terminalMessage: breaker ? 'breaker tripped' : 'state done',
    selectedArticleIds: [1, 2],
    attemptedArticleIds: [1, 2],
    successfulArticleIds: breaker ? [] : [1, 2],
    skippedArticles: [],
    failedArticles: breaker
      ? [{ articleId: 1, reason: 'analysis_error' }, { articleId: 2, reason: 'timeout' }]
      : [],
    unattemptedArticleIds: [],
    maximumConsecutiveFailures: breaker ? 5 : 0,
    circuitBreakerTripped: breaker
  }
});

const buildCoordinator = (
  run: Record<string, any>,
  overrides: Record<string, unknown> = {},
  cohort = [1, 2]
) => {
  const repository = makeRepository(run, cohort);
  const duplicateCleanup = jest.fn();
  const verifiedBackup = jest.fn();
  const oldArticleDeletion = jest.fn();
  const rssStage = jest.fn(async (input) => {
    await input.onJobStarted?.('rss-job');
    return rssEvidence();
  });
  const semanticStage = jest.fn(async (input) => {
    await input.onJobStarted?.('semantic-job');
    return semanticEvidence;
  });
  const stateStage = jest.fn(async (input) => {
    await input.onJobStarted?.('state-job');
    return stateEvidence();
  });
  const coordinator = new WeeklyArticleFlowCoordinator({
    config: config(),
    repository,
    workerClient: {} as WorkerHttpClient,
    preflight,
    duplicateCleanup,
    verifiedBackup,
    oldArticleDeletion,
    rssStage,
    semanticStage,
    stateStage,
    ...overrides
  });
  return {
    coordinator,
    repository,
    duplicateCleanup,
    verifiedBackup,
    oldArticleDeletion,
    rssStage,
    semanticStage,
    stateStage
  };
};

describe('weekly article flow coordinator stages', () => {
  it('runs canary stages in order while skipping destructive maintenance', async () => {
    const run = makeRun();
    const setup = buildCoordinator(run);
    await setup.coordinator.run({ mode: 'dev_canary', allowLiveAi: false });

    expect(setup.duplicateCleanup).not.toHaveBeenCalled();
    expect(setup.verifiedBackup).not.toHaveBeenCalled();
    expect(setup.oldArticleDeletion).not.toHaveBeenCalled();
    expect(run.stageResults.duplicate_cleanup.status).toBe('skipped');
    expect(run.stageResults.backup.status).toBe('skipped');
    expect(run.stageResults.delete_old_articles.status).toBe('skipped');
    expect(setup.stateStage).toHaveBeenCalledWith(expect.objectContaining({
      articleIds: [1, 2],
      requestedCapacity: 2
    }));
    expect(run.stageResults.state_assigner.status).toBe('completed');
    expect(run.status).toBe('running');
  });

  it('blocks deletion and marks the run failed when backup verification fails', async () => {
    const run = makeRun({ mode: 'dev_destructive_recovery' });
    const duplicateCleanup = jest.fn(async () => ({ remainingCount: 0 }));
    const verifiedBackup = jest.fn(async () => { throw new Error('backup hash mismatch'); });
    const oldArticleDeletion = jest.fn();
    const setup = buildCoordinator(run, { duplicateCleanup, verifiedBackup, oldArticleDeletion });

    await expect(setup.coordinator.run({
      mode: 'dev_destructive_recovery',
      expectedDevDatabase: 'newsnexus_dev',
      allowLiveAi: false
    })).rejects.toThrow('backup hash mismatch');
    expect(oldArticleDeletion).not.toHaveBeenCalled();
    expect(run.status).toBe('failed');
  });

  it('completes without downstream analysis when RSS and cohort counts are zero', async () => {
    const run = makeRun();
    const rssStage = jest.fn(async () => rssEvidence(0, 'queries_exhausted'));
    const setup = buildCoordinator(run, { rssStage }, []);

    await setup.coordinator.run({ mode: 'dev_canary', allowLiveAi: false });
    expect(run.status).toBe('completed_no_new_articles');
    expect(setup.semanticStage).not.toHaveBeenCalled();
    expect(setup.stateStage).not.toHaveBeenCalled();
  });

  it('maps cohort mismatch and state breaker to named statuses', async () => {
    const mismatchRun = makeRun();
    const mismatch = buildCoordinator(mismatchRun, {}, [1]);
    await mismatch.coordinator.run({ mode: 'dev_canary', allowLiveAi: false });
    expect(mismatchRun.status).toBe('failure_rss_cohort_mismatch');

    const breakerRun = makeRun();
    const stateStage = jest.fn(async () => stateEvidence(true));
    const breaker = buildCoordinator(breakerRun, { stateStage });
    await breaker.coordinator.run({ mode: 'dev_canary', allowLiveAi: false });
    expect(breakerRun.status).toBe('failure_state_assigner_circuit_breaker');
  });

  it('reattaches a stored worker job without resubmission', async () => {
    const run = makeRun({
      status: 'running',
      currentStage: 'semantic_scorer',
      rssArticlesAddedCount: 2,
      cohortArticleCount: 2,
      stageResults: {
        preflight: { status: 'completed' },
        duplicate_cleanup: { status: 'skipped' },
        backup: { status: 'skipped' },
        delete_old_articles: { status: 'skipped' },
        google_rss: { status: 'completed' },
        semantic_scorer: { status: 'running', jobId: 'existing-semantic', startedAt: new Date().toISOString() }
      }
    });
    const setup = buildCoordinator(run);
    await setup.coordinator.run({ mode: 'dev_canary', resumeRunId: 42, allowLiveAi: false });
    expect(setup.semanticStage).toHaveBeenCalledWith(expect.objectContaining({
      previousJobId: 'existing-semantic'
    }));
  });

  it('stops an ambiguous deletion resume instead of repeating it', async () => {
    const run = makeRun({
      mode: 'dev_destructive_recovery',
      status: 'running',
      currentStage: 'delete_old_articles',
      stageResults: {
        preflight: { status: 'completed' },
        duplicate_cleanup: { status: 'completed' },
        backup: { status: 'completed' },
        delete_old_articles: { status: 'running', startedAt: new Date().toISOString() }
      }
    });
    const setup = buildCoordinator(run);
    await expect(setup.coordinator.run({
      mode: 'dev_destructive_recovery',
      resumeRunId: 42,
      expectedDevDatabase: 'newsnexus_dev',
      allowLiveAi: false
    })).rejects.toThrow('explicit reconciliation');
    expect(setup.oldArticleDeletion).not.toHaveBeenCalled();
  });

  it('maps malformed worker results and exhausted run budget to terminal failures', async () => {
    const contractRun = makeRun();
    const rssStage = jest.fn(async () => { throw new WorkerResultContractError('bad result'); });
    const contract = buildCoordinator(contractRun, { rssStage });
    await expect(contract.coordinator.run({ mode: 'dev_canary', allowLiveAi: false })).rejects.toThrow('bad result');
    expect(contractRun.status).toBe('failed_worker_result_contract');

    const timeoutRun = makeRun({ startedAt: new Date(Date.now() - 73 * 60 * 60 * 1000) });
    const timeout = buildCoordinator(timeoutRun);
    await expect(timeout.coordinator.run({ mode: 'dev_canary', allowLiveAi: false })).rejects.toThrow('72-hour');
    expect(timeoutRun.status).toBe('timed_out');
  });
});
