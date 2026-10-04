import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { OpsConfig } from '../../src/config';
import {
  CollectGoogleNewsRssError,
  collectGoogleNewsRss,
  type GoogleNewsRssWorker
} from '../../src/weekly-flow-02/phases/04_collectGoogleNewsRss';
import {
  GOOGLE_NEWS_RSS_ENDPOINT_NAME,
  GoogleNewsRssClientError,
  type GoogleNewsRssEndingReason,
  type GoogleNewsRssJob
} from '../../src/weekly-flow-02/phases/04_googleNewsRssClient';
import { createInMemoryPersistence, createRunRecord } from './persistenceTestSupport';

const config: Pick<
  OpsConfig,
  | 'workerNodeBaseUrl'
  | 'workerNodeRequestTimeoutSeconds'
  | 'rssStatusPollIntervalSeconds'
  | 'rssToleratedConsecutiveStatusFailures'
  | 'rssJobTimeoutHours'
> = {
  workerNodeBaseUrl: 'http://worker-node.test:3002/',
  workerNodeRequestTimeoutSeconds: 60,
  rssStatusPollIntervalSeconds: 300,
  rssToleratedConsecutiveStatusFailures: 2,
  rssJobTimeoutHours: 24
};

const startedAt = new Date('2026-10-04T09:00:00.000Z');

const phaseThreeRun = () =>
  createRunRecord({
    lastPhaseStarted: 3,
    lastPhaseCompleted: 3,
    phaseData: {
      phase3: {
        status: 'completed',
        startedAt: '2026-10-04T08:00:00.000Z',
        completedAt: '2026-10-04T08:30:00.000Z'
      }
    }
  });

const continuedPhaseFourRun = (overrides = {}) =>
  createRunRecord({
    lastPhaseStarted: 4,
    lastPhaseCompleted: 3,
    newsApiRequestIdHighWaterMark: 100,
    articleIdHighWaterMark: 200,
    rssJobId: 'saved-job',
    phaseData: {
      phase4: {
        status: 'started',
        startedAt: startedAt.toISOString(),
        newsApiRequestIdHighWaterMark: 100,
        articleIdHighWaterMark: 200
      }
    },
    ...overrides
  });

const job = (
  jobId: string,
  status: GoogleNewsRssJob['status'],
  options: {
    endingReason?: GoogleNewsRssEndingReason;
    articlesAddedCount?: number;
    createdAt?: string;
    endedAt?: string;
    failureReason?: string;
  } = {}
): GoogleNewsRssJob => ({
  jobId,
  endpointName: GOOGLE_NEWS_RSS_ENDPOINT_NAME,
  status,
  createdAt: options.createdAt ?? startedAt.toISOString(),
  ...(status === 'running' ? { startedAt: startedAt.toISOString() } : {}),
  ...(['completed', 'failed', 'canceled'].includes(status)
    ? { endedAt: options.endedAt ?? '2026-10-04T10:00:00.000Z' }
    : {}),
  ...(options.failureReason === undefined ? {} : { failureReason: options.failureReason }),
  ...(status === 'completed'
    ? {
        result: {
          endingReason: options.endingReason ?? 'queries_exhausted',
          endingMessage: options.endingReason ?? 'All queries processed',
          articlesAddedCount: options.articlesAddedCount ?? 4
        }
      }
    : {})
});

const dependencies = (
  persistence: ReturnType<typeof createInMemoryPersistence>['persistence'],
  worker: GoogleNewsRssWorker,
  clock = { value: new Date('2026-10-04T10:01:00.000Z') }
) => ({
  persistence,
  worker,
  now: () => new Date(clock.value),
  delay: async (milliseconds: number) => {
    clock.value = new Date(clock.value.getTime() + milliseconds);
  }
});

