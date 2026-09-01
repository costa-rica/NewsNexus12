import {
  Article,
  NewsApiRequest,
  NewsArticleAggregatorSource,
  WeeklyArticleFlowRun,
  initModels,
  sequelize
} from '@newsnexus/db-models';
import { WeeklyFlowConfig } from '../../src/config';
import { WeeklyArticleFlowCoordinator } from '../../src/coordinator';
import { WeeklyFlowRepository } from '../../src/database';
import { WorkerHttpClient } from '../../src/http';

const config: WeeklyFlowConfig = {
  repositoryPath: '/repo',
  resourcesPath: '/resources',
  devHosts: ['dev-host'],
  productionHosts: ['prod-host'],
  devDatabases: ['newsnexus_test_weekly_coordinator'],
  productionDatabases: ['production-placeholder'],
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
  devRssTarget: 2
};

describe('weekly coordinator disposable database integration', () => {
  beforeAll(() => {
    initModels();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('persists one fake-worker canary without treating JSONL as authority', async () => {
    const repository = new WeeklyFlowRepository();
    let cohortArticleIds: number[] = [];
    jest.spyOn(repository, 'loadV02Reconciliation').mockResolvedValue({
      run: {
        id: 81,
        jobId: 'fake-v02-job',
        status: 'completed',
        endingReason: null,
        attemptedCount: 2,
        completedCount: 2,
        failedCount: 0,
        invalidResponseCount: 0,
        skippedCount: 0,
        selectionSnapshot: []
      },
      selectedArticleIds: [],
      predictions: []
    } as never);

    const coordinator = new WeeklyArticleFlowCoordinator({
      config,
      repository,
      workerClient: {} as WorkerHttpClient,
      preflight: async () => ({
        host: 'dev-host',
        databaseName: 'newsnexus_test_weekly_coordinator',
        databaseUser: 'test-user',
        sourceRevision: 'a'.repeat(40),
        repositoryPath: '/repo',
        minimumFreeDiskBytes: 1,
        availableDiskBytes: 1000,
        activePromptVersionId: 7,
        checkedAt: new Date().toISOString()
      }),
      rssStage: jest.fn(async (input) => {
        await input.onJobStarted?.('fake-rss-job');
        const source = await NewsArticleAggregatorSource.create({
          nameOfOrg: 'Weekly coordinator integration source',
          isApi: true
        });
        const request = await NewsApiRequest.create({
          newsArticleAggregatorSourceId: source.id,
          weeklyArticleFlowRunId: input.runId
        });
        const articles = await Article.bulkCreate([
          { title: 'weekly integration one', newsApiRequestId: request.id },
          { title: 'weekly integration two', newsApiRequestId: request.id }
        ]);
        cohortArticleIds = articles.map(({ id }) => id);
        return {
          jobId: 'fake-rss-job',
          queueStatus: 'completed' as const,
          result: {
            schemaVersion: 1 as const,
            endingReason: 'target_articles_collected' as const,
            terminalMessage: 'fake RSS completed',
            articlesAddedCount: 2,
            queryResults: []
          }
        };
      }),
      semanticStage: jest.fn(async (input) => {
        await input.onJobStarted?.('fake-semantic-job');
        return {
          jobId: 'fake-semantic-job',
          queueStatus: 'completed' as const,
          result: {
            schemaVersion: 1 as const,
            endingReason: 'completed' as const,
            terminalMessage: 'fake semantic scorer completed',
            selectedArticleIds: cohortArticleIds,
            scoredArticleIds: cohortArticleIds,
            skippedArticles: [],
            failedArticles: [],
            unattemptedArticleIds: []
          }
        };
      }),
      stateStage: jest.fn(async (input) => {
        await input.onJobStarted?.('fake-state-job');
        return {
          jobId: 'fake-state-job',
          queueStatus: 'completed' as const,
          result: {
            schemaVersion: 1 as const,
            endingReason: 'completed' as const,
            terminalMessage: 'fake state assigner completed',
            selectedArticleIds: cohortArticleIds,
            attemptedArticleIds: cohortArticleIds,
            successfulArticleIds: cohortArticleIds,
            skippedArticles: [],
            failedArticles: [],
            unattemptedArticleIds: [],
            maximumConsecutiveFailures: 0,
            circuitBreakerTripped: false
          }
        };
      }),
      createV02Preview: jest.fn(async () => ({
        previewToken: 'integration-token-kept-in-memory',
        evidence: {
          draftRunId: 81,
          previewExpiresAt: new Date(Date.now() + 60_000).toISOString(),
          plannedEligibleCount: 2,
          selectedArticleIds: cohortArticleIds,
          cohortArticleIds,
          overlapArticleIds: cohortArticleIds,
          overlapCount: 2,
          overlapPercentage: 100
        }
      })),
      acceptV02Preview: jest.fn(async (_client, evidence) => ({
        ...evidence,
        v02RunId: 81,
        jobId: 'fake-v02-job'
      })),
      pollV02Terminal: jest.fn(async () => ({
        v02RunId: 81,
        jobId: 'fake-v02-job',
        runStatus: 'completed' as const,
        queueStatus: 'completed' as const,
        endingReason: null
      })),
      reconcileV02: jest.fn(() => ({
        selectedArticleIds: cohortArticleIds,
        attemptedArticleIds: cohortArticleIds,
        completedArticleIds: cohortArticleIds,
        failedArticleIds: [],
        invalidResponseArticleIds: [],
        skippedArticleIds: [],
        unattemptedArticleIds: [],
        unresolvedArticleIds: [],
        selectedCount: 2,
        attemptedCount: 2,
        completedCount: 2,
        failedCount: 0,
        invalidResponseCount: 0,
        skippedCount: 0,
        unattemptedCount: 0
      })),
      appendJournal: jest.fn(async () => '/missing/non-authoritative-weekly-flow.jsonl'),
      validateResumeActivity: jest.fn(async () => undefined)
    });

    await coordinator.run({ mode: 'dev_canary', allowLiveAi: true, canaryTarget: 2 });

    const run = await WeeklyArticleFlowRun.findOne();
    expect(run).not.toBeNull();
    expect(run?.status).toBe('completed');
    expect(run?.rssArticlesAddedCount).toBe(2);
    expect(run?.cohortArticleCount).toBe(2);
    expect(run?.stageResults.google_rss.status).toBe('completed');
    expect(run?.stageResults.reconciliation.status).toBe('completed');
    expect(JSON.stringify(run?.stageResults)).not.toContain('integration-token-kept-in-memory');
  });
});
