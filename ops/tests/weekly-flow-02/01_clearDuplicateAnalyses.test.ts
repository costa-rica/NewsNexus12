import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { OpsConfig } from '../../src/config';
import {
  runCoordinator,
  type CoordinatorLogger
} from '../../src/weekly-flow-02/coordinator';
import {
  ClearDuplicateAnalysesError,
  parseClearDuplicateAnalysesResponse,
  requestClearDuplicateAnalyses,
  type WorkerRequest
} from '../../src/weekly-flow-02/phases/01_clearDuplicateAnalysesRequest';
import {
  CreateDatabaseBackupError,
  type CreateDatabaseBackupResult
} from '../../src/weekly-flow-02/phases/02_createDatabaseBackupCommand';

interface LogEntry {
  level: 'error' | 'info';
  message: string;
  metadata?: Record<string, unknown>;
}

const coordinatorConfig: OpsConfig = {
  nodeEnv: 'testing',
  nameApp: 'weekly-flow-test',
  workerPythonBaseUrl: 'http://worker.test:5000/',
  workerPythonRequestTimeoutSeconds: 90,
  dbManagerBackupTimeoutSeconds: 1800,
  dbManagerDeleteArticlesTimeoutSeconds: 1800,
  pathToLogs: '/tmp/weekly-flow-test',
  logMaxSizeMb: 5,
  logMaxFiles: 5
};

const recordingLogger = (): { logger: CoordinatorLogger; entries: LogEntry[] } => {
  const entries: LogEntry[] = [];
  return {
    entries,
    logger: {
      info: (message, metadata) => entries.push({ level: 'info', message, metadata }),
      error: (message, metadata) => entries.push({ level: 'error', message, metadata })
    }
  };
};

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

const successfulBackup: CreateDatabaseBackupResult = {
  backupPath: '/tmp/weekly-flow-backup.zip',
  byteSize: 2048,
  sha256: 'a'.repeat(64),
  manifestVersion: 1
};

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

describe('runCoordinator', () => {
  it('runs Phase 1, then Phase 2, then stops before Phase 3', async () => {
    const { logger, entries } = recordingLogger();
    const request: WorkerRequest = async () => jsonResponse(successfulBody(7));
    const calls: string[] = [];

    await runCoordinator(logger, coordinatorConfig, {
      request: async (...args) => {
        calls.push('phase-1');
        return request(...args);
      },
      createBackup: async (config) => {
        calls.push('phase-2');
        assert.equal(config.dbManagerBackupTimeoutSeconds, 1800);
        return successfulBackup;
      }
    });

    const completion = entries.find((entry) => entry.message.startsWith('Phase 1 completed'));
    assert.deepEqual(completion, {
      level: 'info',
      message: 'Phase 1 completed: duplicate analyses cleared',
      metadata: {
        phase: 1,
        rowsDeleted: 7,
        cancelledJobs: ['deduper-queued'],
        cancellationRequestedJobs: ['deduper-running'],
        workerTimestamp: '2026-10-02T21:00:00Z'
      }
    });
    assert.deepEqual(calls, ['phase-1', 'phase-2']);
    assert.deepEqual(
      entries.find((entry) => entry.message.startsWith('Phase 2 completed')),
      {
        level: 'info',
        message: 'Phase 2 completed: database backup created and verified',
        metadata: {
          phase: 2,
          backupPath: successfulBackup.backupPath,
          byteSize: successfulBackup.byteSize,
          sha256: successfulBackup.sha256,
          reportedManifestVersion: 1
        }
      }
    );
    assert.ok(entries.some((entry) => entry.message.includes('stopped before phase 3')));
    assert.equal(entries.filter((entry) => entry.level === 'error').length, 0);
  });

  it('logs each Phase 1 failure category and does not log completion', async () => {
    const cases: Array<[ClearDuplicateAnalysesError['category'], WorkerRequest]> = [
      ['http', async () => jsonResponse({ error: 'worker failed' }, 500)],
      ['invalid_response', async () => jsonResponse({ cleared: false })],
      [
        'connection',
        async () => {
          throw new Error('connection refused');
        }
      ],
      [
        'timeout',
        async () => {
          throw new DOMException('timed out', 'TimeoutError');
        }
      ]
    ];

    for (const [category, request] of cases) {
      const { logger, entries } = recordingLogger();

      await assert.rejects(
        runCoordinator(logger, coordinatorConfig, {
          request,
          createBackup: async () => successfulBackup
        }),
        (error: unknown) =>
          error instanceof ClearDuplicateAnalysesError && error.category === category
      );

      const failure = entries.find((entry) => entry.level === 'error');
      assert.equal(failure?.metadata?.failureCategory, category);
      assert.ok(!entries.some((entry) => entry.message.startsWith('Phase 1 completed')));
      assert.ok(!entries.some((entry) => entry.message.startsWith('Phase 2 started')));
      assert.ok(!entries.some((entry) => entry.message.includes('stopped before phase 3')));
    }
  });

  it('logs every Phase 2 failure category and stops later work', async () => {
    const categories: CreateDatabaseBackupError['category'][] = [
      'artifact_verification',
      'exit',
      'output_contract',
      'spawn',
      'timeout'
    ];

    for (const category of categories) {
      const { logger, entries } = recordingLogger();
      const error = new CreateDatabaseBackupError(category, `fixture ${category}`);

      await assert.rejects(
        runCoordinator(logger, coordinatorConfig, {
          request: async () => jsonResponse(successfulBody()),
          createBackup: async () => {
            throw error;
          }
        }),
        error
      );

      assert.ok(entries.some((entry) => entry.message.startsWith('Phase 1 completed')));
      assert.ok(entries.some((entry) => entry.message.startsWith('Phase 2 started')));
      const failure = entries.find((entry) => entry.message.startsWith('Phase 2 failed'));
      assert.equal(failure?.metadata?.failureCategory, category);
      assert.ok(!entries.some((entry) => entry.message.startsWith('Phase 2 completed')));
      assert.ok(!entries.some((entry) => entry.message.includes('stopped before phase 3')));
    }
  });
});