describe('collectGoogleNewsRss', () => {
  it('captures high-water marks before starting a job and completes a nonzero batch', async () => {
    const memory = createInMemoryPersistence([phaseThreeRun()], {
      phaseFourDatabaseResult: {
        firstRssRequestId: 101,
        firstRssArticleId: 201,
        articleCount: 7
      }
    });
    const worker: GoogleNewsRssWorker = {
      start: async () => ({
        jobId: 'new-job',
        status: 'queued',
        endpointName: GOOGLE_NEWS_RSS_ENDPOINT_NAME
      }),
      getStatus: async () => job('new-job', 'completed', { articlesAddedCount: 4 }),
      cancel: async () => 'canceled'
    };

    const result = await collectGoogleNewsRss(
      memory.runs[0],
      config,
      dependencies(memory.persistence, worker)
    );

    assert.deepEqual(result, {
      kind: 'ready_for_phase_5',
      articleCount: 7,
      firstRssRequestId: 101,
      firstRssArticleId: 201,
      rssArticlesAddedCount: 4,
      rssJobId: 'new-job'
    });
    assert.deepEqual(memory.calls, [
      'start:4',
      'progress:4',
      'progress:4',
      'database-result:4',
      'complete:4'
    ]);
    assert.equal(memory.runs[0].runCompleted, false);
  });

  it('atomically completes the run for verified zero work', async () => {
    const memory = createInMemoryPersistence([phaseThreeRun()], {
      phaseFourDatabaseResult: {
        firstRssRequestId: null,
        firstRssArticleId: null,
        articleCount: 0
      }
    });
    const worker: GoogleNewsRssWorker = {
      start: async () => ({
        jobId: 'zero-job',
        status: 'queued',
        endpointName: GOOGLE_NEWS_RSS_ENDPOINT_NAME
      }),
      getStatus: async () => job('zero-job', 'completed', { articlesAddedCount: 0 }),
      cancel: async () => 'canceled'
    };

    const result = await collectGoogleNewsRss(
      memory.runs[0],
      config,
      dependencies(memory.persistence, worker)
    );

    assert.equal(result.kind, 'zero_work');
    assert.equal(memory.runs[0].runCompleted, true);
    assert.equal(memory.runs[0].lastPhaseCompleted, 4);
    assert.equal(memory.calls.at(-1), 'complete-zero:4');
  });

  it('reuses a saved job and does not recalculate high-water marks', async () => {
    const run = continuedPhaseFourRun();
    const memory = createInMemoryPersistence([run]);
    let starts = 0;
    const statuses = [job('saved-job', 'running'), job('saved-job', 'completed')];
    const worker: GoogleNewsRssWorker = {
      start: async () => {
        starts += 1;
        throw new Error('start should not be called');
      },
      getStatus: async () => statuses.shift() as GoogleNewsRssJob,
      cancel: async () => 'canceled'
    };

    const result = await collectGoogleNewsRss(
      memory.runs[0],
      config,
      dependencies(memory.persistence, worker)
    );

    assert.equal(result.kind, 'ready_for_phase_5');
    assert.equal(starts, 0);
    assert.equal(memory.calls.includes('start:4'), false);
  });

  it('replaces one failed saved job and never starts more than one job', async () => {
    const memory = createInMemoryPersistence([continuedPhaseFourRun()]);
    let starts = 0;
    const worker: GoogleNewsRssWorker = {
      start: async () => {
        starts += 1;
        return {
          jobId: 'replacement-job',
          status: 'queued',
          endpointName: GOOGLE_NEWS_RSS_ENDPOINT_NAME
        };
      },
      getStatus: async (jobId) =>
        jobId === 'saved-job'
          ? job('saved-job', 'failed', { failureReason: 'worker_restart' })
          : job('replacement-job', 'failed', { failureReason: 'replacement_failed' }),
      cancel: async () => 'canceled'
    };

    await assert.rejects(
      collectGoogleNewsRss(
        memory.runs[0],
        config,
        dependencies(memory.persistence, worker)
      ),
      (error: unknown) =>
        error instanceof CollectGoogleNewsRssError &&
        error.category === 'unsuccessful_result'
    );
    assert.equal(starts, 1);
  });

  it('includes Articles from before a zero-result replacement after worker restart', async () => {
    const run = continuedPhaseFourRun({ rssArticlesAddedCount: null });
    const memory = createInMemoryPersistence([run], {
      phaseFourDatabaseResult: {
        firstRssRequestId: 101,
        firstRssArticleId: 201,
        articleCount: 300
      }
    });
    const worker: GoogleNewsRssWorker = {
      start: async () => ({
        jobId: 'replacement-job',
        status: 'queued',
        endpointName: GOOGLE_NEWS_RSS_ENDPOINT_NAME
      }),
      getStatus: async (jobId) =>
        jobId === 'saved-job'
          ? job('saved-job', 'failed', { failureReason: 'worker_restart' })
          : job('replacement-job', 'completed', { articlesAddedCount: 0 }),
      cancel: async () => 'canceled'
    };

    const result = await collectGoogleNewsRss(
      memory.runs[0],
      config,
      dependencies(memory.persistence, worker)
    );

    assert.equal(result.kind, 'ready_for_phase_5');
    assert.equal(result.articleCount, 300);
    assert.equal(result.rssArticlesAddedCount, 0);
  });

  it('preserves a nonzero unsuccessful result when its replacement reports zero', async () => {
    const memory = createInMemoryPersistence([continuedPhaseFourRun()], {
      phaseFourDatabaseResult: {
        firstRssRequestId: 101,
        firstRssArticleId: 201,
        articleCount: 4
      }
    });
    const worker: GoogleNewsRssWorker = {
      start: async () => ({
        jobId: 'replacement-job',
        status: 'queued',
        endpointName: GOOGLE_NEWS_RSS_ENDPOINT_NAME
      }),
      getStatus: async (jobId) =>
        jobId === 'saved-job'
          ? job('saved-job', 'completed', {
              endingReason: 'error',
              articlesAddedCount: 4
            })
          : job('replacement-job', 'completed', { articlesAddedCount: 0 }),
      cancel: async () => 'canceled'
    };

    const result = await collectGoogleNewsRss(
      memory.runs[0],
      config,
      dependencies(memory.persistence, worker)
    );

    assert.equal(result.rssArticlesAddedCount, 4);
    assert.equal(memory.runs[0].rssArticlesAddedCount, 4);
  });

  it('replaces an unavailable saved job but stops if the new job is unavailable', async () => {
    const memory = createInMemoryPersistence([continuedPhaseFourRun()]);
    let starts = 0;
    const worker: GoogleNewsRssWorker = {
      start: async () => {
        starts += 1;
        return {
          jobId: 'replacement-job',
          status: 'queued',
          endpointName: GOOGLE_NEWS_RSS_ENDPOINT_NAME
        };
      },
      getStatus: async () => {
        throw new GoogleNewsRssClientError('unavailable_job', 'missing', { httpStatus: 404 });
      },
      cancel: async () => 'canceled'
    };

    await assert.rejects(
      collectGoogleNewsRss(
        memory.runs[0],
        config,
        dependencies(memory.persistence, worker)
      ),
      (error: unknown) =>
        error instanceof CollectGoogleNewsRssError && error.category === 'unverified_outcome'
    );
    assert.equal(starts, 1);
  });

  it('cancels an earlier timed-out active job before starting one replacement', async () => {
    const oldCreatedAt = '2026-10-04T09:00:00.000Z';
    const run = continuedPhaseFourRun();
    const memory = createInMemoryPersistence([run]);
    let starts = 0;
    let canceled = 0;
    let savedStatusCalls = 0;
    const worker: GoogleNewsRssWorker = {
      start: async () => {
        starts += 1;
        return {
          jobId: 'replacement-job',
          status: 'queued',
          endpointName: GOOGLE_NEWS_RSS_ENDPOINT_NAME
        };
      },
      getStatus: async (jobId) => {
        if (jobId === 'replacement-job') return job(jobId, 'completed');
        savedStatusCalls += 1;
        return savedStatusCalls === 1
          ? job(jobId, 'running', { createdAt: oldCreatedAt })
          : job(jobId, 'canceled', { createdAt: oldCreatedAt });
      },
      cancel: async () => {
        canceled += 1;
        return 'cancel_requested';
      }
    };

    const clock = { value: new Date('2026-10-05T10:00:00.000Z') };
    const result = await collectGoogleNewsRss(
      memory.runs[0],
      config,
      dependencies(memory.persistence, worker, clock)
    );

    assert.equal(result.kind, 'ready_for_phase_5');
    assert.equal(canceled, 1);
    assert.equal(starts, 1);
  });

  it('replaces a terminally late saved job without trusting its result', async () => {
    const memory = createInMemoryPersistence([continuedPhaseFourRun()]);
    let starts = 0;
    const worker: GoogleNewsRssWorker = {
      start: async () => {
        starts += 1;
        return {
          jobId: 'replacement-job',
          status: 'queued',
          endpointName: GOOGLE_NEWS_RSS_ENDPOINT_NAME
        };
      },
      getStatus: async (jobId) =>
        jobId === 'saved-job'
          ? job(jobId, 'completed', {
              endedAt: '2026-10-05T10:00:00.000Z',
              articlesAddedCount: 999
            })
          : job(jobId, 'completed', { articlesAddedCount: 2 }),
      cancel: async () => 'canceled'
    };

    const result = await collectGoogleNewsRss(
      memory.runs[0],
      config,
      dependencies(memory.persistence, worker, {
        value: new Date('2026-10-05T10:01:00.000Z')
      })
    );

    assert.equal(result.kind, 'ready_for_phase_5');
    assert.equal(result.rssArticlesAddedCount, 2);
    assert.equal(starts, 1);
  });

  it('stops after canceling a job started by the current invocation', async () => {
    const memory = createInMemoryPersistence([phaseThreeRun()]);
    let starts = 0;
    let statusCalls = 0;
    const clock = { value: new Date(startedAt) };
    const worker: GoogleNewsRssWorker = {
      start: async () => {
        starts += 1;
        return {
          jobId: 'new-job',
          status: 'queued',
          endpointName: GOOGLE_NEWS_RSS_ENDPOINT_NAME
        };
      },
      getStatus: async () => {
        statusCalls += 1;
        return statusCalls < 3
          ? job('new-job', 'running')
          : job('new-job', 'canceled', { endedAt: clock.value.toISOString() });
      },
      cancel: async () => 'cancel_requested'
    };
    const deps = dependencies(memory.persistence, worker, clock);
    deps.delay = async () => {
      clock.value = new Date(clock.value.getTime() + 25 * 60 * 60 * 1_000);
    };

    await assert.rejects(
      collectGoogleNewsRss(memory.runs[0], config, deps),
      (error: unknown) =>
        error instanceof CollectGoogleNewsRssError && error.category === 'job_timeout'
    );
    assert.equal(starts, 1);
    assert.equal(memory.calls.includes('complete:4'), false);
  });

  it('allows replacement when missing-job cancellation is followed by 404', async () => {
    const memory = createInMemoryPersistence([continuedPhaseFourRun()]);
    let savedStatusCalls = 0;
    let starts = 0;
    const worker: GoogleNewsRssWorker = {
      start: async () => {
        starts += 1;
        return {
          jobId: 'replacement-job',
          status: 'queued',
          endpointName: GOOGLE_NEWS_RSS_ENDPOINT_NAME
        };
      },
      getStatus: async (jobId) => {
        if (jobId === 'replacement-job') return job(jobId, 'completed');
        savedStatusCalls += 1;
        if (savedStatusCalls === 1) {
          return job(jobId, 'running', { createdAt: startedAt.toISOString() });
        }
        throw new GoogleNewsRssClientError('unavailable_job', 'missing', { httpStatus: 404 });
      },
      cancel: async () => 'not_found'
    };

    const result = await collectGoogleNewsRss(
      memory.runs[0],
      config,
      dependencies(memory.persistence, worker, {
        value: new Date('2026-10-05T10:00:00.000Z')
      })
    );

    assert.equal(result.kind, 'ready_for_phase_5');
    assert.equal(starts, 1);
  });

  it('allows replacement when missing-job cancellation finds a late terminal job', async () => {
    const memory = createInMemoryPersistence([continuedPhaseFourRun()]);
    let savedStatusCalls = 0;
    let starts = 0;
    const worker: GoogleNewsRssWorker = {
      start: async () => {
        starts += 1;
        return {
          jobId: 'replacement-job',
          status: 'queued',
          endpointName: GOOGLE_NEWS_RSS_ENDPOINT_NAME
        };
      },
      getStatus: async (jobId) => {
        if (jobId === 'replacement-job') return job(jobId, 'completed');
        savedStatusCalls += 1;
        return savedStatusCalls === 1
          ? job(jobId, 'running')
          : job(jobId, 'completed', {
              endedAt: '2026-10-05T10:00:00.000Z',
              articlesAddedCount: 999
            });
      },
      cancel: async () => 'not_found'
    };

    const result = await collectGoogleNewsRss(
      memory.runs[0],
      config,
      dependencies(memory.persistence, worker, {
        value: new Date('2026-10-05T10:00:00.000Z')
      })
    );

    assert.equal(result.kind, 'ready_for_phase_5');
    assert.equal(starts, 1);
    assert.notEqual(result.rssArticlesAddedCount, 999);
  });

  it('does not replace when missing-job cancellation cannot be verified', async () => {
    const memory = createInMemoryPersistence([continuedPhaseFourRun()]);
    let savedStatusCalls = 0;
    let starts = 0;
    const worker: GoogleNewsRssWorker = {
      start: async () => {
        starts += 1;
        throw new Error('replacement must not start');
      },
      getStatus: async (jobId) => {
        savedStatusCalls += 1;
        if (savedStatusCalls === 1) return job(jobId, 'running');
        throw new GoogleNewsRssClientError('transient_request', 'temporary');
      },
      cancel: async () => 'not_found'
    };

    await assert.rejects(
      collectGoogleNewsRss(
        memory.runs[0],
        config,
        dependencies(memory.persistence, worker, {
          value: new Date('2026-10-05T10:00:00.000Z')
        })
      ),
      (error: unknown) =>
        error instanceof CollectGoogleNewsRssError && error.category === 'unverified_outcome'
    );
    assert.equal(starts, 0);
  });

  it('rejects incomplete persisted boundaries before calling the worker', async () => {
    const run = continuedPhaseFourRun({ articleIdHighWaterMark: null });
    const memory = createInMemoryPersistence([run]);
    let workerCalls = 0;
    const worker: GoogleNewsRssWorker = {
      start: async () => {
        workerCalls += 1;
        throw new Error('not called');
      },
      getStatus: async () => {
        workerCalls += 1;
        throw new Error('not called');
      },
      cancel: async () => {
        workerCalls += 1;
        return 'canceled';
      }
    };

    await assert.rejects(
      collectGoogleNewsRss(
        memory.runs[0],
        config,
        dependencies(memory.persistence, worker)
      ),
      (error: unknown) =>
        error instanceof CollectGoogleNewsRssError && error.category === 'invalid_run_state'
    );
    assert.equal(workerCalls, 0);
  });

  it('never recalculates boundaries for a run already marked as Phase 4 started', async () => {
    const run = continuedPhaseFourRun({
      newsApiRequestIdHighWaterMark: null,
      articleIdHighWaterMark: null
    });
    const memory = createInMemoryPersistence([run]);
    const worker: GoogleNewsRssWorker = {
      start: async () => {
        throw new Error('not called');
      },
      getStatus: async () => {
        throw new Error('not called');
      },
      cancel: async () => 'canceled'
    };

    await assert.rejects(
      collectGoogleNewsRss(
        memory.runs[0],
        config,
        dependencies(memory.persistence, worker)
      ),
      (error: unknown) =>
        error instanceof CollectGoogleNewsRssError && error.category === 'invalid_run_state'
    );
    assert.equal(memory.calls.includes('start:4'), false);
  });
});
