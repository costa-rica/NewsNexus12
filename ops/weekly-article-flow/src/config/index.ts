import path from 'node:path';
import { WeeklyArticleFlowMode } from '@newsnexus/db-models';

export interface WeeklyFlowCliOptions {
  mode: WeeklyArticleFlowMode;
  resumeRunId?: number;
  expectedDevDatabase?: string;
  canaryTarget?: number;
  allowLiveAi: boolean;
}

export interface WeeklyFlowConfig {
  repositoryPath: string;
  resourcesPath: string;
  devHosts: string[];
  productionHosts: string[];
  devDatabases: string[];
  productionDatabases: string[];
  workerNodeUrl: URL;
  workerPythonUrl: URL;
  lockPath: string;
  backupDirectory: string;
  journalDirectory: string;
  alertStagingPath: string;
  alertHelperService: string;
  timeouts: {
    preflightSeconds: number;
    duplicateCleanupSeconds: number;
    backupSeconds: number;
    deleteSeconds: number;
    rssSeconds: number;
    semanticSeconds: number;
    stateSeconds: number;
    aiApproverV02Seconds: number;
    runSeconds: number;
  };
  polling: { initialMs: number; maxMs: number };
  minimumFreeDiskBytes: number;
  devRssTarget: number;
}

const modes: WeeklyArticleFlowMode[] = [
  'dev_canary',
  'dev_destructive_recovery',
  'manual_production',
  'scheduled_production'
];

