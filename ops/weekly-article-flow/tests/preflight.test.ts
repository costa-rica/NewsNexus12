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
  alertHelperService: 'alert.service',
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
    runSeconds: 259200
  },
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
  const priorDatabase = process.env.PG_DATABASE;
  const priorUser = process.env.PG_USER;

  beforeEach(() => {
    process.env.PG_DATABASE = 'newsnexus_dev';
    process.env.PG_USER = 'nick';
  });

  afterAll(() => {
    if (priorDatabase === undefined) delete process.env.PG_DATABASE;
    else process.env.PG_DATABASE = priorDatabase;
    if (priorUser === undefined) delete process.env.PG_USER;
    else process.env.PG_USER = priorUser;
  });

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

  it('requires exact confirmation before destructive development', async () => {
    await expect(runPreflight(config(), {
      mode: 'dev_destructive_recovery',
      expectedDevDatabase: 'wrong_database',
      allowLiveAi: true
    }, dependencies())).rejects.toThrow('exact database confirmation');
  });

  it('requires explicit live-AI permission before starting work', async () => {
    await expect(runPreflight(config(), {
      mode: 'dev_canary',
      allowLiveAi: false
    }, dependencies())).rejects.toThrow('live-AI permission');
  });

  it('rejects production identity crossover and busy workers', async () => {
    await expect(runPreflight(config(), {
      mode: 'manual_production',
      allowLiveAi: true
    }, dependencies())).rejects.toThrow('host is not allowlisted');

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
});
