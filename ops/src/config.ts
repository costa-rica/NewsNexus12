import path from 'node:path';
import dotenv from 'dotenv';

export interface OpsConfig {
  nodeEnv: 'development' | 'testing' | 'production';
  nameApp: string;
  workerPythonBaseUrl: string;
  workerPythonRequestTimeoutSeconds: number;
  workerNodeBaseUrl: string;
  workerNodeRequestTimeoutSeconds: number;
  rssStatusPollIntervalSeconds: number;
  rssToleratedConsecutiveStatusFailures: number;
  rssJobTimeoutHours: number;
  semanticScorerStatusPollIntervalSeconds: number;
  semanticScorerToleratedConsecutiveStatusFailures: number;
  semanticScorerMonitoringLimitHours: number;
  stateAssignerTargetArticleThresholdDaysOld: number;
  stateAssignerStatusPollIntervalSeconds: number;
  stateAssignerToleratedConsecutiveStatusFailures: number;
  stateAssignerMonitoringLimitHours: number;
  dbManagerBackupTimeoutSeconds: number;
  dbManagerDeleteArticlesTimeoutSeconds: number;
  pathToLogs: string;
  logMaxSizeMb: number;
  logMaxFiles: number;
}

// Both src/ and compiled dist/ sit directly inside the ops workspace.
export const opsDirectory = path.resolve(__dirname, '..');

const required = (env: NodeJS.ProcessEnv, key: string): string => {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
};

const optionalPositiveInteger = (
  value: string | undefined,
  key: string,
  defaultValue: number
): number => {
  if (value === undefined) return defaultValue;
  if (!value.trim()) throw new Error(`${key} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return parsed;
};

const requiredPositiveInteger = (env: NodeJS.ProcessEnv, key: string): number => {
  const value = required(env, key);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return parsed;
};

const requiredHttpUrl = (env: NodeJS.ProcessEnv, key: string): string => {
  const value = required(env, key);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${key} must use http or https`);
  }
  return value;
};

export const parseOpsConfig = (env: NodeJS.ProcessEnv, baseDirectory: string): OpsConfig => {
  const requestedEnv = required(env, 'NODE_ENV');
  const nodeEnv = requestedEnv === 'test' ? 'testing' : requestedEnv;
  if (!['development', 'testing', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, testing, or production');
  }

  return {
    nodeEnv: nodeEnv as OpsConfig['nodeEnv'],
    nameApp: required(env, 'NAME_APP'),
    workerPythonBaseUrl: requiredHttpUrl(env, 'URL_BASE_NEWS_NEXUS_PYTHON_QUEUER'),
    workerPythonRequestTimeoutSeconds: requiredPositiveInteger(
      env,
      'WORKER_PYTHON_REQUEST_TIMEOUT_SECONDS'
    ),
    workerNodeBaseUrl: requiredHttpUrl(env, 'URL_BASE_NEWS_NEXUS_WORKER_NODE'),
    workerNodeRequestTimeoutSeconds: requiredPositiveInteger(
      env,
      'WORKER_NODE_REQUEST_TIMEOUT_SECONDS'
    ),
    rssStatusPollIntervalSeconds: requiredPositiveInteger(
      env,
      'RSS_STATUS_POLL_INTERVAL_SECONDS'
    ),
    rssToleratedConsecutiveStatusFailures: requiredPositiveInteger(
      env,
      'RSS_TOLERATED_CONSECUTIVE_STATUS_FAILURES'
    ),
    rssJobTimeoutHours: requiredPositiveInteger(env, 'RSS_JOB_TIMEOUT_HOURS'),
    semanticScorerStatusPollIntervalSeconds: optionalPositiveInteger(
      env.SEMANTIC_SCORER_STATUS_POLL_INTERVAL_SECONDS,
      'SEMANTIC_SCORER_STATUS_POLL_INTERVAL_SECONDS',
      300
    ),
    semanticScorerToleratedConsecutiveStatusFailures: optionalPositiveInteger(
      env.SEMANTIC_SCORER_TOLERATED_CONSECUTIVE_STATUS_FAILURES,
      'SEMANTIC_SCORER_TOLERATED_CONSECUTIVE_STATUS_FAILURES',
      2
    ),
    semanticScorerMonitoringLimitHours: optionalPositiveInteger(
      env.SEMANTIC_SCORER_MONITORING_LIMIT_HOURS,
      'SEMANTIC_SCORER_MONITORING_LIMIT_HOURS',
      6
    ),
    stateAssignerTargetArticleThresholdDaysOld: requiredPositiveInteger(
      env,
      'STATE_ASSIGNER_TARGET_ARTICLE_THRESHOLD_DAYS_OLD'
    ),
    stateAssignerStatusPollIntervalSeconds: optionalPositiveInteger(
      env.STATE_ASSIGNER_STATUS_POLL_INTERVAL_SECONDS,
      'STATE_ASSIGNER_STATUS_POLL_INTERVAL_SECONDS',
      300
    ),
    stateAssignerToleratedConsecutiveStatusFailures: optionalPositiveInteger(
      env.STATE_ASSIGNER_TOLERATED_CONSECUTIVE_STATUS_FAILURES,
      'STATE_ASSIGNER_TOLERATED_CONSECUTIVE_STATUS_FAILURES',
      2
    ),
    stateAssignerMonitoringLimitHours: optionalPositiveInteger(
      env.STATE_ASSIGNER_MONITORING_LIMIT_HOURS,
      'STATE_ASSIGNER_MONITORING_LIMIT_HOURS',
      12
    ),
    dbManagerBackupTimeoutSeconds: requiredPositiveInteger(
      env,
      'DB_MANAGER_BACKUP_TIMEOUT_SECONDS'
    ),
    dbManagerDeleteArticlesTimeoutSeconds: requiredPositiveInteger(
      env,
      'DB_MANAGER_DELETE_ARTICLES_TIMEOUT_SECONDS'
    ),
    pathToLogs: path.resolve(baseDirectory, required(env, 'PATH_TO_LOGS')),
    logMaxSizeMb: optionalPositiveInteger(env.LOG_MAX_SIZE, 'LOG_MAX_SIZE', 5),
    logMaxFiles: optionalPositiveInteger(env.LOG_MAX_FILES, 'LOG_MAX_FILES', 5)
  };
};

export const loadConfig = (): OpsConfig => {
  // dotenv fills missing values only; service-supplied environment takes priority.
  const result = dotenv.config({ path: path.join(opsDirectory, '.env'), quiet: true });
  if (result.error && (result.error as NodeJS.ErrnoException).code !== 'ENOENT') {
    throw result.error;
  }

  return parseOpsConfig(process.env, opsDirectory);
};