const required = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const absolutePath = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = required(env, name);
  if (!path.isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path`);
  }
  return path.normalize(value);
};

const list = (env: NodeJS.ProcessEnv, name: string): string[] => {
  const values = required(env, name).split(',').map((value) => value.trim()).filter(Boolean);
  if (values.length === 0) {
    throw new Error(`${name} must contain at least one value`);
  }
  return [...new Set(values)];
};

const integer = (
  env: NodeJS.ProcessEnv,
  name: string,
  minimum: number,
  maximum: number
): number => {
  const raw = required(env, name);
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be an integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
};

const baseUrl = (env: NodeJS.ProcessEnv, name: string): URL => {
  const url = new URL(required(env, name));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${name} must be an HTTP(S) URL without embedded credentials`);
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${name} must be an origin without a path, query, or fragment`);
  }
  return url;
};

const rejectOverlap = (left: string[], right: string[], label: string): void => {
  const overlap = left.filter((value) => right.includes(value));
  if (overlap.length > 0) {
    throw new Error(`development and production ${label} must not overlap: ${overlap.join(', ')}`);
  }
};

export const parseWeeklyFlowConfig = (env: NodeJS.ProcessEnv): WeeklyFlowConfig => {
  const devHosts = list(env, 'WEEKLY_FLOW_DEV_HOSTS');
  const productionHosts = list(env, 'WEEKLY_FLOW_PRODUCTION_HOSTS');
  const devDatabases = list(env, 'WEEKLY_FLOW_DEV_DATABASES');
  const productionDatabases = list(env, 'WEEKLY_FLOW_PRODUCTION_DATABASES');
  rejectOverlap(devHosts, productionHosts, 'hosts');
  rejectOverlap(devDatabases, productionDatabases, 'databases');

  const initialMs = integer(env, 'WEEKLY_FLOW_POLL_INITIAL_MS', 250, 60_000);
  const maxMs = integer(env, 'WEEKLY_FLOW_POLL_MAX_MS', initialMs, 300_000);
  const runSeconds = integer(env, 'WEEKLY_FLOW_RUN_TIMEOUT_SECONDS', 3600, 259_200);

  const timeouts = {
    preflightSeconds: integer(env, 'WEEKLY_FLOW_PREFLIGHT_TIMEOUT_SECONDS', 60, 900),
    duplicateCleanupSeconds: integer(env, 'WEEKLY_FLOW_DUPLICATE_CLEANUP_TIMEOUT_SECONDS', 60, 3600),
    backupSeconds: integer(env, 'WEEKLY_FLOW_BACKUP_TIMEOUT_SECONDS', 60, 7200),
    deleteSeconds: integer(env, 'WEEKLY_FLOW_DELETE_TIMEOUT_SECONDS', 60, 1800),
    rssSeconds: integer(env, 'WEEKLY_FLOW_RSS_TIMEOUT_SECONDS', 60, 86_400),
    semanticSeconds: integer(env, 'WEEKLY_FLOW_SEMANTIC_TIMEOUT_SECONDS', 60, 14_400),
    stateSeconds: integer(env, 'WEEKLY_FLOW_STATE_TIMEOUT_SECONDS', 60, 64_800),
    aiApproverV02Seconds: integer(env, 'WEEKLY_FLOW_AI_APPROVER_V02_TIMEOUT_SECONDS', 60, 43_200),
    runSeconds
  };
  if (Object.values(timeouts).some((value) => value > runSeconds)) {
    throw new Error('stage timeouts must not exceed WEEKLY_FLOW_RUN_TIMEOUT_SECONDS');
  }

  return {
    repositoryPath: absolutePath(env, 'WEEKLY_FLOW_REPOSITORY_PATH'),
    resourcesPath: absolutePath(env, 'WEEKLY_FLOW_RESOURCES_PATH'),
    devHosts,
    productionHosts,
    devDatabases,
    productionDatabases,
    workerNodeUrl: baseUrl(env, 'WEEKLY_FLOW_WORKER_NODE_URL'),
    workerPythonUrl: baseUrl(env, 'WEEKLY_FLOW_WORKER_PYTHON_URL'),
    lockPath: absolutePath(env, 'WEEKLY_FLOW_LOCK_PATH'),
    backupDirectory: absolutePath(env, 'WEEKLY_FLOW_BACKUP_DIRECTORY'),
    journalDirectory: absolutePath(env, 'WEEKLY_FLOW_JOURNAL_DIRECTORY'),
    alertStagingPath: absolutePath(env, 'WEEKLY_FLOW_ALERT_STAGING_PATH'),
    alertHelperService: required(env, 'WEEKLY_FLOW_ALERT_HELPER_SERVICE'),
    timeouts,
    polling: { initialMs, maxMs },
    minimumFreeDiskBytes: integer(env, 'WEEKLY_FLOW_MIN_FREE_DISK_BYTES', 1, Number.MAX_SAFE_INTEGER),
    devRssTarget: integer(env, 'WEEKLY_FLOW_DEV_RSS_TARGET', 1, 10_000)
  };
};

const positiveCliInteger = (name: string, raw: string | undefined): number => {
  if (!raw || !/^\d+$/.test(raw) || Number(raw) <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Number(raw);
};

export const parseWeeklyFlowCli = (argv: string[]): WeeklyFlowCliOptions => {
  const values: Record<string, string | true> = {};
  const valueFlags = new Set(['--mode', '--resume-run-id', '--confirm-dev-database', '--canary-target']);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--allow-live-ai') {
      values[flag] = true;
      continue;
    }
    if (!valueFlags.has(flag)) {
      throw new Error(`Unknown option: ${flag}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${flag} requires a value`);
    }
    values[flag] = value;
    index += 1;
  }

  const mode = values['--mode'];
  if (typeof mode !== 'string' || !modes.includes(mode as WeeklyArticleFlowMode)) {
    throw new Error(`--mode must be one of: ${modes.join(', ')}`);
  }
  const production = mode === 'manual_production' || mode === 'scheduled_production';
  if (production && values['--canary-target'] !== undefined) {
    throw new Error('--canary-target is not permitted in production modes');
  }

  return {
    mode: mode as WeeklyArticleFlowMode,
    ...(typeof values['--resume-run-id'] === 'string'
      ? { resumeRunId: positiveCliInteger('--resume-run-id', values['--resume-run-id']) }
      : {}),
    ...(typeof values['--confirm-dev-database'] === 'string'
      ? { expectedDevDatabase: values['--confirm-dev-database'] }
      : {}),
    ...(typeof values['--canary-target'] === 'string'
      ? { canaryTarget: positiveCliInteger('--canary-target', values['--canary-target']) }
      : {}),
    allowLiveAi: values['--allow-live-ai'] === true
  };
};
