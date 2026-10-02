import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { opsDirectory } from '../../config';

export interface CreateDatabaseBackupResult {
  backupPath: string;
  byteSize: number;
  sha256: string;
  manifestVersion: number;
}

export type CreateDatabaseBackupFailure =
  | 'artifact_verification'
  | 'exit'
  | 'output_contract'
  | 'spawn'
  | 'timeout';

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

export interface BackupCommandSpec {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export type BackupProcessLauncher = (
  command: BackupCommandSpec
) => ChildProcessWithoutNullStreams;

const SUCCESS_EVENT = 'database_backup_created';
const MAX_LINE_BYTES = 64 * 1024;
const DIAGNOSTIC_TAIL_BYTES = 32 * 1024;
const TERMINATION_GRACE_MILLISECONDS = 5_000;

const REMOVED_ENVIRONMENT_KEYS = new Set([
  'NODE_ENV',
  'NAME_APP',
  'NEXT_PUBLIC_MODE',
  'URL_BASE_NEWS_NEXUS_PYTHON_QUEUER',
  'WORKER_PYTHON_REQUEST_TIMEOUT_SECONDS',
  'DB_MANAGER_BACKUP_TIMEOUT_SECONDS',
  'PATH_TO_LOGS',
  'LOG_MAX_SIZE',
  'LOG_MAX_FILES',
  'PATH_DB_BACKUPS'
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const buildDbManagerEnvironment = (
  parentEnvironment: NodeJS.ProcessEnv
): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(parentEnvironment).filter(
      ([key]) => !REMOVED_ENVIRONMENT_KEYS.has(key) && !key.startsWith('PG_')
    )
  );

export const buildProductionBackupCommand = (
  parentEnvironment: NodeJS.ProcessEnv = process.env,
  baseOpsDirectory = opsDirectory
): BackupCommandSpec => {
  const dbManagerDirectory = path.resolve(baseOpsDirectory, '..', 'db-manager');
  return {
    executable: process.execPath,
    args: [path.join(dbManagerDirectory, 'dist', 'index.js'), '--create_backup'],
    cwd: dbManagerDirectory,
    env: buildDbManagerEnvironment(parentEnvironment)
  };
};

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

const appendDiagnosticTail = (
  current: Buffer<ArrayBufferLike>,
  chunk: Buffer<ArrayBufferLike>
): Buffer<ArrayBufferLike> => {
  if (chunk.byteLength >= DIAGNOSTIC_TAIL_BYTES) {
    return chunk.subarray(chunk.byteLength - DIAGNOSTIC_TAIL_BYTES);
  }
  const combined = Buffer.concat([current, chunk]);
  return combined.byteLength <= DIAGNOSTIC_TAIL_BYTES
    ? combined
    : combined.subarray(combined.byteLength - DIAGNOSTIC_TAIL_BYTES);
};

class BackupStdoutParser {
  public readonly candidates: CreateDatabaseBackupResult[] = [];
  public contractError: CreateDatabaseBackupError | undefined;
  private readonly decoder = new StringDecoder('utf8');
  private fragment = '';
  private discardingOversizedLine = false;

  public write(chunk: Buffer): void {
    this.consume(this.decoder.write(chunk));
  }

  public end(): void {
    this.consume(this.decoder.end(), true);
  }

  private consume(text: string, final = false): void {
    let remaining = text;
    while (remaining.length > 0) {
      const newlineIndex = remaining.indexOf('\n');
      if (newlineIndex === -1) {
        if (!this.discardingOversizedLine) {
          this.fragment += remaining;
          if (Buffer.byteLength(this.fragment, 'utf8') > MAX_LINE_BYTES) {
            this.recordOversizedLine();
          }
        }
        remaining = '';
        break;
      }

      const segment = remaining.slice(0, newlineIndex);
      remaining = remaining.slice(newlineIndex + 1);
      if (this.discardingOversizedLine) {
        this.discardingOversizedLine = false;
        this.fragment = '';
        continue;
      }

      const line = `${this.fragment}${segment}`.replace(/\r$/, '');
      this.fragment = '';
      if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
        this.recordOversizedLine(false);
      } else {
        this.readLine(line);
      }
    }

    if (final && !this.discardingOversizedLine && this.fragment.length > 0) {
      this.readLine(this.fragment.replace(/\r$/, ''));
      this.fragment = '';
    }
  }

  private recordOversizedLine(discardUntilNewline = true): void {
    this.contractError ??= new CreateDatabaseBackupError(
      'output_contract',
      `Db-manager output contained a line larger than ${MAX_LINE_BYTES} bytes`
    );
    this.fragment = '';
    this.discardingOversizedLine = discardUntilNewline;
  }

  private readLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const candidate = parseDatabaseBackupResultLine(trimmed);
      if (candidate) this.candidates.push(candidate);
    } catch (error: unknown) {
      this.contractError ??=
        error instanceof CreateDatabaseBackupError
          ? error
          : new CreateDatabaseBackupError(
              'output_contract',
              'Db-manager backup result could not be parsed',
              { cause: error }
            );
    }
  }
}

