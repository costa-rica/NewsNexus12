import { parseWeeklyFlowCli, parseWeeklyFlowConfig } from '../src/config';

const validEnv = (): NodeJS.ProcessEnv => ({
  WEEKLY_FLOW_REPOSITORY_PATH: '/srv/newsnexus12',
  WEEKLY_FLOW_RESOURCES_PATH: '/srv/resources',
  WEEKLY_FLOW_DEV_HOSTS: 'dev-one,dev-two',
  WEEKLY_FLOW_PRODUCTION_HOSTS: 'prod-one',
  WEEKLY_FLOW_DEV_DATABASES: 'newsnexus_dev',
  WEEKLY_FLOW_PRODUCTION_DATABASES: 'newsnexus',
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

describe('weekly flow configuration', () => {
  it('parses the fixed environment contract', () => {
    const config = parseWeeklyFlowConfig(validEnv());
    expect(config.workerNodeUrl.origin).toBe('http://127.0.0.1:3002');
    expect(config.timeouts.semanticSeconds).toBe(14_400);
    expect(config.polling).toEqual({ initialMs: 1000, maxMs: 30000 });
  });

  it.each([
    ['relative path', { WEEKLY_FLOW_REPOSITORY_PATH: 'relative/path' }],
    ['credentialed URL', { WEEKLY_FLOW_WORKER_NODE_URL: 'http://user:secret@127.0.0.1:3002' }],
    ['URL with path', { WEEKLY_FLOW_WORKER_NODE_URL: 'http://127.0.0.1:3002/api' }],
    ['unsafe timeout', { WEEKLY_FLOW_SEMANTIC_TIMEOUT_SECONDS: '20000' }],
    ['invalid worker preview TTL', { AI_APPROVER_V02_PREVIEW_TTL_MINUTES: '0' }],
    ['unsafe alert name', { WEEKLY_FLOW_ALERT_STAGING_PATH: '/srv/resources/weekly-flow/other.md' }],
    ['overlapping database', { WEEKLY_FLOW_PRODUCTION_DATABASES: 'newsnexus_dev' }]
  ])('rejects %s configuration', (_label, overrides) => {
    expect(() => parseWeeklyFlowConfig({ ...validEnv(), ...overrides })).toThrow();
  });

  it('parses only the approved CLI controls', () => {
    expect(parseWeeklyFlowCli([
      '--mode', 'dev_destructive_recovery',
      '--resume-run-id', '42',
      '--confirm-dev-database', 'newsnexus_dev',
      '--canary-target', '10',
      '--allow-live-ai'
    ])).toEqual({
      mode: 'dev_destructive_recovery',
      resumeRunId: 42,
      expectedDevDatabase: 'newsnexus_dev',
      canaryTarget: 10,
      allowLiveAi: true
    });
  });

  it('rejects arbitrary overrides and production targets', () => {
    expect(() => parseWeeklyFlowCli(['--mode', 'dev_canary', '--url', 'http://evil.test'])).toThrow('Unknown option');
    expect(() => parseWeeklyFlowCli([
      '--mode', 'manual_production', '--canary-target', '10'
    ])).toThrow('not permitted');
    expect(() => parseWeeklyFlowCli(['--mode', 'unknown'])).toThrow('--mode');
  });
});
