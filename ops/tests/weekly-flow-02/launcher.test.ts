import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

const opsDirectory = path.resolve(__dirname, '../../..');
const launcherPath = path.join(opsDirectory, 'scripts', 'runWeeklyFlow02.sh');

const writeExecutable = async (filename: string, contents: string): Promise<void> => {
  await writeFile(filename, contents, { mode: 0o700 });
};

const runWithStubs = async (flockExit: number, args: string[] = []) => {
  const fixtureDirectory = await mkdtemp(path.join(os.tmpdir(), 'weekly-flow-launcher-'));
  const invocationPath = path.join(fixtureDirectory, 'node-arguments.txt');
  await writeExecutable(
    path.join(fixtureDirectory, 'flock'),
    `#!/bin/sh\nexit ${flockExit}\n`
  );
  await writeExecutable(
    path.join(fixtureDirectory, 'node'),
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$WEEKLY_FLOW_TEST_INVOCATION"\n'
  );

  const result = spawnSync('sh', [launcherPath, ...args], {
    cwd: opsDirectory,
    env: {
      ...process.env,
      PATH: `${fixtureDirectory}:${process.env.PATH ?? ''}`,
      WEEKLY_FLOW_TEST_INVOCATION: invocationPath
    },
    encoding: 'utf8'
  });

  return { result, invocationPath };
};

describe('weekly-flow-02 Linux launcher', () => {
  it('has valid shell syntax', () => {
    const result = spawnSync('sh', ['-n', launcherPath], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  });

  it('executes Node and forwards arguments unchanged after acquiring the lock', async () => {
    const { result, invocationPath } = await runWithStubs(0, ['--continue-run', '42']);

    assert.equal(result.status, 0, result.stderr);
    const received = (await readFile(invocationPath, 'utf8')).trim().split('\n');
    assert.equal(received[0], path.join(opsDirectory, 'dist', 'weekly-flow-02', 'index.js'));
    assert.deepEqual(received.slice(1), ['--continue-run', '42']);
    assert.match(result.stderr, /lock acquired pid=/);
  });

  it('returns 75 and never starts Node when another process holds the lock', async () => {
    const { result, invocationPath } = await runWithStubs(75);

    assert.equal(result.status, 75);
    assert.match(result.stderr, /another coordinator holds the lock/);
    await assert.rejects(readFile(invocationPath, 'utf8'));
  });

  it('preserves a non-conflict flock error as a guard failure', async () => {
    const { result } = await runWithStubs(74);

    assert.equal(result.status, 74);
    assert.match(result.stderr, /guard failed while acquiring the lock/);
  });
});
