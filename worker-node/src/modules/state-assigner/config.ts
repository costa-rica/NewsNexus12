import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../errors/appError';
import logger from '../logger';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_CODEX_MODEL = 'gpt-5.4-mini';
const DEFAULT_CODEX_TIMEOUT_SECONDS = 180;

export type StateAssignerAiConfig =
  | { backend: 'openai'; modelName: string; keyOpenAi: string }
  | { backend: 'codex-cli'; modelName: string; codexTimeoutMs: number };

export interface StateAssignerAiConfigDependencies {
  isCodexBinaryAvailable?: (env: NodeJS.ProcessEnv) => boolean;
}

const parseBooleanEnv = (value: string | undefined, field: string): boolean => {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized === '') {
    return false;
  }

  if (TRUE_VALUES.has(normalized)) {
    return true;
  }

  if (FALSE_VALUES.has(normalized)) {
    return false;
  }

  throw AppError.validation([
    {
      field,
      message: `${field} must be a boolean-like value`
    }
  ]);
};

const parsePositiveIntegerEnv = (
  value: string | undefined,
  defaultValue: number,
  field: string
): number => {
  const normalized = (value ?? '').trim();
  if (normalized === '') {
    return defaultValue;
  }

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw AppError.validation([
      {
        field,
        message: `${field} must be a positive integer`
      }
    ]);
  }

  return parsed;
};

const resolveModelName = (env: NodeJS.ProcessEnv, defaultModel: string): string => {
  const value = env.STATE_ASSIGNER_MODEL_NAME?.trim();
  return value && value !== '' ? value : defaultModel;
};

export const isCodexBinaryAvailableOnPath = (env: NodeJS.ProcessEnv): boolean => {
  const pathValue = env.PATH ?? '';
  if (pathValue.trim() === '') {
    return false;
  }

  return pathValue.split(path.delimiter).some((entry) => {
    if (entry.trim() === '') {
      return false;
    }

    const candidate = path.join(entry, 'codex');
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
};

const assertCodexBinaryAvailable = (
  env: NodeJS.ProcessEnv,
  deps: StateAssignerAiConfigDependencies
): void => {
  const isAvailable = deps.isCodexBinaryAvailable ?? isCodexBinaryAvailableOnPath;
  if (isAvailable(env)) {
    return;
  }

  throw AppError.validation([
    {
      field: 'codex',
      message:
        'codex CLI not found on PATH; install the Codex CLI (docs/CODEX_CLI_SERVER_SETUP.md) or set USE_OPEN_AI_API=true with KEY_OPEN_AI'
    }
  ]);
};

export const resolveStateAssignerAiConfig = (
  env: NodeJS.ProcessEnv,
  deps: StateAssignerAiConfigDependencies = {}
): StateAssignerAiConfig => {
  const useOpenAiApi = parseBooleanEnv(env.USE_OPEN_AI_API, 'USE_OPEN_AI_API');
  const keyOpenAi = env.KEY_OPEN_AI?.trim() ?? '';

  if (useOpenAiApi && keyOpenAi !== '') {
    return {
      backend: 'openai',
      modelName: resolveModelName(env, DEFAULT_OPENAI_MODEL),
      keyOpenAi
    };
  }

  if (useOpenAiApi && keyOpenAi === '') {
    logger.warn(
      'event=state_assigner_openai_key_missing USE_OPEN_AI_API is true but KEY_OPEN_AI is empty; falling back to the Codex CLI backend'
    );
  }

  assertCodexBinaryAvailable(env, deps);

  return {
    backend: 'codex-cli',
    modelName: resolveModelName(env, DEFAULT_CODEX_MODEL),
    codexTimeoutMs:
      parsePositiveIntegerEnv(
        env.STATE_ASSIGNER_CODEX_TIMEOUT_SECONDS,
        DEFAULT_CODEX_TIMEOUT_SECONDS,
        'STATE_ASSIGNER_CODEX_TIMEOUT_SECONDS'
      ) * 1000
  };
};
