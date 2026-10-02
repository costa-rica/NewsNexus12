import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { deleteOldArticles } from '../../src/weekly-flow-02/phases/03_deleteOldArticles';
import {
  buildProductionDeleteOldArticlesCommand,
  DeleteOldArticlesError,
  parseDeleteOldArticlesResultLine,
  runDeleteOldArticlesCommand,
  type DeleteOldArticlesCommandSpec,
  type DeleteOldArticlesResult
} from '../../src/weekly-flow-02/phases/03_deleteOldArticlesCommand';

const makeDirectory = (): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-flow-02-delete-test-'));

const successResult = (
  overrides: Partial<DeleteOldArticlesResult> = {}
): DeleteOldArticlesResult => ({
  daysOldThreshold: 180,
  cutoffDate: '2026-04-05',
  eligibleCount: 12,
  processedCount: 12,
  deletedCount: 12,
  ...overrides
});

const successLine = (result: DeleteOldArticlesResult): string =>
  JSON.stringify({ event: 'old_articles_deleted', ...result });

const commandForScript = (
  directory: string,
  script: string,
  env: NodeJS.ProcessEnv = process.env
): DeleteOldArticlesCommandSpec => {
  const scriptPath = path.join(directory, 'fixture.cjs');
  fs.writeFileSync(scriptPath, script);
  return { executable: process.execPath, args: [scriptPath], cwd: directory, env };
};

const expectDeleteError = async (
  operation: Promise<unknown>,
  category: DeleteOldArticlesError['category']
): Promise<DeleteOldArticlesError> => {
  try {
    await operation;
  } catch (error: unknown) {
    assert.ok(error instanceof DeleteOldArticlesError);
    assert.equal(error.category, category);
    return error;
  }
  assert.fail(`Expected ${category} failure`);
};

describe('old-article deletion result contract', () => {
  it('parses one valid result and ignores unrelated or malformed lines', () => {
    const expected = successResult();
    assert.equal(parseDeleteOldArticlesResultLine('ordinary log output'), undefined);
    assert.equal(parseDeleteOldArticlesResultLine('{bad json'), undefined);
    assert.equal(parseDeleteOldArticlesResultLine('{"event":"another_event"}'), undefined);
    assert.deepEqual(parseDeleteOldArticlesResultLine(successLine(expected)), expected);
  });

  it('accepts zero rows and concurrent-disappearance counts', () => {
    for (const expected of [
      successResult({ eligibleCount: 0, processedCount: 0, deletedCount: 0 }),
      successResult({ eligibleCount: 12, processedCount: 8, deletedCount: 7 })
    ]) {
      assert.deepEqual(parseDeleteOldArticlesResultLine(successLine(expected)), expected);
    }
  });

  it('rejects wrong thresholds, invalid dates, invalid types, and invalid count relationships', () => {
    const invalidValues: Record<string, unknown>[] = [
      { ...successResult(), daysOldThreshold: 179 },
      { ...successResult(), cutoffDate: '2026-02-30' },
      { ...successResult(), cutoffDate: '04-05-2026' },
      { ...successResult(), eligibleCount: -1 },
      { ...successResult(), eligibleCount: 1.5 },
      { ...successResult(), eligibleCount: '12' },
      { ...successResult(), processedCount: -1 },
      { ...successResult(), processedCount: Number.MAX_SAFE_INTEGER + 1 },
      { ...successResult(), deletedCount: -1 },
      { ...successResult(), deletedCount: 1.5 },
      { ...successResult(), eligibleCount: 5, processedCount: 6, deletedCount: 5 },
      { ...successResult(), eligibleCount: 5, processedCount: 4, deletedCount: 5 }
    ];

    for (const value of invalidValues) {
      assert.throws(
        () =>
          parseDeleteOldArticlesResultLine(
            JSON.stringify({ event: 'old_articles_deleted', ...value })
          ),
        (error: unknown) =>
          error instanceof DeleteOldArticlesError && error.category === 'output_contract'
      );
    }
  });
});

describe('production old-article deletion command', () => {
  it('uses the fixed compiled entry point, working directory, and only argument', () => {
    const command = buildProductionDeleteOldArticlesCommand(
      { PATH: '/bin', HOME: '/tmp/home' },
      '/repo/ops'
    );
    assert.equal(command.executable, process.execPath);
    assert.deepEqual(command.args, ['/repo/db-manager/dist/index.js', '--delete_articles']);
    assert.equal(command.cwd, '/repo/db-manager');
  });
});

