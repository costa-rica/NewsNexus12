const runCommand = jest.fn();
jest.mock('../src/stages/commandRunner', () => ({ runCommand }));

jest.mock('@newsnexus/db-models', () => ({
  initModels: jest.fn(),
  sequelize: { authenticate: jest.fn() },
  AiApproverPromptVersionV02: { findAll: jest.fn() }
}));

import { WeeklyFlowConfig } from '../src/config';
import { WorkerHttpClient } from '../src/http';
import { runPreflight } from '../src/stages';

const config = (): WeeklyFlowConfig => ({
  repositoryPath: '/repo',
  resourcesPath: '/resources',
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
  polling: { initialMs: 1000, maxMs: 30000 },
  minimumFreeDiskBytes: 1000,
  devRssTarget: 10
});

const workerClient = (idle = true) => ({
  requestJson: jest.fn()
    .mockResolvedValueOnce({ status: 'ok' })
    .mockResolvedValueOnce(null),
  isQueueIdle: jest.fn().mockResolvedValue(idle)
}) as unknown as WorkerHttpClient;

const dependencies = (client = workerClient()) => ({
  workerClient: client,
  env: {
    PG_DATABASE: 'newsnexus_dev',
    PG_USER: 'nick',
    PATH: '/usr/local/bin:/usr/bin'
  },
  hostname: () => 'dev-host',
  username: () => 'nick',
  stat: jest.fn(async (target: string) => ({
    isFile: () => target.endsWith('.xlsx'),
    isDirectory: () => !target.endsWith('.xlsx')
  })) as never,
  access: jest.fn(async () => undefined) as never,
  statfs: jest.fn(async () => ({ bavail: 1000, bsize: 4096 })) as never,
  authenticateDb: jest.fn(async () => undefined),
  loadActivePromptIds: jest.fn(async () => [7]),
  resolveRevision: jest.fn(async () => 'a'.repeat(40))
});

describe('weekly flow preflight', () => {
  it('validates the development identity, workers, resources, disk, prompt, and revision', async () => {
    const client = workerClient();
    const result = await runPreflight(config(), {
      mode: 'dev_canary',
      allowLiveAi: true
    }, dependencies(client));

    expect(result).toMatchObject({
      host: 'dev-host',
      databaseName: 'newsnexus_dev',
      sourceRevision: 'a'.repeat(40),
      activePromptVersionId: 7
    });
    expect(client.isQueueIdle).toHaveBeenNthCalledWith(1, 'node');
    expect(client.isQueueIdle).toHaveBeenNthCalledWith(2, 'python');
  });

  it('accepts a Playwright executable hoisted to the repository root', async () => {
    const setup = dependencies();
    const access = jest.fn(async (target: string) => {
      if (target === '/repo/worker-node/node_modules/.bin/playwright') {
        const error = new Error(`ENOENT: no such file or directory, access '${target}'`) as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }
    });

    await expect(runPreflight(config(), {
      mode: 'dev_canary',
      allowLiveAi: true
    }, {
      ...setup,
      access: access as never
    })).resolves.toEqual(expect.objectContaining({ host: 'dev-host' }));
    expect(access).toHaveBeenCalledWith('/repo/node_modules/.bin/playwright', expect.any(Number));
  });

  it('marks the repository as safe when resolving its revision', async () => {
    const { resolveRevision: _resolveRevision, ...setup } = dependencies();
    runCommand.mockResolvedValue({
      command: 'git',
      args: [],
      exitCode: 0,
      stdout: `${'b'.repeat(40)}\n`,
      stderr: '',
      durationMs: 1
    });

    await expect(runPreflight(config(), {
      mode: 'dev_canary',
      allowLiveAi: true
    }, setup)).resolves.toEqual(expect.objectContaining({ sourceRevision: 'b'.repeat(40) }));
    expect(runCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: 'git',
      args: ['-c', 'safe.directory=/repo', 'rev-parse', 'HEAD'],
      cwd: '/repo'
    }));
  });

  it('allows operator-directed destructive development without database confirmation', async () => {
    await expect(runPreflight(config(), {
      mode: 'dev_destructive_recovery',
      allowLiveAi: true
    }, dependencies())).resolves.toEqual(expect.objectContaining({
      host: 'dev-host',
      databaseName: 'newsnexus_dev'
    }));
  });

  it('requires explicit live-AI permission before starting work', async () => {
    await expect(runPreflight(config(), {
      mode: 'dev_canary',
      allowLiveAi: false
    }, dependencies())).rejects.toThrow('live-AI permission');
  });

  it('rejects production Linux and database identities independently', async () => {
    await expect(runPreflight(config(), {
      mode: 'manual_production',
      allowLiveAi: true
    }, dependencies())).rejects.toThrow('must run as the limited_user account');

    await expect(runPreflight(config(), {
      mode: 'manual_production',
      allowLiveAi: true
    }, {
      ...dependencies(),
      username: () => 'limited_user'
    })).rejects.toThrow('must connect as the newsnexus_app database role');
  });

  it('accepts the production identities before applying retained worker checks', async () => {
    await expect(runPreflight(config(), {
      mode: 'manual_production',
      allowLiveAi: true
    }, {
      ...dependencies(workerClient(false)),
      env: {
        PG_DATABASE: 'newsnexus_prod',
        PG_USER: 'newsnexus_app',
        PATH: '/usr/local/bin:/usr/bin'
      },
      username: () => 'limited_user'
    })).rejects.toThrow('queue is not idle');
  });

  it('rejects busy development workers', async () => {
    await expect(runPreflight(config(), {
      mode: 'dev_canary',
      allowLiveAi: true
    }, dependencies(workerClient(false)))).rejects.toThrow('queue is not idle');
  });

  it('rejects an active V02 execution', async () => {
    const client = {
      requestJson: jest.fn()
        .mockResolvedValueOnce({ status: 'ok' })
        .mockResolvedValueOnce({ status: 'running' }),
      isQueueIdle: jest.fn().mockResolvedValue(true)
    } as unknown as WorkerHttpClient;
    await expect(runPreflight(config(), {
      mode: 'dev_canary',
      allowLiveAi: true
    }, dependencies(client))).rejects.toThrow('already active');
  });

  it('defers busy-queue ownership checks to authoritative resume reconciliation', async () => {
    const client = workerClient(false);
    await expect(runPreflight(config(), {
      mode: 'dev_canary',
      resumeRunId: 42,
      allowLiveAi: true
    }, dependencies(client))).resolves.toEqual(expect.objectContaining({ host: 'dev-host' }));
    expect(client.isQueueIdle).not.toHaveBeenCalled();
    expect(client.requestJson).toHaveBeenCalledTimes(1);
  });
});
