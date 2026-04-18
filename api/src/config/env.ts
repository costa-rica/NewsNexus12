import 'dotenv/config';

function readRequired(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readOptional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== '' ? value : fallback;
}

function readBoolean(name: string, fallback = false): boolean {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    return fallback;
  }
  return value === 'true';
}

function readPort(name: string, fallback: number): number {
  const raw = readOptional(name, String(fallback));
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid ${name} value: ${raw}`);
  }
  return port;
}

export type AppEnv = {
  nodeEnv: string;
  nameApp: string;
  pathToLogs: string;
  port: number;
  loadLegacyRouters: boolean;
};

export const env: AppEnv = {
  nodeEnv: readRequired('NODE_ENV'),
  nameApp: readRequired('NAME_APP'),
  pathToLogs: readRequired('PATH_TO_LOGS'),
  port: readPort('PORT', 8001),
  loadLegacyRouters: readBoolean('LOAD_LEGACY_ROUTERS', false),
};

// Keep this list append-only for startup hard requirements.
export const REQUIRED_STARTUP_ENV_VARS: string[] = [
  'PATH_TO_UTILITIES_ANALYSIS_SPREADSHEETS',
  'PG_HOST',
  'PG_PORT',
  'PG_DATABASE',
  'PG_USER',
  'NAME_APP',
];

export function validateRequiredStartupEnvVars(
  requiredVars: string[] = REQUIRED_STARTUP_ENV_VARS,
): void {
  const missing = requiredVars.filter((name) => {
    const value = process.env[name];
    return !value || value.trim() === '';
  });

  if (missing.length > 0) {
    throw new Error(
      `Missing required startup environment variable(s): ${missing.join(', ')}`,
    );
  }
}
