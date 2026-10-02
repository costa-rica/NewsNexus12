import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { opsDirectory } from '../../config';
import {
  buildDbManagerEnvironment,
  buildProductionDbManagerCommand,
  runDbManagerCommand,
  type DbManagerCommandFailure,
  type DbManagerCommandMessages,
  type DbManagerCommandSpec,
  type DbManagerProcessLauncher
} from '../dbManagerCommandRunner';

export interface CreateDatabaseBackupResult {
  backupPath: string;
  byteSize: number;
  sha256: string;
  manifestVersion: number;
}

export type CreateDatabaseBackupFailure =
  | 'artifact_verification'
  | DbManagerCommandFailure;

export class CreateDatabaseBackupError extends Error {
  public readonly category: CreateDatabaseBackupFailure;

  public constructor(
    category: CreateDatabaseBackupFailure,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'CreateDatabaseBackupError';
    this.category = category;
  }
}

export type BackupCommandSpec = DbManagerCommandSpec;
export type BackupProcessLauncher = DbManagerProcessLauncher;
export { buildDbManagerEnvironment };

const SUCCESS_EVENT = 'database_backup_created';

const BACKUP_COMMAND_MESSAGES: DbManagerCommandMessages = {
  spawn: 'Db-manager backup process could not start',
  outputStream: 'Db-manager backup output stream failed',
  oversizedLine: (maximumBytes) =>
    `Db-manager output contained a line larger than ${maximumBytes} bytes`,
  parse: 'Db-manager backup result could not be parsed',
  timeout: (timeoutSeconds) =>
    `Db-manager backup timed out after ${timeoutSeconds} seconds; outcome unverified`,
  signalExit: (signal) => `Db-manager backup exited because of signal ${signal}`,
  nonzeroExit: (code) => `Db-manager backup exited with code ${code}`,
  candidateCount: (count) =>
    `Db-manager backup produced ${count} valid success results; expected exactly one`
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const buildProductionBackupCommand = (
  parentEnvironment: NodeJS.ProcessEnv = process.env,
  baseOpsDirectory = opsDirectory
): BackupCommandSpec =>
  buildProductionDbManagerCommand(['--create_backup'], parentEnvironment, baseOpsDirectory);

const requireBackupResult = (value: unknown): CreateDatabaseBackupResult => {
  if (!isRecord(value) || value.event !== SUCCESS_EVENT) {
    throw new CreateDatabaseBackupError(
      'output_contract',
      'Db-manager backup result must be an object with the expected event'
    );
  }
  if (typeof value.backupPath !== 'string' || !path.isAbsolute(value.backupPath)) {
    throw new CreateDatabaseBackupError(
      'output_contract',
      'Db-manager backup result must contain an absolute backupPath'
    );
  }
  if (!Number.isSafeInteger(value.byteSize) || (value.byteSize as number) <= 0) {
    throw new CreateDatabaseBackupError(
      'output_contract',
      'Db-manager backup result byteSize must be a positive integer'
    );
  }
  if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) {
    throw new CreateDatabaseBackupError(
      'output_contract',
      'Db-manager backup result sha256 must be a lowercase SHA-256 digest'
    );
  }
  if (value.manifestVersion !== 1) {
    throw new CreateDatabaseBackupError(
      'output_contract',
      'Db-manager backup result reported manifest version must be 1'
    );
  }

  return {
    backupPath: value.backupPath,
    byteSize: value.byteSize as number,
    sha256: value.sha256,
    manifestVersion: 1
  };
};

export const parseDatabaseBackupResultLine = (
  line: string
): CreateDatabaseBackupResult | undefined => {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(value) || value.event !== SUCCESS_EVENT) return undefined;
  return requireBackupResult(value);
};

const sha256File = async (filePath: string): Promise<string> => {
  const hash = crypto.createHash('sha256');
  const input = fs.createReadStream(filePath);
  return new Promise((resolve, reject) => {
    input.on('data', (chunk) => hash.update(chunk));
    input.on('error', reject);
    input.on('end', () => resolve(hash.digest('hex')));
  });
};

export const verifyBackupArtifact = async (
  result: CreateDatabaseBackupResult
): Promise<CreateDatabaseBackupResult> => {
  try {
    const stats = await fs.promises.stat(result.backupPath);
    if (!stats.isFile()) throw new Error('reported path is not a regular file');
    if (stats.size <= 0) throw new Error('reported backup is empty');
    if (stats.size !== result.byteSize) throw new Error('reported backup size does not match');
    if ((await sha256File(result.backupPath)) !== result.sha256) {
      throw new Error('reported backup SHA-256 does not match');
    }
    return result;
  } catch (error: unknown) {
    throw new CreateDatabaseBackupError(
      'artifact_verification',
      'Db-manager backup artifact could not be verified',
      { cause: error }
    );
  }
};

const createBackupError = (
  category: DbManagerCommandFailure,
  message: string,
  options?: { cause?: unknown }
): CreateDatabaseBackupError =>
  options?.cause instanceof CreateDatabaseBackupError
    ? options.cause
    : new CreateDatabaseBackupError(category, message, options);

export const runDatabaseBackupCommand = async (
  command: BackupCommandSpec,
  timeoutSeconds: number,
  launcher?: BackupProcessLauncher,
  terminationGraceMilliseconds?: number
): Promise<CreateDatabaseBackupResult> => {
  const result = await runDbManagerCommand({
    command,
    timeoutSeconds,
    parseResultLine: parseDatabaseBackupResultLine,
    createError: createBackupError,
    messages: BACKUP_COMMAND_MESSAGES,
    launcher,
    terminationGraceMilliseconds
  });
  return verifyBackupArtifact(result);
};
