import { opsDirectory } from '../../config';
import {
  buildProductionDbManagerCommand,
  runDbManagerCommand,
  type DbManagerCommandFailure,
  type DbManagerCommandMessages,
  type DbManagerCommandSpec,
  type DbManagerProcessLauncher
} from '../dbManagerCommandRunner';

export interface DeleteOldArticlesResult {
  daysOldThreshold: number;
  cutoffDate: string;
  eligibleCount: number;
  processedCount: number;
  deletedCount: number;
}

export type DeleteOldArticlesFailure = DbManagerCommandFailure;

export class DeleteOldArticlesError extends Error {
  public readonly category: DeleteOldArticlesFailure;

  public constructor(
    category: DeleteOldArticlesFailure,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DeleteOldArticlesError';
    this.category = category;
  }
}

export type DeleteOldArticlesCommandSpec = DbManagerCommandSpec;
export type DeleteOldArticlesProcessLauncher = DbManagerProcessLauncher;

const SUCCESS_EVENT = 'old_articles_deleted';
const REQUIRED_DAYS_OLD_THRESHOLD = 180;

const DELETE_COMMAND_MESSAGES: DbManagerCommandMessages = {
  spawn: 'Db-manager old-article deletion process could not start',
  outputStream: 'Db-manager old-article deletion output stream failed',
  oversizedLine: (maximumBytes) =>
    `Db-manager output contained a line larger than ${maximumBytes} bytes`,
  parse: 'Db-manager old-article deletion result could not be parsed',
  timeout: (timeoutSeconds) =>
    `Db-manager old-article deletion timed out after ${timeoutSeconds} seconds; outcome unverified`,
  signalExit: (signal) =>
    `Db-manager old-article deletion exited because of signal ${signal}`,
  nonzeroExit: (code) => `Db-manager old-article deletion exited with code ${code}`,
  candidateCount: (count) =>
    `Db-manager old-article deletion produced ${count} valid success results; expected exactly one`
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCalendarDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

const requireDeleteResult = (value: unknown): DeleteOldArticlesResult => {
  if (!isRecord(value) || value.event !== SUCCESS_EVENT) {
    throw new DeleteOldArticlesError(
      'output_contract',
      'Db-manager old-article deletion result must use the expected event'
    );
  }
  if (value.daysOldThreshold !== REQUIRED_DAYS_OLD_THRESHOLD) {
    throw new DeleteOldArticlesError(
      'output_contract',
      `Db-manager old-article deletion threshold must be ${REQUIRED_DAYS_OLD_THRESHOLD}`
    );
  }
  if (!isCalendarDate(value.cutoffDate)) {
    throw new DeleteOldArticlesError(
      'output_contract',
      'Db-manager old-article deletion cutoffDate must be a valid YYYY-MM-DD date'
    );
  }
  if (
    !isNonNegativeSafeInteger(value.eligibleCount) ||
    !isNonNegativeSafeInteger(value.processedCount) ||
    !isNonNegativeSafeInteger(value.deletedCount)
  ) {
    throw new DeleteOldArticlesError(
      'output_contract',
      'Db-manager old-article deletion counts must be non-negative safe integers'
    );
  }
  if (value.deletedCount > value.processedCount || value.processedCount > value.eligibleCount) {
    throw new DeleteOldArticlesError(
      'output_contract',
      'Db-manager old-article deletion counts must satisfy deleted <= processed <= eligible'
    );
  }

  return {
    daysOldThreshold: value.daysOldThreshold,
    cutoffDate: value.cutoffDate,
    eligibleCount: value.eligibleCount,
    processedCount: value.processedCount,
    deletedCount: value.deletedCount
  };
};

export const parseDeleteOldArticlesResultLine = (
  line: string
): DeleteOldArticlesResult | undefined => {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(value) || value.event !== SUCCESS_EVENT) return undefined;
  return requireDeleteResult(value);
};

export const buildProductionDeleteOldArticlesCommand = (
  parentEnvironment: NodeJS.ProcessEnv = process.env,
  baseOpsDirectory = opsDirectory
): DeleteOldArticlesCommandSpec =>
  buildProductionDbManagerCommand(['--delete_articles'], parentEnvironment, baseOpsDirectory);

const createDeleteError = (
  category: DbManagerCommandFailure,
  message: string,
  options?: { cause?: unknown }
): DeleteOldArticlesError =>
  options?.cause instanceof DeleteOldArticlesError
    ? options.cause
    : new DeleteOldArticlesError(category, message, options);

export const runDeleteOldArticlesCommand = (
  command: DeleteOldArticlesCommandSpec,
  timeoutSeconds: number,
  launcher?: DeleteOldArticlesProcessLauncher,
  terminationGraceMilliseconds?: number
): Promise<DeleteOldArticlesResult> =>
  runDbManagerCommand({
    command,
    timeoutSeconds,
    parseResultLine: parseDeleteOldArticlesResultLine,
    createError: createDeleteError,
    messages: DELETE_COMMAND_MESSAGES,
    launcher,
    terminationGraceMilliseconds
  });
