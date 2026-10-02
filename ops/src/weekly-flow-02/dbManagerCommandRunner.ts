import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { opsDirectory } from '../config';

export type DbManagerCommandFailure = 'exit' | 'output_contract' | 'spawn' | 'timeout';

export interface DbManagerCommandSpec {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export type DbManagerProcessLauncher = (
  command: DbManagerCommandSpec
) => ChildProcessWithoutNullStreams;

export interface DbManagerCommandMessages {
  spawn: string;
  outputStream: string;
  oversizedLine: (maximumBytes: number) => string;
  parse: string;
  timeout: (timeoutSeconds: number) => string;
  signalExit: (signal: NodeJS.Signals) => string;
  nonzeroExit: (code: number | null) => string;
  candidateCount: (count: number) => string;
}

export interface DbManagerCommandErrorFactory<TError extends Error> {
  (
    category: DbManagerCommandFailure,
    message: string,
    options?: { cause?: unknown }
  ): TError;
}

interface RunDbManagerCommandOptions<TResult, TError extends Error> {
  command: DbManagerCommandSpec;
  timeoutSeconds: number;
  parseResultLine: (line: string) => TResult | undefined;
  createError: DbManagerCommandErrorFactory<TError>;
  messages: DbManagerCommandMessages;
  launcher?: DbManagerProcessLauncher;
  terminationGraceMilliseconds?: number;
}

const MAX_LINE_BYTES = 64 * 1024;
const DIAGNOSTIC_TAIL_BYTES = 32 * 1024;
export const DB_MANAGER_TERMINATION_GRACE_MILLISECONDS = 5_000;

const REMOVED_ENVIRONMENT_KEYS = new Set([
  'NODE_ENV',
  'NAME_APP',
  'NEXT_PUBLIC_MODE',
  'URL_BASE_NEWS_NEXUS_PYTHON_QUEUER',
  'WORKER_PYTHON_REQUEST_TIMEOUT_SECONDS',
  'DB_MANAGER_BACKUP_TIMEOUT_SECONDS',
  'DB_MANAGER_DELETE_ARTICLES_TIMEOUT_SECONDS',
  'PATH_TO_LOGS',
  'LOG_MAX_SIZE',
  'LOG_MAX_FILES',
  'PATH_DB_BACKUPS'
]);

export const buildDbManagerEnvironment = (
  parentEnvironment: NodeJS.ProcessEnv
): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(parentEnvironment).filter(
      ([key]) => !REMOVED_ENVIRONMENT_KEYS.has(key) && !key.startsWith('PG_')
    )
  );

export const buildProductionDbManagerCommand = (
  args: string[],
  parentEnvironment: NodeJS.ProcessEnv = process.env,
  baseOpsDirectory = opsDirectory
): DbManagerCommandSpec => {
  const dbManagerDirectory = path.resolve(baseOpsDirectory, '..', 'db-manager');
  return {
    executable: process.execPath,
    args: [path.join(dbManagerDirectory, 'dist', 'index.js'), ...args],
    cwd: dbManagerDirectory,
    env: buildDbManagerEnvironment(parentEnvironment)
  };
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

class DbManagerStdoutParser<TResult, TError extends Error> {
  public readonly candidates: TResult[] = [];
  public contractError: TError | undefined;
  private readonly decoder = new StringDecoder('utf8');
  private fragment = '';
  private discardingOversizedLine = false;

  public constructor(
    private readonly parseResultLine: (line: string) => TResult | undefined,
    private readonly createError: DbManagerCommandErrorFactory<TError>,
    private readonly messages: DbManagerCommandMessages
  ) {}

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
    this.contractError ??= this.createError(
      'output_contract',
      this.messages.oversizedLine(MAX_LINE_BYTES)
    );
    this.fragment = '';
    this.discardingOversizedLine = discardUntilNewline;
  }

  private readLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const candidate = this.parseResultLine(trimmed);
      if (candidate) this.candidates.push(candidate);
    } catch (error: unknown) {
      this.contractError ??= this.createError('output_contract', this.messages.parse, {
        cause: error
      });
    }
  }
}

const defaultLauncher: DbManagerProcessLauncher = (command) => {
  const child = spawn(command.executable, command.args, {
    cwd: command.cwd,
    env: command.env,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  child.stdin.end();
  return child;
};

export const runDbManagerCommand = async <TResult, TError extends Error>({
  command,
  timeoutSeconds,
  parseResultLine,
  createError,
  messages,
  launcher = defaultLauncher,
  terminationGraceMilliseconds = DB_MANAGER_TERMINATION_GRACE_MILLISECONDS
}: RunDbManagerCommandOptions<TResult, TError>): Promise<TResult> => {
  let child: ChildProcessWithoutNullStreams;
  try {
    child = launcher(command);
  } catch (error: unknown) {
    throw createError('spawn', messages.spawn, { cause: error });
  }

  const parser = new DbManagerStdoutParser(parseResultLine, createError, messages);
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

  const closeResult = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  })
    .catch((error: unknown) => {
      throw createError('spawn', messages.spawn, { cause: error });
    })
    .finally(() => {
      clearTimeout(timeoutTimer);
      if (forceTimer) clearTimeout(forceTimer);
    });

  try {
    await Promise.all([stdoutDone, stderrDone]);
  } catch (error: unknown) {
    throw createError('output_contract', messages.outputStream, { cause: error });
  }

  void stdoutTail;
  void stderrTail;

  if (timedOut) {
    throw createError('timeout', messages.timeout(timeoutSeconds));
  }
  if (closeResult.code !== 0 || closeResult.signal !== null) {
    throw createError(
      'exit',
      closeResult.signal
        ? messages.signalExit(closeResult.signal)
        : messages.nonzeroExit(closeResult.code)
    );
  }
  if (parser.contractError) throw parser.contractError;
  if (parser.candidates.length !== 1) {
    throw createError('output_contract', messages.candidateCount(parser.candidates.length));
  }

  return parser.candidates[0];
};
