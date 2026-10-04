import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GOOGLE_NEWS_RSS_ENDPOINT_NAME,
  GoogleNewsRssClientError,
  assessGoogleNewsRssJob,
  cancelGoogleNewsRssJob,
  confirmGoogleNewsRssCancellation,
  getGoogleNewsRssJobStatus,
  monitorGoogleNewsRssJob,
  parseGoogleNewsRssStartResponse,
  parseGoogleNewsRssStatusResponse,
  startGoogleNewsRssJob,
  type GoogleNewsRssJob,
  type WorkerNodeRequest
} from '../../src/weekly-flow-02/phases/04_googleNewsRssClient';

const phaseStartedAt = new Date('2026-10-04T08:00:00.000Z');
const createdAt = '2026-10-04T09:00:00.000Z';
const settings = {
  baseUrl: 'http://worker-node.test:3002/',
  requestTimeoutSeconds: 60
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });

const rawJob = (
  status: GoogleNewsRssJob['status'],
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  jobId: 'job-4',
  endpointName: GOOGLE_NEWS_RSS_ENDPOINT_NAME,
  status,
  createdAt,
  ...(status === 'running' ? { startedAt: '2026-10-04T09:05:00.000Z' } : {}),
  ...(['completed', 'failed', 'canceled'].includes(status)
    ? { endedAt: '2026-10-04T10:00:00.000Z' }
    : {}),
  ...(status === 'completed'
    ? {
        result: {
          endingReason: 'queries_exhausted',
          endingMessage: 'All queries processed',
          articlesAddedCount: 12,
          queryResults: [{ id: 1, status: 'failed', note: 'kept in worker logs' }]
        }
      }
    : {}),
  ...overrides
});

const parseJob = (
  status: GoogleNewsRssJob['status'],
  overrides: Record<string, unknown> = {}
): GoogleNewsRssJob =>
  parseGoogleNewsRssStatusResponse(
    { job: rawJob(status, overrides) },
    { expectedJobId: 'job-4', phaseStartedAt }
  );

const clientError = (
  category: GoogleNewsRssClientError['category'],
  httpStatus?: number
): GoogleNewsRssClientError =>
  new GoogleNewsRssClientError(category, category, { httpStatus });

describe('Google News RSS start client', () => {
  it('parses the worker start contract', () => {
    assert.deepEqual(
      parseGoogleNewsRssStartResponse({
        jobId: 'job-4',
        status: 'queued',
        endpointName: GOOGLE_NEWS_RSS_ENDPOINT_NAME
      }),
      {
        jobId: 'job-4',
        status: 'queued',
        endpointName: GOOGLE_NEWS_RSS_ENDPOINT_NAME
      }
    );
  });

  it('rejects malformed or non-RSS start responses', () => {
    for (const body of [
      null,
      {},
      { jobId: '', status: 'queued', endpointName: GOOGLE_NEWS_RSS_ENDPOINT_NAME },
      { jobId: 'job-4', status: 'running', endpointName: GOOGLE_NEWS_RSS_ENDPOINT_NAME },
      { jobId: 'job-4', status: 'queued', endpointName: '/another/start-job' }
    ]) {
      assert.throws(
        () => parseGoogleNewsRssStartResponse(body),
        (error: unknown) =>
          error instanceof GoogleNewsRssClientError && error.category === 'malformed_response'
      );
    }
  });

  it('starts RSS with an empty body and omits targeting and repeat-window fields', async () => {
    const request: WorkerNodeRequest = async (url, init) => {
      assert.equal(url.toString(), 'http://worker-node.test:3002/request-google-rss/start-job');
      assert.equal(init.method, 'POST');
      assert.deepEqual(JSON.parse(String(init.body)), {});
      assert.ok(init.signal instanceof AbortSignal);
      return jsonResponse({
        jobId: 'job-4',
        status: 'queued',
        endpointName: GOOGLE_NEWS_RSS_ENDPOINT_NAME
      }, 202);
    };

    assert.equal((await startGoogleNewsRssJob(settings, request)).jobId, 'job-4');
  });
});