describe('runDeleteOldArticlesCommand', () => {
  it('uses the code-only command seam through the public phase function', async () => {
    const directory = makeDirectory();
    try {
      const expected = successResult();
      const command = commandForScript(
        directory,
        `console.log('starting deletion'); console.log(${JSON.stringify(successLine(expected))});`
      );
      assert.deepEqual(
        await deleteOldArticles({ dbManagerDeleteArticlesTimeoutSeconds: 2 }, command),
        expected
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('parses a final result without a trailing newline', async () => {
    const directory = makeDirectory();
    try {
      const expected = successResult();
      const command = commandForScript(
        directory,
        `process.stdout.write(${JSON.stringify(successLine(expected))});`
      );
      assert.deepEqual(await runDeleteOldArticlesCommand(command, 2), expected);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('parses split chunks safely across a UTF-8 boundary', async () => {
    const directory = makeDirectory();
    try {
      const expected = successResult();
      const line = successLine(expected);
      const splitAt = Math.floor(line.length / 2);
      const script = [
        "const emoji = Buffer.from('🙂');",
        'process.stdout.write(emoji.subarray(0, 2));',
        'setTimeout(() => {',
        '  process.stdout.write(emoji.subarray(2));',
        "  process.stdout.write(' unrelated\\n');",
        `  process.stdout.write(${JSON.stringify(line.slice(0, splitAt))});`,
        `  setTimeout(() => process.stdout.write(${JSON.stringify(line.slice(splitAt))}), 5);`,
        '}, 5);'
      ].join('\n');
      assert.deepEqual(
        await runDeleteOldArticlesCommand(commandForScript(directory, script), 2),
        expected
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('drains output beyond both diagnostic caps before and after success', async () => {
    const directory = makeDirectory();
    try {
      const expected = successResult();
      const script = [
        "const noisyLine = 'x'.repeat(1024) + '\\n';",
        'for (let i = 0; i < 40; i += 1) { process.stdout.write(noisyLine); process.stderr.write(noisyLine); }',
        `process.stdout.write(${JSON.stringify(`${successLine(expected)}\n`)});`,
        'for (let i = 0; i < 40; i += 1) { process.stdout.write(noisyLine); process.stderr.write(noisyLine); }'
      ].join('\n');
      assert.deepEqual(
        await runDeleteOldArticlesCommand(commandForScript(directory, script), 3),
        expected
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects missing, duplicate, malformed, incorrectly typed, and oversized results', async () => {
    const directory = makeDirectory();
    try {
      const expected = successResult();
      const scripts = [
        "console.log('no result');",
        `console.log(${JSON.stringify(successLine(expected))}); console.log(${JSON.stringify(successLine(expected))});`,
        "console.log('{\"event\":\"old_articles_deleted\"');",
        `console.log(${JSON.stringify(
          JSON.stringify({ event: 'old_articles_deleted', ...expected, deletedCount: '12' })
        )});`,
        `process.stdout.write('x'.repeat(70 * 1024) + '\\n'); console.log(${JSON.stringify(
          successLine(expected)
        )});`
      ];
      for (const script of scripts) {
        await expectDeleteError(
          runDeleteOldArticlesCommand(commandForScript(directory, script), 2),
          'output_contract'
        );
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects spawn failures, nonzero exits after success, and signal exits', async () => {
    const directory = makeDirectory();
    try {
      const expected = successResult();
      await expectDeleteError(
        runDeleteOldArticlesCommand(
          { executable: path.join(directory, 'missing-node'), args: [], cwd: directory, env: {} },
          2
        ),
        'spawn'
      );
      await expectDeleteError(
        runDeleteOldArticlesCommand(
          commandForScript(
            directory,
            `console.log(${JSON.stringify(successLine(expected))}); process.exitCode = 7;`
          ),
          2
        ),
        'exit'
      );
      await expectDeleteError(
        runDeleteOldArticlesCommand(
          commandForScript(directory, "process.kill(process.pid, 'SIGTERM');"),
          2
        ),
        'exit'
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('times out, sends SIGTERM, and force-kills an uncooperative child', async () => {
    const directory = makeDirectory();
    try {
      const command = commandForScript(
        directory,
        "process.on('SIGTERM', () => {}); setInterval(() => process.stdout.write('waiting\\n'), 5);"
      );
      const startedAt = Date.now();
      await expectDeleteError(runDeleteOldArticlesCommand(command, 0.05, undefined, 20), 'timeout');
      assert.ok(Date.now() - startedAt < 2_000);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps failure text bounded and excludes environment values', async () => {
    const directory = makeDirectory();
    try {
      const sentinel = 'private-database-password';
      const command = commandForScript(
        directory,
        `process.stderr.write(${JSON.stringify(sentinel.repeat(10_000))}); process.exit(3);`,
        { ...process.env, PGPASSWORD: sentinel }
      );
      const error = await expectDeleteError(runDeleteOldArticlesCommand(command, 2), 'exit');
      assert.ok(error.message.length < 220);
      assert.ok(!error.message.includes(sentinel));
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
