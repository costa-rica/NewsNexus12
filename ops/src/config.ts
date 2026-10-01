import path from 'node:path';
import dotenv from 'dotenv';

export interface OpsConfig {
  nodeEnv: 'development' | 'testing' | 'production';
  nameApp: string;
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

const positiveInteger = (value: string | undefined, key: string): number => {
  if (!value?.trim()) return 5;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return parsed;
};

export const loadConfig = (): OpsConfig => {
  // dotenv fills missing values only; service-supplied environment takes priority.
  const result = dotenv.config({ path: path.join(opsDirectory, '.env'), quiet: true });
  if (result.error && (result.error as NodeJS.ErrnoException).code !== 'ENOENT') {
    throw result.error;
  }

  const requestedEnv = required(process.env, 'NODE_ENV');
  const nodeEnv = requestedEnv === 'test' ? 'testing' : requestedEnv;
  if (!['development', 'testing', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, testing, or production');
  }

  return {
    nodeEnv: nodeEnv as OpsConfig['nodeEnv'],
    nameApp: required(process.env, 'NAME_APP'),
    pathToLogs: path.resolve(opsDirectory, required(process.env, 'PATH_TO_LOGS')),
    logMaxSizeMb: positiveInteger(process.env.LOG_MAX_SIZE, 'LOG_MAX_SIZE'),
    logMaxFiles: positiveInteger(process.env.LOG_MAX_FILES, 'LOG_MAX_FILES')
  };
};
