import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ClearDuplicateAnalysesError,
  parseClearDuplicateAnalysesResponse,
  requestClearDuplicateAnalyses,
  type WorkerRequest
} from '../../src/weekly-flow-02/phases/01_clearDuplicateAnalysesRequest';

const successfulBody = (rowsDeleted = 3): Record<string, unknown> => ({
  cleared: true,
  rowsDeleted,
  cancelledJobs: ['deduper-queued'],
  cancellationRequestedJobs: ['deduper-running'],
  timestamp: '2026-10-02T21:00:00Z',
  exitCode: 0,
  stdout: 'human-readable output is not used for success',
  stderr: ''
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });

const expectPhaseError = async (
  operation: Promise<unknown>,
  category: ClearDuplicateAnalysesError['category']
): Promise<ClearDuplicateAnalysesError> => {
  try {
    await operation;
  } catch (error: unknown) {
    assert.ok(error instanceof ClearDuplicateAnalysesError);
    assert.equal(error.category, category);
    return error;
  }
  assert.fail(`Expected ${category} failure`);
};

describe('parseClearDuplicateAnalysesResponse', () => {
  it('returns only the typed coordinator result', () => {
    assert.deepEqual(parseClearDuplicateAnalysesResponse(successfulBody()), {
      rowsDeleted: 3,
      cancelledJobs: ['deduper-queued'],
      cancellationRequestedJobs: ['deduper-running'],
      timestamp: '2026-10-02T21:00:00Z'
    });
  });

  it('accepts a successful zero-row clear', () => {
    assert.equal(parseClearDuplicateAnalysesResponse(successfulBody(0)).rowsDeleted, 0);
  });

  it('requires an object with cleared set to true', () => {
    for (const body of [null, [], {}, { ...successfulBody(), cleared: false }]) {
      assert.throws(
        () => parseClearDuplicateAnalysesResponse(body),
        (error: unknown) =>
          error instanceof ClearDuplicateAnalysesError && error.category === 'invalid_response'
      );
    }
  });

  it('requires a non-negative integer rowsDeleted value', () => {
    for (const rowsDeleted of [-1, 1.5, '3', undefined]) {
      assert.throws(
        () => parseClearDuplicateAnalysesResponse({ ...successfulBody(), rowsDeleted }),
        /rowsDeleted must be a non-negative integer/
      );
    }
  });

  it('requires string arrays for both job collections', () => {
    for (const replacement of [undefined, 'job-1', [1], ['job-1', 2]]) {
      assert.throws(
        () =>
          parseClearDuplicateAnalysesResponse({
            ...successfulBody(),
            cancelledJobs: replacement
          }),
        /cancelledJobs must be an array of strings/
      );
      assert.throws(
        () =>
          parseClearDuplicateAnalysesResponse({
            ...successfulBody(),
            cancellationRequestedJobs: replacement
          }),
        /cancellationRequestedJobs must be an array of strings/
      );
    }
  });

  it('requires a non-empty timestamp', () => {
    for (const timestamp of [undefined, 123, '', '   ']) {
      assert.throws(
        () => parseClearDuplicateAnalysesResponse({ ...successfulBody(), timestamp }),
        /timestamp must be a non-empty string/
      );
    }
  });
});

describe('requestClearDuplicateAnalyses', () => {
  it('sends one DELETE request and returns the validated result', async () => {
    let calls = 0;
    const request: WorkerRequest = async (url, init) => {
      calls += 1;
      assert.equal(url.toString(), 'http://worker.test:5000/deduper/clear-db-table');
      assert.equal(init.method, 'DELETE');
      assert.equal(init.body, undefined);
      assert.ok(init.signal instanceof AbortSignal);
      return jsonResponse(successfulBody());
    };

    const result = await requestClearDuplicateAnalyses('http://worker.test:5000', 90, request);

    assert.equal(calls, 1);
    assert.equal(result.rowsDeleted, 3);
  });

  it('builds the same endpoint with or without a trailing slash', async () => {
    const urls: string[] = [];
    const request: WorkerRequest = async (url) => {
      urls.push(url.toString());
      return jsonResponse(successfulBody());
    };

    await requestClearDuplicateAnalyses('http://worker.test:5000', 90, request);
    await requestClearDuplicateAnalyses('http://worker.test:5000/', 90, request);

    assert.deepEqual(urls, [
      'http://worker.test:5000/deduper/clear-db-table',
      'http://worker.test:5000/deduper/clear-db-table'
    ]);
  });

  it('reports worker HTTP failures with concise service details', async () => {
    for (const status of [409, 500, 504]) {
      const request: WorkerRequest = async () =>
        jsonResponse({ cleared: false, error: `worker failure ${status}` }, status);

      const error = await expectPhaseError(
        requestClearDuplicateAnalyses('http://worker.test:5000', 90, request),
        'http'
      );
      assert.equal(error.httpStatus, status);
      assert.match(error.message, new RegExp(`HTTP ${status}: worker failure ${status}`));
    }
  });

  it('limits worker error text included in an HTTP failure', async () => {
    const marker = 'x'.repeat(600);
    const request: WorkerRequest = async () => jsonResponse({ error: marker }, 500);

    const error = await expectPhaseError(
      requestClearDuplicateAnalyses('http://worker.test:5000', 90, request),
      'http'
    );

    assert.ok(error.message.length < marker.length);
    assert.ok(error.message.endsWith('…'));
  });

  it('reports a non-JSON HTTP failure without dumping its body', async () => {
    const request: WorkerRequest = async () => new Response('not-json', { status: 500 });

    const error = await expectPhaseError(
      requestClearDuplicateAnalyses('http://worker.test:5000', 90, request),
      'http'
    );

    assert.equal(error.message, 'Worker clear request returned HTTP 500');
  });

  it('rejects malformed JSON from a successful response', async () => {
    const request: WorkerRequest = async () => new Response('not-json', { status: 200 });

    const error = await expectPhaseError(
      requestClearDuplicateAnalyses('http://worker.test:5000', 90, request),
      'invalid_response'
    );

    assert.ok(error.cause instanceof Error);
  });

  it('preserves connection failures as the error cause', async () => {
    const connectionFailure = new Error('socket unavailable');
    const request: WorkerRequest = async () => {
      throw connectionFailure;
    };

    const error = await expectPhaseError(
      requestClearDuplicateAnalyses('http://worker.test:5000', 90, request),
      'connection'
    );

    assert.equal(error.cause, connectionFailure);
    assert.doesNotMatch(error.message, /worker\.test/);
  });

  it('reports a timeout as an unverified outcome', async () => {
    const timeoutFailure = new DOMException('request timed out', 'TimeoutError');
    const request: WorkerRequest = async () => {
      throw timeoutFailure;
    };

    const error = await expectPhaseError(
      requestClearDuplicateAnalyses('http://worker.test:5000', 90, request),
      'timeout'
    );

    assert.equal(error.cause, timeoutFailure);
    assert.match(error.message, /90 seconds; outcome unverified/);
  });
});
