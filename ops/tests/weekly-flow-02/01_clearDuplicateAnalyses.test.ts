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
import {
  DeleteOldArticlesError,
  type DeleteOldArticlesResult
} from '../../src/weekly-flow-02/phases/03_deleteOldArticlesCommand';
import type { GoogleNewsRssWorker } from '../../src/weekly-flow-02/phases/04_collectGoogleNewsRss';
import {
  GOOGLE_NEWS_RSS_ENDPOINT_NAME,
  GoogleNewsRssClientError
} from '../../src/weekly-flow-02/phases/04_googleNewsRssClient';
import { createInMemoryPersistence, createRunRecord } from './persistenceTestSupport';

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
  workerNodeBaseUrl: 'http://worker-node.test:3002/',
  workerNodeRequestTimeoutSeconds: 60,
  rssStatusPollIntervalSeconds: 300,
  rssToleratedConsecutiveStatusFailures: 2,
  rssJobTimeoutHours: 24,
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

const successfulDeletion: DeleteOldArticlesResult = {
  daysOldThreshold: 180,
  cutoffDate: '2026-04-05',
  eligibleCount: 12,
  processedCount: 10,
  deletedCount: 9
};

const successfulRssWorker: GoogleNewsRssWorker = {
  start: async () => ({
    jobId: 'rss-job-1',
    status: 'queued',
    endpointName: GOOGLE_NEWS_RSS_ENDPOINT_NAME
  }),
  getStatus: async (jobId, phaseStartedAt) => ({
    jobId,
    endpointName: GOOGLE_NEWS_RSS_ENDPOINT_NAME,
    status: 'completed',
    createdAt: phaseStartedAt.toISOString(),
    endedAt: new Date(phaseStartedAt.getTime() + 60_000).toISOString(),
    result: {
      endingReason: 'queries_exhausted',
      endingMessage: 'All queries processed',
      articlesAddedCount: 1
    }
  }),
  cancel: async () => 'canceled'
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
  it('runs Phases 1 through 4 in order and stops at the Phase 5 boundary', async () => {
    const { logger, entries } = recordingLogger();
    const request: WorkerRequest = async () => jsonResponse(successfulBody(7));
    const calls: string[] = [];
    const memory = createInMemoryPersistence();

    await runCoordinator(logger, coordinatorConfig, {
      persistence: memory.persistence,
      rssWorker: successfulRssWorker,
      request: async (...args) => {
        calls.push('phase-1');
        return request(...args);
      },
      createBackup: async (config) => {
        calls.push('phase-2');
        assert.equal(config.dbManagerBackupTimeoutSeconds, 1800);
        return successfulBackup;
      },
      deleteArticles: async (config) => {
        calls.push('phase-3');
        assert.equal(config.dbManagerDeleteArticlesTimeoutSeconds, 1800);
        return successfulDeletion;
      }
    });

    const completion = entries.find((entry) => entry.message.startsWith('Phase 1 completed'));
    assert.deepEqual(completion, {
      level: 'info',
      message: 'Phase 1 completed: duplicate analyses cleared',
      metadata: {
        runId: 1,
        phase: 1,
        rowsDeleted: 7,
        cancelledJobs: ['deduper-queued'],
        cancellationRequestedJobs: ['deduper-running'],
        workerTimestamp: '2026-10-02T21:00:00Z'
      }
    });
    assert.deepEqual(calls, ['phase-1', 'phase-2', 'phase-3']);
    assert.deepEqual(
      entries.find((entry) => entry.message.startsWith('Phase 2 completed')),
      {
        level: 'info',
        message: 'Phase 2 completed: database backup created and verified',
        metadata: {
          runId: 1,
          phase: 2,
          backupPath: successfulBackup.backupPath,
          byteSize: successfulBackup.byteSize,
          sha256: successfulBackup.sha256,
          reportedManifestVersion: 1
        }
      }
    );
    assert.deepEqual(
      entries.find((entry) => entry.message.startsWith('Phase 3 completed')),
      {
        level: 'info',
        message: 'Phase 3 completed: old unprotected articles deleted',
        metadata: {
          runId: 1,
          phase: 3,
          daysOldThreshold: 180,
          cutoffDate: '2026-04-05',
          eligibleCount: 12,
          processedCount: 10,
          deletedCount: 9
        }
      }
    );
    assert.ok(entries.some((entry) => entry.message.includes('Phase 5 boundary')));
    assert.equal(entries.filter((entry) => entry.level === 'error').length, 0);
    assert.deepEqual(memory.calls, [
      'get-latest',
      'create',
      'start:1',
      'complete:1',
      'start:2',
      'complete:2',
      'start:3',
      'complete:3',
      'start:4',
      'progress:4',
      'progress:4',
      'database-result:4',
      'complete:4'
    ]);
    assert.equal(memory.runs[0].lastPhaseStarted, 4);
    assert.equal(memory.runs[0].lastPhaseCompleted, 4);
    assert.equal(memory.runs[0].runCompleted, false);
    assert.equal(memory.runs[0].backupPath, successfulBackup.backupPath);
    assert.equal(memory.runs[0].backupByteSize, '2048');
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
      const memory = createInMemoryPersistence();

      await assert.rejects(
        runCoordinator(logger, coordinatorConfig, {
          persistence: memory.persistence,
          rssWorker: successfulRssWorker,
          request,
          createBackup: async () => successfulBackup,
          deleteArticles: async () => successfulDeletion
        }),
        (error: unknown) =>
          error instanceof ClearDuplicateAnalysesError && error.category === category
      );

      const failure = entries.find((entry) => entry.level === 'error');
      assert.equal(failure?.metadata?.failureCategory, category);
      assert.ok(!entries.some((entry) => entry.message.startsWith('Phase 1 completed')));
      assert.ok(!entries.some((entry) => entry.message.startsWith('Phase 2 started')));
      assert.ok(!entries.some((entry) => entry.message.startsWith('Phase 3 started')));
      assert.ok(!entries.some((entry) => entry.message.includes('stopped before phase 4')));
      assert.equal(memory.calls.at(-1), 'failure:1');
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
      const memory = createInMemoryPersistence();

      await assert.rejects(
        runCoordinator(logger, coordinatorConfig, {
          persistence: memory.persistence,
          rssWorker: successfulRssWorker,
          request: async () => jsonResponse(successfulBody()),
          createBackup: async () => {
            throw error;
          },
          deleteArticles: async () => successfulDeletion
        }),
        error
      );

      assert.ok(entries.some((entry) => entry.message.startsWith('Phase 1 completed')));
      assert.ok(entries.some((entry) => entry.message.startsWith('Phase 2 started')));
      const failure = entries.find((entry) => entry.message.startsWith('Phase 2 failed'));
      assert.equal(failure?.metadata?.failureCategory, category);
      assert.ok(!entries.some((entry) => entry.message.startsWith('Phase 2 completed')));
      assert.ok(!entries.some((entry) => entry.message.startsWith('Phase 3 started')));
      assert.ok(!entries.some((entry) => entry.message.includes('stopped before phase 4')));
      assert.equal(memory.calls.at(-1), 'failure:2');
    }
  });

  it('logs every Phase 3 failure category and stops later work', async () => {
    const categories: DeleteOldArticlesError['category'][] = [
      'exit',
      'output_contract',
      'spawn',
      'timeout'
    ];

    for (const category of categories) {
      const { logger, entries } = recordingLogger();
      const error = new DeleteOldArticlesError(category, `fixture ${category}`);
      const memory = createInMemoryPersistence();

      await assert.rejects(
        runCoordinator(logger, coordinatorConfig, {
          persistence: memory.persistence,
          rssWorker: successfulRssWorker,
          request: async () => jsonResponse(successfulBody()),
          createBackup: async () => successfulBackup,
          deleteArticles: async () => {
            throw error;
          }
        }),
        error
      );

      assert.ok(entries.some((entry) => entry.message.startsWith('Phase 2 completed')));
      assert.ok(entries.some((entry) => entry.message.startsWith('Phase 3 started')));
      const failure = entries.find((entry) => entry.message.startsWith('Phase 3 failed'));
      assert.equal(failure?.metadata?.failureCategory, category);
      assert.ok(!entries.some((entry) => entry.message.startsWith('Phase 3 completed')));
      assert.ok(!entries.some((entry) => entry.message.includes('stopped before phase 4')));
      assert.equal(memory.calls.at(-1), 'failure:3');
    }
  });

  it('accepts an all-zero Phase 3 result', async () => {
    const { logger, entries } = recordingLogger();
    const memory = createInMemoryPersistence();

    await runCoordinator(logger, coordinatorConfig, {
      persistence: memory.persistence,
      rssWorker: successfulRssWorker,
      request: async () => jsonResponse(successfulBody()),
      createBackup: async () => successfulBackup,
      deleteArticles: async () => ({
        ...successfulDeletion,
        eligibleCount: 0,
        processedCount: 0,
        deletedCount: 0
      })
    });

    const completion = entries.find((entry) => entry.message.startsWith('Phase 3 completed'));
    assert.equal(completion?.metadata?.eligibleCount, 0);
    assert.equal(completion?.metadata?.processedCount, 0);
    assert.equal(completion?.metadata?.deletedCount, 0);
    assert.ok(entries.some((entry) => entry.message.includes('Phase 5 boundary')));
  });

  it('continues a recent run at the Phase 4 boundary without rerunning Phases 1 through 3', async () => {
    const { logger, entries } = recordingLogger();
    const memory = createInMemoryPersistence([
      createRunRecord({
        id: 12,
        runStartedAt: new Date('2026-10-03T11:00:00.000Z'),
        runCompleted: false,
        runCompletedAt: null,
        lastPhaseStarted: 3,
        lastPhaseCompleted: 3,
        phaseData: {
          phase1: { status: 'completed' },
          phase2: { status: 'completed' },
          phase3: { status: 'completed' }
        },
        lastError: null,
        backupPath: '/tmp/previous.zip',
        backupByteSize: '2048',
        backupSha256: 'b'.repeat(64),
        backupManifestVersion: 1,
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
        createdAt: new Date('2026-10-03T11:00:00.000Z'),
        updatedAt: new Date('2026-10-03T11:10:00.000Z')
      })
    ]);
    let phaseCalls = 0;

    await runCoordinator(logger, coordinatorConfig, {
      persistence: memory.persistence,
      rssWorker: successfulRssWorker,
      now: () => new Date('2026-10-03T12:00:00.000Z'),
      request: async () => {
        phaseCalls += 1;
        return jsonResponse(successfulBody());
      },
      createBackup: async () => {
        phaseCalls += 1;
        return successfulBackup;
      },
      deleteArticles: async () => {
        phaseCalls += 1;
        return successfulDeletion;
      }
    });

    assert.equal(phaseCalls, 0);
    assert.deepEqual(memory.calls, [
      'get-latest',
      'start:4',
      'progress:4',
      'progress:4',
      'database-result:4',
      'complete:4'
    ]);
    assert.equal(memory.runs.length, 1);
    assert.ok(entries.some((entry) => entry.message.includes('Phase 5 boundary')));
  });

  it('does not invoke Phase 1 when recording its start fails', async () => {
    const { logger, entries } = recordingLogger();
    const memory = createInMemoryPersistence();
    const originalRecordFailure = memory.persistence.recordFailure;
    let requestCalls = 0;
    memory.persistence.recordPhaseStarted = async () => {
      throw new Error('start write failed');
    };
    memory.persistence.recordFailure = async (...args) => {
      memory.calls.push('failure-after-start-write');
      return originalRecordFailure(...args);
    };

    await assert.rejects(
      runCoordinator(logger, coordinatorConfig, {
        persistence: memory.persistence,
        rssWorker: successfulRssWorker,
        request: async () => {
          requestCalls += 1;
          return jsonResponse(successfulBody());
        }
      }),
      /start write failed/
    );

    assert.equal(requestCalls, 0);
    assert.ok(!entries.some((entry) => entry.message.startsWith('Phase 1 started')));
    assert.ok(memory.calls.includes('failure-after-start-write'));
  });

  it('records a failure and stops when verified Phase 1 output cannot be persisted', async () => {
    const { logger, entries } = recordingLogger();
    const memory = createInMemoryPersistence();
    memory.persistence.recordPhaseCompleted = async () => {
      throw new Error('completion write failed');
    };

    await assert.rejects(
      runCoordinator(logger, coordinatorConfig, {
        persistence: memory.persistence,
        rssWorker: successfulRssWorker,
        request: async () => jsonResponse(successfulBody())
      }),
      /completion write failed/
    );

    assert.equal(memory.calls.at(-1), 'failure:1');
    assert.ok(!entries.some((entry) => entry.message.startsWith('Phase 1 completed')));
    assert.ok(!entries.some((entry) => entry.message.startsWith('Phase 2 started')));
  });

  it('replaces the latest run when it stopped during Phases 1 through 3', async () => {
    const { logger } = recordingLogger();
    const priorRun = createRunRecord({
      id: 7,
      lastPhaseStarted: 2,
      lastPhaseCompleted: 1,
      phaseData: { phase1: { status: 'completed' }, phase2: { status: 'failed' } }
    });
    const memory = createInMemoryPersistence([priorRun]);

    await runCoordinator(logger, coordinatorConfig, {
      persistence: memory.persistence,
      rssWorker: successfulRssWorker,
      request: async () => jsonResponse(successfulBody()),
      createBackup: async () => successfulBackup,
      deleteArticles: async () => successfulDeletion
    });

    assert.equal(memory.runs.length, 2);
    assert.equal(memory.runs[0].id, 7);
    assert.equal(memory.runs[0].lastPhaseCompleted, 1);
    assert.equal(memory.runs[1].id, 8);
    assert.equal(memory.runs[1].lastPhaseCompleted, 4);
  });

  it('continues only the explicit run ID and never searches for a substitute', async () => {
    const { logger } = recordingLogger();
    const selected = createRunRecord({
      id: 4,
      runStartedAt: new Date('2026-09-01T00:00:00.000Z'),
      lastPhaseStarted: 3,
      lastPhaseCompleted: 3
    });
    const latest = createRunRecord({
      id: 5,
      lastPhaseStarted: 2,
      lastPhaseCompleted: 1
    });
    const memory = createInMemoryPersistence([selected, latest]);

    await runCoordinator(logger, coordinatorConfig, {
      persistence: memory.persistence,
      rssWorker: successfulRssWorker,
      invocation: { mode: 'continue', runId: 4 },
      now: () => new Date('2026-10-03T12:00:00.000Z')
    });

    assert.deepEqual(memory.calls, [
      'get:4',
      'start:4',
      'progress:4',
      'progress:4',
      'database-result:4',
      'complete:4'
    ]);
    assert.equal(memory.runs.length, 2);
  });

  it('atomically completes the weekly run when Phase 4 verifies zero work', async () => {
    const { logger, entries } = recordingLogger();
    const memory = createInMemoryPersistence([], {
      phaseFourDatabaseResult: {
        firstRssRequestId: null,
        firstRssArticleId: null,
        articleCount: 0
      }
    });
    const zeroWorker: GoogleNewsRssWorker = {
      ...successfulRssWorker,
      getStatus: async (jobId, phaseStartedAt) => ({
        jobId,
        endpointName: GOOGLE_NEWS_RSS_ENDPOINT_NAME,
        status: 'completed',
        createdAt: phaseStartedAt.toISOString(),
        endedAt: new Date(phaseStartedAt.getTime() + 60_000).toISOString(),
        result: {
          endingReason: 'queries_exhausted',
          endingMessage: 'All queries processed',
          articlesAddedCount: 0
        }
      })
    };

    await runCoordinator(logger, coordinatorConfig, {
      persistence: memory.persistence,
      rssWorker: zeroWorker,
      request: async () => jsonResponse(successfulBody()),
      createBackup: async () => successfulBackup,
      deleteArticles: async () => successfulDeletion
    });

    assert.equal(memory.runs[0].runCompleted, true);
    assert.equal(memory.runs[0].articleCount, 0);
    assert.equal(memory.calls.at(-1), 'complete-zero:4');
    assert.ok(entries.some((entry) => entry.message.includes('weekly run completed')));
  });

  it('records a Phase 4 failure without claiming healthy zero work', async () => {
    const { logger, entries } = recordingLogger();
    const memory = createInMemoryPersistence([
      createRunRecord({
        id: 14,
        runStartedAt: new Date('2026-10-03T11:00:00.000Z'),
        lastPhaseStarted: 3,
        lastPhaseCompleted: 3,
        phaseData: { phase3: { status: 'completed' } }
      })
    ]);
    const failure = new GoogleNewsRssClientError(
      'transient_request',
      'RSS start outcome unverified'
    );
    const failingWorker: GoogleNewsRssWorker = {
      ...successfulRssWorker,
      start: async () => {
        throw failure;
      }
    };

    await assert.rejects(
      runCoordinator(logger, coordinatorConfig, {
        persistence: memory.persistence,
        rssWorker: failingWorker,
        now: () => new Date('2026-10-03T12:00:00.000Z')
      }),
      failure
    );

    assert.equal(memory.calls.at(-1), 'failure:4');
    assert.equal(memory.runs[0].runCompleted, false);
    assert.equal(memory.runs[0].lastPhaseCompleted, 3);
    const loggedFailure = entries.find((entry) => entry.message.startsWith('Phase 4 stopped'));
    assert.equal(loggedFailure?.metadata?.failureCategory, 'transient_request');
  });

  it('records a Phase 4 persistence failure and does not advance', async () => {
    const { logger } = recordingLogger();
    const memory = createInMemoryPersistence([
      createRunRecord({
        id: 16,
        runStartedAt: new Date('2026-10-03T11:00:00.000Z'),
        lastPhaseStarted: 3,
        lastPhaseCompleted: 3,
        phaseData: { phase3: { status: 'completed' } }
      })
    ]);
    memory.persistence.recordPhaseFourCompleted = async () => {
      throw new Error('Phase 4 completion write failed');
    };

    await assert.rejects(
      runCoordinator(logger, coordinatorConfig, {
        persistence: memory.persistence,
        rssWorker: successfulRssWorker,
        now: () => new Date('2026-10-03T12:00:00.000Z')
      }),
      /Phase 4 completion write failed/
    );

    assert.equal(memory.calls.at(-1), 'failure:4');
    assert.equal(memory.runs[0].lastPhaseCompleted, 3);
    assert.equal(memory.runs[0].runCompleted, false);
  });

  it('continues within 72 hours and replaces an older timed-out Phase 4 job', async () => {
    const { logger } = recordingLogger();
    const phaseStartedAt = new Date('2026-10-03T13:00:00.000Z');
    const memory = createInMemoryPersistence([
      createRunRecord({
        id: 15,
        runStartedAt: new Date('2026-10-03T12:00:00.000Z'),
        lastPhaseStarted: 4,
        lastPhaseCompleted: 3,
        newsApiRequestIdHighWaterMark: 100,
        articleIdHighWaterMark: 200,
        rssJobId: 'saved-job',
        phaseData: {
          phase4: { status: 'started', startedAt: phaseStartedAt.toISOString() }
        }
      })
    ]);
    let starts = 0;
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
        if (jobId === 'replacement-job') {
          return {
            jobId,
            endpointName: GOOGLE_NEWS_RSS_ENDPOINT_NAME,
            status: 'completed',
            createdAt: '2026-10-05T10:00:00.000Z',
            endedAt: '2026-10-05T10:01:00.000Z',
            result: {
              endingReason: 'queries_exhausted',
              endingMessage: 'All queries processed',
              articlesAddedCount: 1
            }
          };
        }
        savedStatusCalls += 1;
        return savedStatusCalls === 1
          ? {
              jobId,
              endpointName: GOOGLE_NEWS_RSS_ENDPOINT_NAME,
              status: 'running',
              createdAt: phaseStartedAt.toISOString(),
              startedAt: phaseStartedAt.toISOString()
            }
          : {
              jobId,
              endpointName: GOOGLE_NEWS_RSS_ENDPOINT_NAME,
              status: 'canceled',
              createdAt: phaseStartedAt.toISOString(),
              endedAt: '2026-10-05T10:00:00.000Z'
            };
      },
      cancel: async () => 'cancel_requested'
    };

    await runCoordinator(logger, coordinatorConfig, {
      persistence: memory.persistence,
      rssWorker: worker,
      now: () => new Date('2026-10-05T10:00:00.000Z'),
      delay: async () => undefined
    });

    assert.equal(starts, 1);
    assert.equal(memory.runs[0].rssJobId, 'replacement-job');
    assert.equal(memory.runs[0].lastPhaseCompleted, 4);
    assert.equal(memory.calls.some((call) => call.startsWith('start:1')), false);
  });

  it('rejects an ineligible explicit run without writing or starting a phase', async () => {
    const { logger } = recordingLogger();
    const memory = createInMemoryPersistence([
      createRunRecord({ id: 9, lastPhaseStarted: 2, lastPhaseCompleted: 1 })
    ]);

    await assert.rejects(
      runCoordinator(logger, coordinatorConfig, {
        persistence: memory.persistence,
        rssWorker: successfulRssWorker,
        invocation: { mode: 'continue', runId: 9 }
      }),
      /must be replaced by a new run/
    );

    assert.deepEqual(memory.calls, ['get:9']);
  });
});
