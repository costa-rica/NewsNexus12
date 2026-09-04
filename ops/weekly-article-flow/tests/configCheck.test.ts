import fs from 'node:fs';
import path from 'node:path';
import { parseWeeklyFlowConfig } from '../src/config';
import {
  ConfigCheckDatabase,
  ConfigCheckDependencies,
  runConfigCheck
} from '../src/configCheck';
import { runPreflight } from '../src/stages';
import { WorkerHttpClient } from '../src/http';

const validEnv = (): NodeJS.ProcessEnv => ({
  PG_HOST: 'localhost',
  PG_PORT: '5432',
  PG_DATABASE: 'newsnexus_prod',
  PG_USER: 'newsnexus_app',
  PG_PASSWORD: '',
  WEEKLY_FLOW_REPOSITORY_PATH: '/srv/newsnexus12',
  WEEKLY_FLOW_RESOURCES_PATH: '/srv/resources',
  WEEKLY_FLOW_WORKER_NODE_URL: 'http://127.0.0.1:3002',
  WEEKLY_FLOW_WORKER_PYTHON_URL: 'http://127.0.0.1:5000',
  WEEKLY_FLOW_LOCK_PATH: '/var/lock/newsnexus12.lock',
  WEEKLY_FLOW_BACKUP_DIRECTORY: '/srv/resources/backups',
  WEEKLY_FLOW_JOURNAL_DIRECTORY: '/srv/resources/weekly-flow',
  WEEKLY_FLOW_ALERT_STAGING_PATH: '/srv/resources/weekly-flow/ALERT-newsnexus12-weekly-cron.md',
  WEEKLY_FLOW_ALERT_HELPER_SERVICE: 'newsnexus12-publish-weekly-alert.service',
  WEEKLY_FLOW_RSS_SPREADSHEET_PATH: '/srv/resources/queries.xlsx',
  WEEKLY_FLOW_SEMANTIC_DIRECTORY: '/srv/resources/semantic',
  WEEKLY_FLOW_STATE_FILES_PATH: '/srv/resources/state',
  WEEKLY_FLOW_PREFLIGHT_TIMEOUT_SECONDS: '900',
  WEEKLY_FLOW_DUPLICATE_CLEANUP_TIMEOUT_SECONDS: '3600',
  WEEKLY_FLOW_BACKUP_TIMEOUT_SECONDS: '7200',
  WEEKLY_FLOW_DELETE_TIMEOUT_SECONDS: '1800',
  WEEKLY_FLOW_RSS_TIMEOUT_SECONDS: '86400',
  WEEKLY_FLOW_SEMANTIC_TIMEOUT_SECONDS: '14400',
  WEEKLY_FLOW_STATE_TIMEOUT_SECONDS: '64800',
  WEEKLY_FLOW_AI_APPROVER_V02_TIMEOUT_SECONDS: '43200',
  WEEKLY_FLOW_REPORTING_TIMEOUT_SECONDS: '600',
  WEEKLY_FLOW_RUN_TIMEOUT_SECONDS: '259200',
  AI_APPROVER_V02_PREVIEW_TTL_MINUTES: '15',
  WEEKLY_FLOW_POLL_INITIAL_MS: '1000',
  WEEKLY_FLOW_POLL_MAX_MS: '30000',
  WEEKLY_FLOW_MIN_FREE_DISK_BYTES: '1000000',
  WEEKLY_FLOW_DEV_RSS_TARGET: '25'
});

const database = (): jest.Mocked<ConfigCheckDatabase> => ({
  authenticate: jest.fn(async () => undefined),
  close: jest.fn(async () => undefined)
});

const dependencies = (
  env = validEnv(),
  connection = database()
): ConfigCheckDependencies & { connection: jest.Mocked<ConfigCheckDatabase> } => ({
  env,
  hostname: () => 'nws-nn12prod',
  username: () => 'limited_user',
  loadDatabase: jest.fn(async () => connection),
  writeLine: jest.fn(),
  connection
});

