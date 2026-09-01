import { spawn } from 'node:child_process';

export interface CommandResult {
  command: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface CommandRequest {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export class CommandTimeoutError extends Error {
  constructor(public readonly command: string, public readonly timeoutMs: number) {
    super(`command timed out after ${timeoutMs}ms: ${command}`);
    this.name = 'CommandTimeoutError';
  }
}

const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;

const appendBounded = (current: string, chunk: Buffer): string => {
  const next = current + chunk.toString('utf8');
  return Buffer.byteLength(next) <= MAX_CAPTURE_BYTES
    ? next
    : next.slice(next.length - MAX_CAPTURE_BYTES);
};

export const runCommand = async (request: CommandRequest): Promise<CommandResult> => {
  const startedAt = Date.now();
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(request.command, request.args, {
      cwd: request.cwd,
      env: request.env ?? process.env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (chunk: Buffer) => { stdout = appendBounded(stdout, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = appendBounded(stderr, chunk); });

    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          child.kill('SIGTERM');
        }
        setTimeout(() => {
          try {
            process.kill(-child.pid!, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        }, 5000).unref();
      }
    }, request.timeoutMs);

    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new CommandTimeoutError(request.command, request.timeoutMs));
        return;
      }
      resolve({
        command: request.command,
        args: request.args,
        exitCode: code ?? -1,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt
      });
    });
  });
};

export const parseMachineResult = <T extends Record<string, unknown>>(
  stdout: string,
  expectedCommand: string
): T => {
  const parsed = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).flatMap((line) => {
    try {
      const value = JSON.parse(line) as unknown;
      return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? [value as Record<string, unknown>]
        : [];
    } catch {
      return [];
    }
  });
  const matches = parsed.filter((value) => value.command === expectedCommand);
  if (matches.length !== 1) {
    throw new Error(`expected exactly one ${expectedCommand} machine result, found ${matches.length}`);
  }
  return matches[0] as T;
};