describe('Google News RSS status client', () => {
  it('parses every worker status and requires terminal end timestamps', () => {
    for (const status of ['queued', 'running', 'completed', 'failed', 'canceled'] as const) {
      assert.equal(parseJob(status).status, status);
    }

    for (const status of ['completed', 'failed', 'canceled'] as const) {
      assert.throws(
        () => parseJob(status, { endedAt: undefined }),
        (error: unknown) =>
          error instanceof GoogleNewsRssClientError && error.category === 'malformed_response'
      );
    }
  });

  it('requires the saved RSS identity and a creation time at or after Phase 4 start', () => {
    const cases: Array<{ overrides: Record<string, unknown>; category: string }> = [
      { overrides: { jobId: 'reused-job' }, category: 'unavailable_job' },
      {
        overrides: { endpointName: '/semantic-scorer/start-job' },
        category: 'unavailable_job'
      },
      {
        overrides: { createdAt: '2026-10-04T07:59:59.999Z' },
        category: 'unavailable_job'
      },
      { overrides: { createdAt: 'not-a-date' }, category: 'malformed_response' }
    ];

    for (const testCase of cases) {
      assert.throws(
        () => parseJob('running', testCase.overrides),
        (error: unknown) =>
          error instanceof GoogleNewsRssClientError && error.category === testCase.category
      );
    }
  });

  it('returns compact results without detailed query history', () => {
    const job = parseJob('completed');

    assert.deepEqual(job.result, {
      endingReason: 'queries_exhausted',
      endingMessage: 'All queries processed',
      articlesAddedCount: 12
    });
    assert.equal('queryResults' in (job.result as object), false);
  });

  it('rejects malformed status and result fields', () => {
    for (const overrides of [
      { status: 'unknown' },
      { endedAt: 'not-a-date' },
      { endedAt: '2026-10-04T08:59:59.999Z' },
      { result: undefined },
      { result: { endingReason: 'new_reason', endingMessage: 'x', articlesAddedCount: 1 } },
      {
        result: {
          endingReason: 'queries_exhausted',
          endingMessage: 'x',
          articlesAddedCount: -1
        }
      }
    ]) {
      assert.throws(
        () => parseJob('completed', overrides),
        (error: unknown) =>
          error instanceof GoogleNewsRssClientError && error.category === 'malformed_response'
      );
    }
  });

  it('uses the encoded status endpoint and maps 404 to unavailable', async () => {
    const urls: string[] = [];
    const request: WorkerNodeRequest = async (url) => {
      urls.push(url.toString());
      return new Response(null, { status: 404 });
    };

    await assert.rejects(
      getGoogleNewsRssJobStatus(
        settings,
        { expectedJobId: 'job / 4', phaseStartedAt },
        request
      ),
      (error: unknown) =>
        error instanceof GoogleNewsRssClientError &&
        error.category === 'unavailable_job' &&
        error.httpStatus === 404
    );
    assert.equal(
      urls[0],
      'http://worker-node.test:3002/queue-info/check-status/job%20%2F%204'
    );
  });

  it('distinguishes transient, permanent, and malformed request outcomes', async () => {
    for (const status of [408, 429, 500, 503]) {
      await assert.rejects(
        getGoogleNewsRssJobStatus(
          settings,
          { expectedJobId: 'job-4', phaseStartedAt },
          async () => jsonResponse({ message: 'temporary' }, status)
        ),
        (error: unknown) =>
          error instanceof GoogleNewsRssClientError && error.category === 'transient_request'
      );
    }

    await assert.rejects(
      getGoogleNewsRssJobStatus(
        settings,
        { expectedJobId: 'job-4', phaseStartedAt },
        async () => jsonResponse({ message: 'forbidden' }, 403)
      ),
      (error: unknown) =>
        error instanceof GoogleNewsRssClientError && error.category === 'permanent_request'
    );

    await assert.rejects(
      getGoogleNewsRssJobStatus(
        settings,
        { expectedJobId: 'job-4', phaseStartedAt },
        async () => new Response('not-json', { status: 200 })
      ),
      (error: unknown) =>
        error instanceof GoogleNewsRssClientError && error.category === 'malformed_response'
    );
  });
});