const defaultLauncher: BackupProcessLauncher = (command) => {
  const child = spawn(command.executable, command.args, {
    cwd: command.cwd,
    env: command.env,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  child.stdin.end();
  return child;
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

export const runDatabaseBackupCommand = async (
  command: BackupCommandSpec,
  timeoutSeconds: number,
  launcher: BackupProcessLauncher = defaultLauncher,
  terminationGraceMilliseconds = TERMINATION_GRACE_MILLISECONDS
): Promise<CreateDatabaseBackupResult> => {
  let child: ChildProcessWithoutNullStreams;
  try {
    child = launcher(command);
  } catch (error: unknown) {
    throw new CreateDatabaseBackupError('spawn', 'Db-manager backup process could not start', {
      cause: error
    });
  }

  const parser = new BackupStdoutParser();
  let stdoutTail: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let stderrTail: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  const stdoutDone = new Promise<void>((resolve, reject) => {
    child.stdout.on('data', (chunk: Buffer) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutTail = appendDiagnosticTail(stdoutTail, bytes);
      parser.write(bytes);
    });
    child.stdout.once('end', () => {
      parser.end();
      resolve();
    });
    child.stdout.once('error', reject);
  });
  const stderrDone = new Promise<void>((resolve, reject) => {
    child.stderr.on('data', (chunk: Buffer) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stderrTail = appendDiagnosticTail(stderrTail, bytes);
    });
    child.stderr.once('end', resolve);
    child.stderr.once('error', reject);
  });

  let timedOut = false;
  let forceTimer: NodeJS.Timeout | undefined;
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    forceTimer = setTimeout(() => child.kill('SIGKILL'), terminationGraceMilliseconds);
    forceTimer.unref();
  }, timeoutSeconds * 1000);
  timeoutTimer.unref();

  const closeResult = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once('error', (error) => reject(error));
      child.once('close', (code, signal) => resolve({ code, signal }));
    }
  ).catch((error: unknown) => {
    throw new CreateDatabaseBackupError('spawn', 'Db-manager backup process could not start', {
      cause: error
    });
  }).finally(() => {
    clearTimeout(timeoutTimer);
    if (forceTimer) clearTimeout(forceTimer);
  });

  try {
    await Promise.all([stdoutDone, stderrDone]);
  } catch (error: unknown) {
    throw new CreateDatabaseBackupError(
      'output_contract',
      'Db-manager backup output stream failed',
      { cause: error }
    );
  }

  // Keep the bounded tails consumed even when they are not safe to include in logs.
  void stdoutTail;
  void stderrTail;

  if (timedOut) {
    throw new CreateDatabaseBackupError(
      'timeout',
      `Db-manager backup timed out after ${timeoutSeconds} seconds; outcome unverified`
    );
  }
  if (closeResult.code !== 0 || closeResult.signal !== null) {
    throw new CreateDatabaseBackupError(
      'exit',
      closeResult.signal
        ? `Db-manager backup exited because of signal ${closeResult.signal}`
        : `Db-manager backup exited with code ${closeResult.code}`
    );
  }
  if (parser.contractError) throw parser.contractError;
  if (parser.candidates.length !== 1) {
    throw new CreateDatabaseBackupError(
      'output_contract',
      `Db-manager backup produced ${parser.candidates.length} valid success results; expected exactly one`
    );
  }

  return verifyBackupArtifact(parser.candidates[0]);
};