describe('weekly flow configuration check', () => {
  it.each([
    'dev_canary',
    'dev_destructive_recovery',
    'manual_production',
    'scheduled_production'
  ] as const)('authenticates read-only configuration for %s', async (mode) => {
    const setup = dependencies();

    await runConfigCheck(['--mode', mode], setup);

    expect(setup.connection.authenticate).toHaveBeenCalledTimes(1);
    expect(setup.connection.close).toHaveBeenCalledTimes(1);
    expect(setup.writeLine).toHaveBeenCalledWith(JSON.stringify({
      mode,
      host: 'nws-nn12prod',
      databaseName: 'newsnexus_prod',
      databaseUser: 'newsnexus_app'
    }));
  });

  it('accepts only a single existing mode argument', async () => {
    await expect(runConfigCheck([], dependencies())).rejects.toThrow('usage: run-config-check');
    await expect(runConfigCheck([
      '--mode', 'manual_production', '--resume-run-id', '42'
    ], dependencies())).rejects.toThrow('usage: run-config-check');
    await expect(runConfigCheck(['--mode', 'config_check'], dependencies()))
      .rejects.toThrow('--mode must be one of');
  });

  it('fails configuration before loading the database', async () => {
    const env = validEnv();
    delete env.WEEKLY_FLOW_REPOSITORY_PATH;
    const setup = dependencies(env);

    await expect(runConfigCheck(['--mode', 'manual_production'], setup))
      .rejects.toThrow('WEEKLY_FLOW_REPOSITORY_PATH is required');
    expect(setup.loadDatabase).not.toHaveBeenCalled();
    expect(setup.connection.authenticate).not.toHaveBeenCalled();
  });

  it('closes the database and redacts the underlying authentication error', async () => {
    const setup = dependencies();
    setup.connection.authenticate.mockRejectedValue(new Error('secret connection details'));

    await expect(runConfigCheck(['--mode', 'manual_production'], setup))
      .rejects.toThrow('PostgreSQL connection check failed');
    expect(setup.connection.close).toHaveBeenCalledTimes(1);
  });

  it('reports database loading failure without exposing its cause', async () => {
    const setup = dependencies();
    (setup.loadDatabase as jest.Mock).mockRejectedValue(new Error('secret configuration details'));

    await expect(runConfigCheck(['--mode', 'manual_production'], setup))
      .rejects.toThrow('PostgreSQL configuration could not be loaded');
    expect(setup.connection.authenticate).not.toHaveBeenCalled();
  });

  it.each([
    {
      username: 'wrong_user',
      databaseUser: 'newsnexus_app',
      message: 'production weekly flow must run as the limited_user account'
    },
    {
      username: 'limited_user',
      databaseUser: 'wrong_role',
      message: 'production weekly flow must connect as the newsnexus_app database role'
    }
  ])('uses the same production identity error as normal preflight: $message', async ({
    username,
    databaseUser,
    message
  }) => {
    const env = { ...validEnv(), PG_USER: databaseUser };
    const setup = dependencies(env);
    setup.username = () => username;
    const config = parseWeeklyFlowConfig(env);

    await expect(runConfigCheck(['--mode', 'manual_production'], setup))
      .rejects.toThrow(message);
    await expect(runPreflight(config, {
      mode: 'manual_production',
      allowLiveAi: true
    }, {
      env,
      hostname: () => 'nws-nn12prod',
      username: () => username,
      workerClient: {} as WorkerHttpClient
    })).rejects.toThrow(message);
  });

  it('closes the database when success reporting fails', async () => {
    const setup = dependencies();
    setup.writeLine = jest.fn(() => { throw new Error('reporting failed'); });

    await expect(runConfigCheck(['--mode', 'manual_production'], setup))
      .rejects.toThrow('reporting failed');
    expect(setup.connection.close).toHaveBeenCalledTimes(1);
  });

  it('has no coordinator, worker, stage, schema, or lock dependencies', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/configCheck.ts'), 'utf8');
    expect(source).not.toMatch(/from ['"].*coordinator|from ['"].*database|from ['"].*http/);
    expect(source).not.toMatch(/from ['"].*stages|initModels|sequelize\.sync|flock|allow-live-ai/);
  });
});
