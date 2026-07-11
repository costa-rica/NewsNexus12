import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { analyzeArticleWithCodexCli } from '../../src/modules/state-assigner/codexCliClient';

class FakeCodexChild extends EventEmitter {
  public readonly stdin = new PassThrough();
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public readonly kill = jest.fn(() => true);
  private readonly stdinChunks: Buffer[] = [];

  constructor() {
    super();
    this.stdin.on('data', (chunk: Buffer | string) => {
      this.stdinChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
  }

  get stdinContent(): string {
    return Buffer.concat(this.stdinChunks).toString('utf8');
  }

  close(code: number | null): void {
    this.stdout.end();
    this.stderr.end();
    this.emit('close', code, null);
  }
}

const flush = async (): Promise<void> => {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
};

const waitForSpawn = async (spawn: jest.Mock): Promise<FakeCodexChild> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (spawn.mock.results[0]?.value) {
      return spawn.mock.results[0].value as FakeCodexChild;
    }
    await flush();
  }

  throw new Error('fake spawn was not called');
};

const getOutputPath = (spawn: jest.Mock): string => {
  const args = spawn.mock.calls[0]?.[1] as string[] | undefined;
  if (!args) {
    throw new Error('spawn args missing');
  }
  return args[6];
};

const buildHarness = () => {
  const children: FakeCodexChild[] = [];
  const spawn = jest.fn((_command: string, _args: string[], _options: unknown) => {
    const child = new FakeCodexChild();
    children.push(child);
    return child;
  });
  const registerCancelableProcess = jest.fn();
  const controller = new AbortController();

  const run = (articleContent = 'content') =>
    analyzeArticleWithCodexCli(
      {
        backend: 'codex-cli',
        modelName: 'gpt-5.4-mini',
        codexTimeoutMs: 180_000
      },
      {
        rootDir: '/tmp/state-assigner',
        chatGptResponsesDir: '/tmp/state-assigner/chatgpt_responses',
        promptsDir: '/tmp/state-assigner/prompts'
      },
      'Title: {articleTitle}\nContent: {articleContent}',
      {
        title: 'test title',
        content: articleContent
      },
      controller.signal,
      registerCancelableProcess,
      { spawn: spawn as never }
    );

  return {
    children,
    controller,
    registerCancelableProcess,
    run,
    spawn
  };
};

describe('analyzeArticleWithCodexCli', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('spawns codex with stdin prompt delivery and parses the output file', async () => {
    const harness = buildHarness();
    const promise = harness.run();
    const child = await waitForSpawn(harness.spawn);
    await flush();

    const outputPath = getOutputPath(harness.spawn);
    await fs.writeFile(
      outputPath,
      JSON.stringify({
        occuredInTheUS: true,
        reasoning: 'mentions California',
        state: 'CA'
      }),
      'utf8'
    );

    child.close(0);

    await expect(promise).resolves.toEqual({
      occuredInTheUS: true,
      reasoning: 'mentions California',
      state: 'CA'
    });

    expect(harness.spawn).toHaveBeenCalledWith(
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
        'gpt-5.4-mini',
        '-'
      ],
      {
        cwd: expect.any(String)
      }
    );
    expect(child.stdinContent).toBe('Title: test title\nContent: content');
    expect(harness.registerCancelableProcess).toHaveBeenCalledWith(child);
    await expect(fs.stat(path.dirname(outputPath))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('writes large prompts through stdin instead of argv', async () => {
    const harness = buildHarness();
    const largeContent = 'x'.repeat(300_000);
    const promise = harness.run(largeContent);
    const child = await waitForSpawn(harness.spawn);
    await flush();

    const outputPath = getOutputPath(harness.spawn);
    await fs.writeFile(
      outputPath,
      JSON.stringify({
        occuredInTheUS: false,
        reasoning: 'not in the US'
      }),
      'utf8'
    );
    child.close(0);

    await expect(promise).resolves.toMatchObject({ occuredInTheUS: false });
    expect((harness.spawn.mock.calls[0][1] as string[]).includes(largeContent)).toBe(false);
    expect(child.stdinContent).toContain(largeContent);
  });

  it('rejects non-zero exits with a bounded stderr tail and cleans up temp files', async () => {
    const harness = buildHarness();
    const promise = harness.run();
    const child = await waitForSpawn(harness.spawn);
    await flush();

    const outputPath = getOutputPath(harness.spawn);
    child.stderr.write(`${'a'.repeat(450)}failure tail`);
    child.close(1);

    await expect(promise).rejects.toThrow('codex exec failed with exit code 1');
    await expect(promise).rejects.toThrow('failure tail');
    await expect(fs.stat(path.dirname(outputPath))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects empty output files', async () => {
    const harness = buildHarness();
    const promise = harness.run();
    const child = await waitForSpawn(harness.spawn);
    await flush();

    await fs.writeFile(getOutputPath(harness.spawn), '', 'utf8');
    child.close(0);

    await expect(promise).rejects.toThrow('codex exec produced empty output');
  });

  it('rejects non-JSON output files', async () => {
    const harness = buildHarness();
    const promise = harness.run();
    const child = await waitForSpawn(harness.spawn);
    await flush();

    await fs.writeFile(getOutputPath(harness.spawn), 'not json', 'utf8');
    child.close(0);

    await expect(promise).rejects.toThrow('codex exec output is not valid state assigner JSON');
  });

  it('handles stdin errors as bounded per-article failures', async () => {
    const harness = buildHarness();
    const promise = harness.run();
    const child = await waitForSpawn(harness.spawn);
    await flush();

    const outputPath = getOutputPath(harness.spawn);
    child.stdin.emit('error', new Error('EPIPE'));
    child.stderr.write('codex rejected flags');
    child.close(1);

    await expect(promise).rejects.toThrow('stdin error: EPIPE');
    await expect(promise).rejects.toThrow('codex rejected flags');
    await expect(fs.stat(path.dirname(outputPath))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('sends SIGTERM and escalates to SIGKILL on abort', async () => {
    const harness = buildHarness();
    const promise = harness.run();
    const child = await waitForSpawn(harness.spawn);

    jest.useFakeTimers();
    harness.controller.abort();

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    jest.advanceTimersByTime(5_000);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');

    child.close(0);

    await expect(promise).rejects.toMatchObject({
      name: 'AbortError'
    });
  });
});