describe('Google News RSS assessment and monitoring', () => {
  const day = 24 * 60 * 60 * 1000;

  it('uses current time for active jobs and worker timestamps for terminal jobs', () => {
    const active = parseJob('running');
    assert.equal(
      assessGoogleNewsRssJob(active, new Date(Date.parse(createdAt) + day), day).kind,
      'active'
    );
    assert.equal(
      assessGoogleNewsRssJob(active, new Date(Date.parse(createdAt) + day + 1), day).kind,
      'timed_out'
    );

    for (const elapsed of [day - 1, day, day + 1]) {
      const terminal = parseJob('completed', {
        endedAt: new Date(Date.parse(createdAt) + elapsed).toISOString()
      });
      assert.equal(
        assessGoogleNewsRssJob(terminal, new Date('2026-11-01T00:00:00Z'), day).kind,
        elapsed <= day ? 'verified_success' : 'timed_out'
      );
    }
  });

  it('accepts only queries_exhausted as completed success', () => {
    for (const endingReason of [
      'queries_exhausted',
      'error',
      'rate_limited',
      'target_articles_collected'
    ] as const) {
      const job = parseJob('completed', {
        result: {
          endingReason,
          endingMessage: endingReason,
          articlesAddedCount: 0,
          queryResults: []
        }
      });
      assert.equal(
        assessGoogleNewsRssJob(job, new Date('2026-10-04T10:01:00Z'), day).kind,
        endingReason === 'queries_exhausted' ? 'verified_success' : 'unsuccessful'
      );
    }

    assert.equal(
      assessGoogleNewsRssJob(parseJob('failed'), new Date('2026-10-04T10:01:00Z'), day)
        .kind,
      'unsuccessful'
    );
    assert.equal(
      assessGoogleNewsRssJob(parseJob('canceled'), new Date('2026-10-04T10:01:00Z'), day)
        .kind,
      'unsuccessful'
    );
  });

  it('polls serially and resets failures after a valid response', async () => {
    const events: Array<GoogleNewsRssJob | Error> = [
      clientError('transient_request'),
      clientError('transient_request'),
      parseJob('running'),
      clientError('transient_request'),
      clientError('transient_request'),
      parseJob('completed')
    ];
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    let delays = 0;

    const assessment = await monitorGoogleNewsRssJob({
      getStatus: async () => {
        activeRequests += 1;
        maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
        const event = events.shift();
        await Promise.resolve();
        activeRequests -= 1;
        if (event instanceof Error) throw event;
        return event as GoogleNewsRssJob;
      },
      pollIntervalMilliseconds: 300_000,
      toleratedConsecutiveFailures: 2,
      jobTimeoutMilliseconds: day,
      now: () => new Date('2026-10-04T10:01:00Z'),
      delay: async (milliseconds) => {
        assert.equal(milliseconds, 300_000);
        assert.equal(activeRequests, 0);
        delays += 1;
      }
    });

    assert.equal(assessment.kind, 'verified_success');
    assert.equal(maximumActiveRequests, 1);
    assert.equal(delays, 5);
  });

  it('stops on the third consecutive transient failure', async () => {
    let calls = 0;
    await assert.rejects(
      monitorGoogleNewsRssJob({
        getStatus: async () => {
          calls += 1;
          throw clientError('transient_request');
        },
        pollIntervalMilliseconds: 300_000,
        toleratedConsecutiveFailures: 2,
        jobTimeoutMilliseconds: day,
        delay: async () => undefined
      }),
      (error: unknown) =>
        error instanceof GoogleNewsRssClientError && error.category === 'unverified_outcome'
    );
    assert.equal(calls, 3);
  });

  it('stops immediately on permanent or malformed status failures', async () => {
    for (const error of [clientError('permanent_request'), clientError('malformed_response')]) {
      let calls = 0;
      await assert.rejects(
        monitorGoogleNewsRssJob({
          getStatus: async () => {
            calls += 1;
            throw error;
          },
          pollIntervalMilliseconds: 300_000,
          toleratedConsecutiveFailures: 2,
          jobTimeoutMilliseconds: day,
          delay: async () => undefined
        }),
        error
      );
      assert.equal(calls, 1);
    }
  });
});

