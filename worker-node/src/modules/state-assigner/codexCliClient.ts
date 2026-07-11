import { spawn as spawnProcess, SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { CancelableProcessHandle } from '../queue/queueEngine';
import { StateAssignerDirectories } from '../startup/stateAssignerFiles';
import { StateAssignerAiConfig } from './config';
import { buildStateAssignerPrompt, StateAssignerPromptArticle } from './prompt';
import { ChatGptResponse, parseChatGptResponse } from './responseParsing';

const OUTPUT_TAIL_CHARS = 400;
const CODEX_KILL_GRACE_MS = 5_000;

interface CodexChildProcess extends EventEmitter, CancelableProcessHandle {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
}

type SpawnCodexProcess = (
  command: string,
  args: string[],
  options: SpawnOptions
) => CodexChildProcess;

export interface AnalyzeArticleWithCodexCliDependencies {
  spawn?: SpawnCodexProcess;
}

const defaultSpawn: SpawnCodexProcess = (command, args, options) =>
  spawnProcess(command, args, options) as CodexChildProcess;

const createAbortError = (message: string): Error => {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
};

const recordTail = (current: string, chunk: Buffer | string): string =>
  `${current}${chunk.toString()}`.slice(-OUTPUT_TAIL_CHARS);

const outputTail = (stdoutTail: string, stderrTail: string): string => {
  const combined = [stdoutTail.trim(), stderrTail.trim()].filter((value) => value !== '').join(' ');
  return combined.slice(-OUTPUT_TAIL_CHARS);
};

const errorMessage = (
  message: string,
  stdoutTail: string,
  stderrTail: string,
  stdinError: Error | null = null
): string => {
  const tail = outputTail(stdoutTail, stderrTail);
  const parts = [message];
  if (stdinError) {
    parts.push(`stdin error: ${stdinError.message}`);
  }
  if (tail !== '') {
    parts.push(`output tail: ${tail}`);
  }
  return parts.join('; ');
};

const writePromptToStdin = (
  child: CodexChildProcess,
  prompt: string,
  recordStdinError: (error: Error) => void
): void => {
  child.stdin.on('error', (error) => {
    recordStdinError(error instanceof Error ? error : new Error(String(error)));
  });

  try {
    child.stdin.write(prompt, (error?: Error | null) => {
      if (error) {
        recordStdinError(error);
      }

      try {
        child.stdin.end();
      } catch (endError) {
        recordStdinError(endError instanceof Error ? endError : new Error(String(endError)));
      }
    });
  } catch (writeError) {
    recordStdinError(writeError instanceof Error ? writeError : new Error(String(writeError)));
    try {
      child.stdin.end();
    } catch (endError) {
      recordStdinError(endError instanceof Error ? endError : new Error(String(endError)));
    }
  }
};

const waitForClose = async (
  child: CodexChildProcess,
  signal: AbortSignal,
  stdoutTailRef: () => string,
  stderrTailRef: () => string,
  getStdinError: () => Error | null
): Promise<void> => {
  let closed = false;
  let abortRequested = signal.aborted;
  let killTimer: ReturnType<typeof setTimeout> | null = null;

  await new Promise<void>((resolve, reject) => {
    const settle = (callback: () => void): void => {
      if (closed) {
        return;
      }
      closed = true;
      if (killTimer) {
        clearTimeout(killTimer);
      }
      signal.removeEventListener('abort', onAbort);
      callback();
    };

    const onAbort = (): void => {
      abortRequested = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        if (!closed) {
          child.kill('SIGKILL');
        }
      }, CODEX_KILL_GRACE_MS);
    };

    child.once('error', (error) => {
      settle(() => {
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });

    child.once('close', (code: number | null) => {
      settle(() => {
        if (abortRequested) {
          reject(createAbortError('Codex CLI analysis aborted'));
          return;
        }

        const stdinError = getStdinError();
        if (code !== 0) {
          reject(
            new Error(
              errorMessage(
                `codex exec failed with exit code ${code ?? 'unknown'}`,
                stdoutTailRef(),
                stderrTailRef(),
                stdinError
              )
            )
          );
          return;
        }

        if (stdinError) {
          reject(
            new Error(
              errorMessage('codex exec stdin failed', stdoutTailRef(), stderrTailRef(), stdinError)
            )
          );
          return;
        }

        resolve();
      });
    });

    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
    }
  });
};

export const analyzeArticleWithCodexCli = async (
  aiConfig: StateAssignerAiConfig,
  stateAssignerDirectories: StateAssignerDirectories,
  promptTemplate: string,
  article: StateAssignerPromptArticle,
  signal: AbortSignal,
  registerCancelableProcess: (handle: CancelableProcessHandle) => void,
  dependencies: AnalyzeArticleWithCodexCliDependencies = {}
): Promise<ChatGptResponse> => {
  if (aiConfig.backend !== 'codex-cli') {
    throw new Error('Codex CLI state assigner client requires the codex-cli backend');
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'state-assigner-codex-'));
  const outputPath = path.join(tempDir, 'last-message.txt');
  await fs.writeFile(outputPath, '', 'utf8');

  try {
    const prompt = buildStateAssignerPrompt(promptTemplate, article);
    const spawn = dependencies.spawn ?? defaultSpawn;
    const child = spawn(
      'codex',
      [
        'exec',
        '--ephemeral',
        '--skip-git-repo-check',
        '-s',
        'read-only',
        '--output-last-message',
        outputPath,
        '-m',
        aiConfig.modelName,
        '-'
      ],
      {
        cwd: os.tmpdir()
      }
    );

    registerCancelableProcess(child);

    let stdoutTail = '';
    let stderrTail = '';
    let stdinError: Error | null = null;

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdoutTail = recordTail(stdoutTail, chunk);
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderrTail = recordTail(stderrTail, chunk);
    });

    writePromptToStdin(child, prompt, (error) => {
      stdinError = error;
    });

    await waitForClose(
      child,
      signal,
      () => stdoutTail,
      () => stderrTail,
      () => stdinError
    );

    let rawContent: string;
    try {
      rawContent = (await fs.readFile(outputPath, 'utf8')).trim();
    } catch (error) {
      throw new Error(
        errorMessage(
          'codex exec output file could not be read',
          stdoutTail,
          stderrTail,
          error instanceof Error ? error : new Error(String(error))
        )
      );
    }

    if (rawContent === '') {
      throw new Error(errorMessage('codex exec produced empty output', stdoutTail, stderrTail));
    }

    try {
      return parseChatGptResponse(rawContent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        errorMessage(
          `codex exec output is not valid state assigner JSON: ${message}; output file tail: ${rawContent.slice(-OUTPUT_TAIL_CHARS)}`,
          stdoutTail,
          stderrTail
        )
      );
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    void stateAssignerDirectories;
  }
};
