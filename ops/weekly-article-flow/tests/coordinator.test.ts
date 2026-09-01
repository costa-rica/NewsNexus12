import { WeeklyFlowConfig } from '../src/config';
import { WorkerResultContractError } from '../src/contracts';
import { WeeklyArticleFlowCoordinator } from '../src/coordinator';
import { WeeklyFlowRepository } from '../src/database';
import { WorkerHttpClient, WorkerHttpError } from '../src/http';

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
  alertHelperService: 'newsnexus12-publish-weekly-alert.service',
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
    reportingSeconds: 600,
    runSeconds: 259200
  },
  v02PreviewTtlSeconds: 960,
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
    host: 'dev-host',
    sourceRevision: 'a'.repeat(40),
    startedAt: new Date(),
    jsonlFilePath: null,
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
  getCohortArticleIds: jest.fn(async () => cohort),
  loadV02SafeRunState: jest.fn(),
  loadV02Reconciliation: jest.fn(async () => ({
    run: {
      id: 81,
      jobId: 'v02-job',
      status: 'completed',
      endingReason: null,
      attemptedCount: 2,
      completedCount: 2,
      failedCount: 0,
      invalidResponseCount: 0,
      skippedCount: 0,
      selectionSnapshot: [{ articleId: 1 }, { articleId: 2 }]
    },
    selectedArticleIds: [1, 2],
    predictions: [
      { articleId: 1, resultStatus: 'completed', prediction: 'approved' },
      { articleId: 2, resultStatus: 'completed', prediction: 'irrelevant' }
    ]
  }))
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
  const createV02Preview = jest.fn(async () => ({
    previewToken: 'ephemeral-test-token',
    evidence: {
      draftRunId: 81,
      previewExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      plannedEligibleCount: 2,
      selectedArticleIds: [1, 2],
      cohortArticleIds: [1, 2],
      overlapArticleIds: [1, 2],
      overlapCount: 2,
      overlapPercentage: 100
    }
  }));
  const acceptV02Preview = jest.fn(async (_client, evidence) => ({
    ...evidence,
    v02RunId: 81,
    jobId: 'v02-job'
  }));
  const pollV02Terminal = jest.fn(async () => ({
    v02RunId: 81,
    jobId: 'v02-job',
    runStatus: 'completed' as const,
    queueStatus: 'completed' as const,
    endingReason: null
  }));
  const cancelV02Run = jest.fn(async () => ({ outcome: 'cancel_requested' }));
  const reconcileV02 = jest.fn(() => ({
    selectedArticleIds: [1, 2], attemptedArticleIds: [1, 2], completedArticleIds: [1, 2],
    failedArticleIds: [], invalidResponseArticleIds: [], skippedArticleIds: [],
    unattemptedArticleIds: [], unresolvedArticleIds: [], selectedCount: 2, attemptedCount: 2,
    completedCount: 2, failedCount: 0, invalidResponseCount: 0, skippedCount: 0, unattemptedCount: 0
  }));
  const appendJournal = jest.fn(async (
    _directory: string,
    _event: unknown,
    _journalDate?: string
  ) => '/resources/journal/weekly-flow-20260831.jsonl');
  const stageAlert = jest.fn(async () => undefined);
  const publishAlert = jest.fn(async () => ({ exitCode: 0, durationMs: 1 }));
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
    createV02Preview,
    acceptV02Preview,
    pollV02Terminal,
    cancelV02Run,
    reconcileV02,
    appendJournal,
    stageAlert,
    publishAlert,
    validateResumeActivity: jest.fn(async () => undefined),
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
    stateStage,
    createV02Preview,
    acceptV02Preview,
    pollV02Terminal,
    cancelV02Run,
    reconcileV02,
    appendJournal,
    stageAlert,
    publishAlert
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
    expect(run.status).toBe('completed');
    const events = setup.appendJournal.mock.calls.map((call) => call[1] as Record<string, unknown>);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'preflight', eventType: 'stage_started' }),
      expect.objectContaining({ stage: 'google_rss', eventType: 'job_started', jobId: 'rss-job' }),
      expect.objectContaining({ stage: 'ai_approver_v02_preview', eventType: 'stage_finished', selectedCount: 2 }),
      expect.objectContaining({ stage: 'reconciliation', eventType: 'stage_finished', completedCount: 2 }),
      expect.objectContaining({ stage: 'reporting', eventType: 'run_terminal', status: 'completed' })
    ]));
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
    expect(timeout.appendJournal.mock.calls.some((call) => {
      const event = call[1] as Record<string, unknown>;
      return event.eventType === 'run_terminal' && event.status === 'timed_out';
    })).toBe(true);
    expect(timeout.stageAlert).toHaveBeenCalled();
    expect(timeout.publishAlert).toHaveBeenCalled();
  });

  it('uses the RSS count without compensation and never persists the preview token', async () => {
    const run = makeRun();
    const setup = buildCoordinator(run);
    await setup.coordinator.run({ mode: 'dev_canary', allowLiveAi: true });
    expect(setup.createV02Preview).toHaveBeenCalledWith(expect.objectContaining({
      requestedArticleCount: 2,
      cohortArticleIds: [1, 2]
    }));
    expect(JSON.stringify(run.stageResults)).not.toContain('ephemeral-test-token');
    expect(JSON.stringify(run.stageResults)).not.toContain('previewToken');
    expect(JSON.stringify(setup.appendJournal.mock.calls)).not.toContain('ephemeral-test-token');
    expect(JSON.stringify(setup.appendJournal.mock.calls)).not.toContain('previewToken');
  });

  it.each([
    ['circuit_breaker', 'completed', 'failure_ai_approver_v02'],
    ['failed', 'failed', 'failure_ai_approver_v02'],
    ['canceled', 'canceled', 'canceled']
  ])('maps V02 %s/%s to %s', async (runStatus, queueStatus, expected) => {
    const run = makeRun();
    const pollV02Terminal = jest.fn(async () => ({
      v02RunId: 81,
      jobId: 'v02-job',
      runStatus,
      queueStatus,
      endingReason: 'terminal test'
    }));
    const setup = buildCoordinator(run, { pollV02Terminal });
    await setup.coordinator.run({ mode: 'dev_canary', allowLiveAi: true });
    expect(run.status).toBe(expected);
  });

  it('preserves timeout when V02 polling reaches its deadline', async () => {
    const run = makeRun();
    const pollV02Terminal = jest.fn(async () => { throw new Error('AI Approver V02 timed out: 81'); });
    const setup = buildCoordinator(run, { pollV02Terminal });
    await expect(setup.coordinator.run({ mode: 'dev_canary', allowLiveAi: true })).rejects.toThrow('timed out');
    expect(run.status).toBe('timed_out');
  });

  it('does not reset the persisted 12-hour V02 deadline on resume', async () => {
    const run = makeRun({
      status: 'running',
      currentStage: 'ai_approver_v02_execution',
      startedAt: new Date(Date.now() - 14 * 60 * 60 * 1000),
      rssArticlesAddedCount: 2,
      cohortArticleCount: 2,
      stageResults: {
        preflight: { status: 'completed' }, duplicate_cleanup: { status: 'skipped' }, backup: { status: 'skipped' },
        delete_old_articles: { status: 'skipped' }, google_rss: { status: 'completed' },
        semantic_scorer: { status: 'completed' }, state_assigner: { status: 'completed' },
        ai_approver_v02_preview: { status: 'completed', draftRunId: 81, v02RunId: 81, jobId: 'v02-job' },
        ai_approver_v02_execution: {
          status: 'running', v02RunId: 81, jobId: 'v02-job',
          startedAt: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString()
        }
      }
    });
    const setup = buildCoordinator(run);
    await expect(setup.coordinator.run({
      mode: 'dev_canary', resumeRunId: 42, allowLiveAi: true
    })).rejects.toThrow('timed out');
    expect(setup.pollV02Terminal).not.toHaveBeenCalled();
    expect(setup.cancelV02Run).toHaveBeenCalledWith(expect.anything(), 81);
    expect(run.status).toBe('timed_out');
  });

  it('waits through an ambiguous preview barrier and resumes the same run', async () => {
    let currentTime = Date.now();
    const future = new Date(currentTime + 60_000).toISOString();
    const run = makeRun({
      startedAt: new Date(currentTime),
      status: 'running',
      currentStage: 'ai_approver_v02_preview',
      rssArticlesAddedCount: 2,
      cohortArticleCount: 2,
      stageResults: {
        preflight: { status: 'completed' },
        duplicate_cleanup: { status: 'skipped' },
        backup: { status: 'skipped' },
        delete_old_articles: { status: 'skipped' },
        google_rss: { status: 'completed' },
        semantic_scorer: { status: 'completed' },
        state_assigner: { status: 'completed' },
        ai_approver_v02_preview: { status: 'running', previewExpiryBarrierAt: future }
      }
    });
    const sleep = jest.fn(async (milliseconds: number) => { currentTime += milliseconds; });
    const setup = buildCoordinator(run, { now: () => new Date(currentTime), sleep });
    await setup.coordinator.run({ mode: 'dev_canary', resumeRunId: 42, allowLiveAi: true });
    expect(sleep).toHaveBeenCalledWith(60_000);
    expect(run.status).toBe('completed');
    expect(setup.createV02Preview).toHaveBeenCalledTimes(1);
  });

  it('maps a definitive preview rejection to V02 failure without an expiry wait', async () => {
    const run = makeRun();
    const createV02Preview = jest.fn(async () => {
      throw new WorkerHttpError('worker request failed (400): no eligible articles', 400);
    });
    const setup = buildCoordinator(run, { createV02Preview });
    await expect(setup.coordinator.run({ mode: 'dev_canary', allowLiveAi: true })).rejects.toThrow('no eligible');
    expect(run.status).toBe('failure_ai_approver_v02');
  });

  it.each([
    ['malformed success response', 200],
    ['server error after submission', 500]
  ])('waits through the safety barrier after an ambiguous %s', async (_label, statusCode) => {
    let currentTime = Date.now();
    const run = makeRun({ startedAt: new Date(currentTime) });
    const createV02Preview = jest.fn()
      .mockRejectedValueOnce(new WorkerHttpError('ambiguous preview response', statusCode))
      .mockResolvedValueOnce({
        previewToken: 'ephemeral-retry-token',
        evidence: {
          draftRunId: 82,
          previewExpiresAt: new Date(currentTime + 120_000).toISOString(),
          plannedEligibleCount: 2,
          selectedArticleIds: [1, 2], cohortArticleIds: [1, 2], overlapArticleIds: [1, 2],
          overlapCount: 2, overlapPercentage: 100
        }
      });
    const sleep = jest.fn(async (milliseconds: number) => { currentTime += milliseconds; });
    const setup = buildCoordinator(run, {
      createV02Preview,
      now: () => new Date(currentTime),
      sleep
    });
    await setup.coordinator.run({ mode: 'dev_canary', allowLiveAi: true });
    expect(sleep).toHaveBeenCalledWith(960_000);
    expect(createV02Preview).toHaveBeenCalledTimes(2);
    expect(run.status).toBe('completed');
  });

  it('waits for a known draft to expire when its in-memory token was lost', async () => {
    let currentTime = Date.now();
    const expiry = new Date(currentTime + 60_000);
    const run = makeRun({
      startedAt: new Date(currentTime), status: 'running', currentStage: 'ai_approver_v02_preview',
      rssArticlesAddedCount: 2, cohortArticleCount: 2,
      stageResults: {
        preflight: { status: 'completed' }, duplicate_cleanup: { status: 'skipped' }, backup: { status: 'skipped' },
        delete_old_articles: { status: 'skipped' }, google_rss: { status: 'completed' },
        semantic_scorer: { status: 'completed' }, state_assigner: { status: 'completed' },
        ai_approver_v02_preview: { status: 'running', draftRunId: 81, previewExpiresAt: expiry.toISOString() }
      }
    });
    const sleep = jest.fn(async (milliseconds: number) => { currentTime += milliseconds; });
    const setup = buildCoordinator(run, { now: () => new Date(currentTime), sleep });
    (setup.repository.loadV02SafeRunState as jest.Mock).mockResolvedValue({
      id: 81, jobId: null, status: 'draft', previewExpiresAt: expiry,
      plannedEligibleCount: 2, selectionSnapshot: [{ articleId: 1 }, { articleId: 2 }]
    });
    await setup.coordinator.run({ mode: 'dev_canary', resumeRunId: 42, allowLiveAi: true });
    expect(sleep).toHaveBeenCalledWith(120_000);
    expect(run.status).toBe('completed');
    expect(setup.createV02Preview).toHaveBeenCalledTimes(1);
  });

  it('reattaches an accepted V02 run after a lost start response', async () => {
    const run = makeRun({
      status: 'running',
      currentStage: 'ai_approver_v02_preview',
      rssArticlesAddedCount: 2,
      cohortArticleCount: 2,
      stageResults: {
        preflight: { status: 'completed' }, duplicate_cleanup: { status: 'skipped' },
        backup: { status: 'skipped' }, delete_old_articles: { status: 'skipped' },
        google_rss: { status: 'completed' }, semantic_scorer: { status: 'completed' },
        state_assigner: { status: 'completed' },
        ai_approver_v02_preview: {
          status: 'running', draftRunId: 81, plannedEligibleCount: 2,
          selectedArticleIds: [1, 2], cohortArticleIds: [1, 2], overlapArticleIds: [1, 2],
          overlapCount: 2, overlapPercentage: 100
        }
      }
    });
    const setup = buildCoordinator(run);
    (setup.repository.loadV02SafeRunState as jest.Mock).mockResolvedValue({
      id: 81,
      jobId: 'v02-job',
      status: 'queued',
      previewExpiresAt: null,
      plannedEligibleCount: 2,
      selectionSnapshot: [{ articleId: 1 }, { articleId: 2 }]
    });
    await setup.coordinator.run({ mode: 'dev_canary', resumeRunId: 42, allowLiveAi: true });
    expect(setup.createV02Preview).not.toHaveBeenCalled();
    expect(setup.pollV02Terminal).toHaveBeenCalledWith(expect.objectContaining({
      v02RunId: 81,
      jobId: 'v02-job'
    }));
    expect(run.status).toBe('completed');
  });

  it('allows only the owned accepted V02 job during resume preflight reconciliation', async () => {
    const run = makeRun({
      status: 'running', currentStage: 'ai_approver_v02_preview', rssArticlesAddedCount: 2, cohortArticleCount: 2,
      stageResults: {
        preflight: { status: 'completed' }, duplicate_cleanup: { status: 'skipped' }, backup: { status: 'skipped' },
        delete_old_articles: { status: 'skipped' }, google_rss: { status: 'completed' },
        semantic_scorer: { status: 'completed' }, state_assigner: { status: 'completed' },
        ai_approver_v02_preview: { status: 'running', draftRunId: 81 }
      }
    });
    const workerClient = {
      getQueueStatus: jest.fn(async (worker: string) => worker === 'python'
        ? { runningJob: { jobId: 'v02-job' }, queuedJobs: [], summary: {} }
        : { runningJob: null, queuedJobs: [], summary: {} }),
      requestJson: jest.fn(async () => ({ id: 81, status: 'running' }))
    } as unknown as WorkerHttpClient;
    const setup = buildCoordinator(run, { workerClient, validateResumeActivity: undefined });
    (setup.repository.loadV02SafeRunState as jest.Mock).mockResolvedValue({
      id: 81, jobId: 'v02-job', status: 'running', previewExpiresAt: null,
      plannedEligibleCount: 2, selectionSnapshot: [{ articleId: 1 }, { articleId: 2 }]
    });
    await setup.coordinator.run({ mode: 'dev_canary', resumeRunId: 42, allowLiveAi: true });
    expect(run.status).toBe('completed');
    expect(setup.createV02Preview).not.toHaveBeenCalled();
  });

  it('records reporting failure without rewriting successful workflow status', async () => {
    const run = makeRun();
    const appendJournal = jest.fn(async () => { throw new Error('disk full'); });
    const setup = buildCoordinator(run, { appendJournal });
    await setup.coordinator.run({ mode: 'dev_canary', allowLiveAi: true });
    expect(run.status).toBe('completed');
    expect(run.stageResults.reporting.status).toBe('failed');
    expect(run.stageResults.reporting.reportingFailures[0]).toContain('disk full');
  });

  it('journals terminal status only after Postgres is authoritative', async () => {
    const run = makeRun();
    let statusAtTerminalEvent: string | undefined;
    const appendJournal = jest.fn(async (_directory, event) => {
      if (event.eventType === 'run_terminal') statusAtTerminalEvent = run.status;
      return '/resources/journal/weekly-flow-20260831.jsonl';
    });
    const setup = buildCoordinator(run, { appendJournal });
    await setup.coordinator.run({ mode: 'dev_canary', allowLiveAi: true });
    expect(statusAtTerminalEvent).toBe('completed');
  });

  it('caps the entire reporting stage without rewriting successful status', async () => {
    const run = makeRun();
    const shortConfig = config();
    shortConfig.timeouts.reportingSeconds = 0.001;
    const appendJournal = jest.fn(async (_directory, event) => {
      if (event.eventType === 'run_terminal') return new Promise<string>(() => undefined);
      return '/resources/journal/weekly-flow-20260831.jsonl';
    });
    const setup = buildCoordinator(run, { config: shortConfig, appendJournal });
    await setup.coordinator.run({ mode: 'dev_canary', allowLiveAi: true });
    expect(run.status).toBe('completed');
    expect(run.stageResults.reporting.status).toBe('failed');
    expect(run.stageResults.reporting.reportingFailures).toContain('reporting timed out');
  });

  it('prevents a late journal writer from overwriting timed-out reporting evidence', async () => {
    const run = makeRun();
    const shortConfig = config();
    shortConfig.timeouts.reportingSeconds = 0.001;
    let resolveTerminal!: (value: string) => void;
    const appendJournal = jest.fn(async (_directory, event) => {
      if (event.eventType === 'run_terminal') {
        return new Promise<string>((resolve) => { resolveTerminal = resolve; });
      }
      return '/resources/journal/weekly-flow-20260831.jsonl';
    });
    const setup = buildCoordinator(run, { config: shortConfig, appendJournal });
    await setup.coordinator.run({ mode: 'dev_canary', allowLiveAi: true });
    expect(run.stageResults.reporting.status).toBe('failed');
    resolveTerminal('/resources/journal/weekly-flow-20260831.jsonl');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(run.stageResults.reporting.status).toBe('failed');
  });

  it('records alert publisher failure without replacing the original V02 failure', async () => {
    const run = makeRun();
    const pollV02Terminal = jest.fn(async () => ({
      v02RunId: 81, jobId: 'v02-job', runStatus: 'failed', queueStatus: 'failed', endingReason: 'execution_failed'
    }));
    const publishAlert = jest.fn(async () => { throw new Error('sync failed'); });
    const setup = buildCoordinator(run, { pollV02Terminal, publishAlert });
    await setup.coordinator.run({ mode: 'dev_canary', allowLiveAi: true });
    expect(run.status).toBe('failure_ai_approver_v02');
    expect(run.stageResults.reporting.status).toBe('failed');
    expect(run.stageResults.reporting.helperEvents).toEqual(['staged', 'failed']);
    expect(run.stageResults.reporting.reportingFailures[0]).toContain('sync failed');
    expect(setup.stageAlert).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        failedStage: 'ai_approver_v02_execution',
        counts: expect.objectContaining({ selected: 2, attempted: 2, completed: 2 })
      }),
      expect.any(AbortSignal)
    );
  });
});