describe('Google News RSS cancellation', () => {
  it('parses queued and active cancellation responses', async () => {
    for (const outcome of ['canceled', 'cancel_requested'] as const) {
      const result = await cancelGoogleNewsRssJob(settings, 'job-4', async (url, init) => {
        assert.equal(url.toString(), 'http://worker-node.test:3002/queue-info/cancel_job/job-4');
        assert.equal(init.method, 'POST');
        return jsonResponse({ jobId: 'job-4', outcome });
      });
      assert.equal(result, outcome);
    }
  });

  it('maps cancellation 404 to not_found and rejects other outcomes', async () => {
    assert.equal(
      await cancelGoogleNewsRssJob(settings, 'job-4', async () =>
        jsonResponse({ message: 'Job not found' }, 404)
      ),
      'not_found'
    );
    await assert.rejects(
      cancelGoogleNewsRssJob(settings, 'job-4', async () =>
        jsonResponse({ jobId: 'job-4', outcome: 'not_found' })
      ),
      (error: unknown) =>
        error instanceof GoogleNewsRssClientError && error.category === 'malformed_response'
    );
  });

  it('confirms immediate queued cancellation without a status request', async () => {
    let statusCalls = 0;
    const result = await confirmGoogleNewsRssCancellation({
      cancel: async () => 'canceled',
      getStatus: async () => {
        statusCalls += 1;
        return parseJob('canceled');
      },
      pollIntervalMilliseconds: 300_000
    });

    assert.deepEqual(result, { kind: 'confirmed_inactive', via: 'canceled' });
    assert.equal(statusCalls, 0);
  });

  it('waits once and confirms an active cancellation with terminal status', async () => {
    let delays = 0;
    const result = await confirmGoogleNewsRssCancellation({
      cancel: async () => 'cancel_requested',
      getStatus: async () => parseJob('canceled'),
      pollIntervalMilliseconds: 300_000,
      delay: async (milliseconds) => {
        assert.equal(milliseconds, 300_000);
        delays += 1;
      }
    });

    assert.equal(result.kind, 'confirmed_inactive');
    assert.equal(result.via, 'terminal_status');
    assert.equal(delays, 1);
  });

  it('handles all three missing-job follow-up outcomes', async () => {
    const unavailable = await confirmGoogleNewsRssCancellation({
      cancel: async () => 'not_found',
      getStatus: async () => {
        throw clientError('unavailable_job', 404);
      },
      pollIntervalMilliseconds: 300_000
    });
    assert.deepEqual(unavailable, { kind: 'unavailable', via: 'status_404' });

    const terminal = await confirmGoogleNewsRssCancellation({
      cancel: async () => 'not_found',
      getStatus: async () => parseJob('completed'),
      pollIntervalMilliseconds: 300_000
    });
    assert.equal(terminal.kind, 'confirmed_inactive');
    assert.equal(terminal.via, 'terminal_status');

    await assert.rejects(
      confirmGoogleNewsRssCancellation({
        cancel: async () => 'not_found',
        getStatus: async () => {
          throw clientError('transient_request');
        },
        pollIntervalMilliseconds: 300_000
      }),
      (error: unknown) =>
        error instanceof GoogleNewsRssClientError && error.category === 'unverified_outcome'
    );
  });

  it('rejects cancellation failures and an active follow-up status', async () => {
    await assert.rejects(
      confirmGoogleNewsRssCancellation({
        cancel: async () => {
          throw clientError('transient_request');
        },
        getStatus: async () => parseJob('canceled'),
        pollIntervalMilliseconds: 300_000
      }),
      (error: unknown) =>
        error instanceof GoogleNewsRssClientError && error.category === 'cancellation_failure'
    );

    await assert.rejects(
      confirmGoogleNewsRssCancellation({
        cancel: async () => 'cancel_requested',
        getStatus: async () => parseJob('running'),
        pollIntervalMilliseconds: 300_000,
        delay: async () => undefined
      }),
      (error: unknown) =>
        error instanceof GoogleNewsRssClientError && error.category === 'unverified_outcome'
    );
  });
});
