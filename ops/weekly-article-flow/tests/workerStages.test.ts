import {
  classifyRssEnding,
  runRssWorkerStage,
  runSemanticWorkerStage,
  runStateWorkerStage
} from '../src/stages';
import { WorkerHttpClient } from '../src/http';

const rssResult = (endingReason = 'queries_exhausted') => ({
  schemaVersion: 1,
  endingReason,
  terminalMessage: 'rss done',
  articlesAddedCount: 2,
  successfulQueryCount: 1,
  skippedQueryCount: 0,
  failedQueryCount: 0,
  queryResults: [{ status: 'success' }]
});

const semanticResult = {
  schemaVersion: 1,
  endingReason: 'completed',
  terminalMessage: 'semantic done',
  selectedArticleIds: [1],
  scoredArticleIds: [1],
  skippedArticles: [],
  failedArticles: [],
  unattemptedArticleIds: [],
  selectedCount: 1,
  attemptedCount: 1,
  successfulCount: 1,
  skippedCount: 0,
  failedCount: 0,
  unattemptedCount: 0
};

const stateResult = {
  schemaVersion: 1,
  endingReason: 'completed',
  terminalMessage: 'state done',
  selectedArticleIds: [1, 2],
  attemptedArticleIds: [1, 2],
  successfulArticleIds: [1, 2],
  skippedArticles: [],
  failedArticles: [],
  unattemptedArticleIds: [],
  selectedCount: 2,
  attemptedCount: 2,
  successfulCount: 2,
  skippedCount: 0,
  failedCount: 0,
  unattemptedCount: 0,
  maximumConsecutiveFailures: 0,
  circuitBreakerTripped: false
};

const clientMock = (result: Record<string, unknown>) => ({
  startJob: jest.fn().mockResolvedValue({ jobId: 'job-1', status: 'queued', endpointName: '/test' }),
  pollQueueJob: jest.fn().mockResolvedValue({
    jobId: 'job-1',
    endpointName: '/test',
    status: 'completed',
    result
  }),
  cancelQueueJob: jest.fn()
}) as unknown as WorkerHttpClient;

describe('worker stages', () => {
  it.each([
    ['dev_canary', 'queries_exhausted', false, 'accepted'],
    ['dev_canary', 'target_articles_collected', true, 'accepted'],
    ['dev_destructive_recovery', 'target_articles_collected', true, 'accepted'],
    ['dev_destructive_recovery', 'target_articles_collected', false, 'failed'],
    ['manual_production', 'target_articles_collected', true, 'failed'],
    ['scheduled_production', 'rate_limited', false, 'rate_limited'],
    ['scheduled_production', 'canceled', false, 'canceled'],
    ['scheduled_production', 'aborted', false, 'canceled'],
    ['scheduled_production', 'error', false, 'failed']
  ] as const)('classifies %s RSS %s', (mode, reason, targeted, expected) => {
    expect(classifyRssEnding(mode, reason, targeted)).toBe(expected);
  });

  it('submits RSS ownership and persists the job ID before polling', async () => {
    const client = clientMock(rssResult());
    const onJobStarted = jest.fn().mockResolvedValue(undefined);
    const evidence = await runRssWorkerStage({
      client,
      runId: 42,
      mode: 'dev_canary',
      targetArticlesAddedCount: 10,
      deadline: new Date(Date.now() + 1000),
      polling: { initialMs: 1, maxMs: 2 },
      onJobStarted
    });

    expect(client.startJob).toHaveBeenCalledWith('node', '/request-google-rss/start-job', {
      weeklyArticleFlowRunId: 42,
      targetArticlesAddedCount: 10
    });
    expect(onJobStarted).toHaveBeenCalledWith('job-1');
    expect(onJobStarted.mock.invocationCallOrder[0]).toBeLessThan(
      (client.pollQueueJob as jest.Mock).mock.invocationCallOrder[0]
    );
    expect(evidence.result.articlesAddedCount).toBe(2);
  });

  it('reattaches semantic work without submitting a replacement job', async () => {
    const client = clientMock(semanticResult);
    await runSemanticWorkerStage({
      client,
      previousJobId: 'existing-job',
      deadline: new Date(Date.now() + 1000),
      polling: { initialMs: 1, maxMs: 2 }
    });
    expect(client.startJob).not.toHaveBeenCalled();
    expect(client.pollQueueJob).toHaveBeenCalledWith(
      'node', 'existing-job', expect.objectContaining({ initialMs: 1, maxMs: 2 })
    );
  });

  it('submits exact state IDs and sufficient capacity', async () => {
    const client = clientMock(stateResult);
    await runStateWorkerStage({
      client,
      articleIds: [1, 2],
      requestedCapacity: 2,
      deadline: new Date(Date.now() + 1000),
      polling: { initialMs: 1, maxMs: 2 }
    });
    expect(client.startJob).toHaveBeenCalledWith('node', '/state-assigner/start-job', {
      articleIds: [1, 2],
      targetArticleStateReviewCount: 2
    });
    await expect(runStateWorkerStage({
      client,
      articleIds: [1, 2],
      requestedCapacity: 1,
      deadline: new Date(Date.now() + 1000),
      polling: { initialMs: 1, maxMs: 2 }
    })).rejects.toThrow('sufficient capacity');
  });

  it('cancels a child job after polling failure', async () => {
    const client = clientMock(rssResult());
    (client.pollQueueJob as jest.Mock).mockRejectedValue(new Error('timed out'));
    (client.cancelQueueJob as jest.Mock).mockResolvedValue({ outcome: 'cancel_requested' });
    await expect(runRssWorkerStage({
      client,
      runId: 42,
      mode: 'dev_canary',
      deadline: new Date(Date.now() + 1000),
      polling: { initialMs: 1, maxMs: 2 }
    })).rejects.toThrow('timed out');
    expect(client.cancelQueueJob).toHaveBeenCalledWith('node', 'job-1');
  });
});
