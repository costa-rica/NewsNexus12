import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { OpsConfig } from '../../src/config';
import type { CoordinatorLogger } from '../../src/weekly-flow-02/coordinator';
import { executeWeeklyFlow02 } from '../../src/weekly-flow-02/entrypoint';
import { WeeklyFlowPersistenceError } from '../../src/weekly-flow-02/persistence';
import { createInMemoryPersistence } from './persistenceTestSupport';

const config: OpsConfig = {
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

const logger: CoordinatorLogger = {
  info: () => undefined,
  error: () => undefined
};

describe('executeWeeklyFlow02', () => {
  it('does not load persistence when configuration fails', async () => {
    let persistenceLoaded = false;

    await assert.rejects(
      executeWeeklyFlow02([], {
        loadConfiguration: () => {
          throw new Error('configuration failed');
        },
        loadPersistence: async () => {
          persistenceLoaded = true;
          throw new Error('must not run');
        }
      }),
      /configuration failed/
    );

    assert.equal(persistenceLoaded, false);
  });

  it('does not load persistence or start the coordinator for invalid arguments', async () => {
    let persistenceLoaded = false;
    let coordinatorStarted = false;

    await assert.rejects(
      executeWeeklyFlow02(['--unknown-option'], {
        loadConfiguration: () => config,
        initializeLog: () => logger,
        loadPersistence: async () => {
          persistenceLoaded = true;
          throw new Error('must not run');
        },
        run: async () => {
          coordinatorStarted = true;
        },
        finishLog: async () => undefined
      }),
      /Usage: weekly-flow-02:start/
    );

    assert.equal(persistenceLoaded, false);
    assert.equal(coordinatorStarted, false);
  });

  it('loads persistence after configuration and closes it after the coordinator', async () => {
    const calls: string[] = [];
    const memory = createInMemoryPersistence();

    await executeWeeklyFlow02(['--new-run'], {
      loadConfiguration: () => {
        calls.push('config');
        return config;
      },
      initializeLog: () => {
        calls.push('logger');
        return logger;
      },
      parseInvocation: (args) => {
        calls.push(`arguments:${args.join(',')}`);
        return { mode: 'new' };
      },
      loadPersistence: async () => {
        calls.push('persistence');
        return {
          persistence: memory.persistence,
          close: async () => {
            calls.push('close');
          }
        };
      },
      run: async (_logger, _config, dependencies) => {
        calls.push(`run:${dependencies.invocation.mode}`);
      },
      finishLog: async () => {
        calls.push('finish-log');
      }
    });

    assert.deepEqual(calls, [
      'config',
      'logger',
      'arguments:--new-run',
      'persistence',
      'run:new',
      'close',
      'finish-log'
    ]);
  });

  it('logs database diagnostics when persistence initialization fails', async () => {
    const entries: Array<{ message: string; metadata?: Record<string, unknown> }> = [];
    const recordingLogger: CoordinatorLogger = {
      info: () => undefined,
      error: (message, metadata) => entries.push({ message, metadata })
    };
    const databaseError = Object.assign(new Error('connection refused'), {
      code: 'ECONNREFUSED',
      address: '127.0.0.1',
      port: 5432
    });
    const persistenceError = new WeeklyFlowPersistenceError(
      'Weekly flow persistence initialization failed',
      { cause: databaseError }
    );

    await assert.rejects(
      executeWeeklyFlow02([], {
        loadConfiguration: () => config,
        initializeLog: () => recordingLogger,
        loadPersistence: async () => {
          throw persistenceError;
        },
        finishLog: async () => undefined
      }),
      persistenceError
    );

    assert.equal(entries[0]?.message, 'Weekly pipeline persistence initialization failed');
    assert.deepEqual(entries[0]?.metadata?.databaseError, {
      name: 'Error',
      message: 'connection refused',
      stack: databaseError.stack,
      code: 'ECONNREFUSED',
      address: '127.0.0.1',
      port: 5432
    });
  });
});
