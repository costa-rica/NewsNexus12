import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  buildDbManagerEnvironment,
  buildProductionBackupCommand,
  CreateDatabaseBackupError,
  parseDatabaseBackupResultLine,
  runDatabaseBackupCommand,
  verifyBackupArtifact,
  type BackupCommandSpec,
  type CreateDatabaseBackupResult
} from '../../src/weekly-flow-02/phases/02_createDatabaseBackupCommand';

const sha256 = (contents: Buffer): string =>
  crypto.createHash('sha256').update(contents).digest('hex');

const makeDirectory = (): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-flow-02-backup-test-'));

const makeArtifact = (
  directory: string,
  contents = Buffer.from('verified backup fixture')
): CreateDatabaseBackupResult => {
  const backupPath = path.join(directory, 'backup.zip');
  fs.writeFileSync(backupPath, contents);
  return {
    backupPath,
    byteSize: contents.byteLength,
    sha256: sha256(contents),
    manifestVersion: 1
  };
};

const successLine = (result: CreateDatabaseBackupResult): string =>
  JSON.stringify({ event: 'database_backup_created', ...result });

const commandForScript = (
  directory: string,
  script: string,
  env: NodeJS.ProcessEnv = process.env
): BackupCommandSpec => {
  const scriptPath = path.join(directory, 'fixture.cjs');
  fs.writeFileSync(scriptPath, script);
  return { executable: process.execPath, args: [scriptPath], cwd: directory, env };
};

const expectBackupError = async (
  operation: Promise<unknown>,
  category: CreateDatabaseBackupError['category']
): Promise<CreateDatabaseBackupError> => {
  try {
    await operation;
  } catch (error: unknown) {
    assert.ok(error instanceof CreateDatabaseBackupError);
    assert.equal(error.category, category);
    return error;
  }
  assert.fail(`Expected ${category} failure`);
};

describe('database backup result contract', () => {
  it('parses one valid result and ignores unrelated or malformed lines', () => {
    const directory = makeDirectory();
    try {
      const expected = makeArtifact(directory);
      assert.equal(parseDatabaseBackupResultLine('ordinary log output'), undefined);
      assert.equal(parseDatabaseBackupResultLine('{bad json'), undefined);
      assert.equal(parseDatabaseBackupResultLine('{"event":"another_event"}'), undefined);
      assert.deepEqual(parseDatabaseBackupResultLine(successLine(expected)), expected);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects incorrectly typed success results', () => {
    const directory = makeDirectory();
    try {
      const valid = makeArtifact(directory);
      const invalidValues: Record<string, unknown>[] = [
        { ...valid, backupPath: 'relative.zip' },
        { ...valid, backupPath: '' },
        { ...valid, byteSize: 0 },
        { ...valid, byteSize: 1.5 },
        { ...valid, byteSize: '10' },
        { ...valid, sha256: 'A'.repeat(64) },
        { ...valid, sha256: 'a'.repeat(63) },
        { ...valid, manifestVersion: 2 }
      ];
      for (const value of invalidValues) {
        assert.throws(
          () => parseDatabaseBackupResultLine(JSON.stringify({ event: 'database_backup_created', ...value })),
          (error: unknown) =>
            error instanceof CreateDatabaseBackupError && error.category === 'output_contract'
        );
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('production backup command', () => {
  it('uses the fixed compiled entry point, working directory, and argument', () => {
    const command = buildProductionBackupCommand({ PATH: '/bin', HOME: '/tmp/home' }, '/repo/ops');
    assert.equal(command.executable, process.execPath);
    assert.deepEqual(command.args, ['/repo/db-manager/dist/index.js', '--create_backup']);
    assert.equal(command.cwd, '/repo/db-manager');
  });

  it('removes ops and PG values while preserving ordinary environment values', () => {
    const removedKeys = [
      'NODE_ENV',
      'NAME_APP',
      'NEXT_PUBLIC_MODE',
      'URL_BASE_NEWS_NEXUS_PYTHON_QUEUER',
      'WORKER_PYTHON_REQUEST_TIMEOUT_SECONDS',
      'DB_MANAGER_BACKUP_TIMEOUT_SECONDS',
      'PATH_TO_LOGS',
      'LOG_MAX_SIZE',
      'LOG_MAX_FILES',
      'PATH_DB_BACKUPS',
      'PG_HOST',
      'PG_PASSWORD',
      'PG_CUSTOM_SENTINEL'
    ];
    const source = Object.fromEntries(removedKeys.map((key) => [key, `secret-${key}`]));
    const result = buildDbManagerEnvironment({
      ...source,
      PATH: '/usr/bin',
      HOME: '/home/operator',
      LANG: 'en_US.UTF-8',
      TMPDIR: '/tmp',
      NODE_OPTIONS: '--no-warnings'
    });

    for (const key of removedKeys) assert.equal(result[key], undefined);
    assert.equal(result.PATH, '/usr/bin');
    assert.equal(result.HOME, '/home/operator');
    assert.equal(result.LANG, 'en_US.UTF-8');
    assert.equal(result.TMPDIR, '/tmp');
    assert.equal(result.NODE_OPTIONS, '--no-warnings');
  });
});

describe('runDatabaseBackupCommand', () => {
  it('uses the code-only command seam and accepts unrelated output', async () => {
    const directory = makeDirectory();
    try {
      const expected = makeArtifact(directory);
      const command = commandForScript(
        directory,
        `console.log('starting backup');\nconsole.log(${JSON.stringify(successLine(expected))});\nconsole.error('done');\n`
      );
      assert.deepEqual(await runDatabaseBackupCommand(command, 2), expected);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('parses split chunks safely across a UTF-8 boundary', async () => {
    const directory = makeDirectory();
    try {
      const expected = makeArtifact(directory);
      const line = successLine(expected);
      const splitAt = Math.floor(line.length / 2);
      const script = [
        "const emoji = Buffer.from('🙂');",
        'process.stdout.write(emoji.subarray(0, 2));',
        "setTimeout(() => {",
        "  process.stdout.write(emoji.subarray(2));",
        "  process.stdout.write(' unrelated\\n');",
        `  process.stdout.write(${JSON.stringify(line.slice(0, splitAt))});`,
        `  setTimeout(() => process.stdout.write(${JSON.stringify(line.slice(splitAt))}), 5);`,
        '}, 5);'
      ].join('\n');
      assert.deepEqual(
        await runDatabaseBackupCommand(commandForScript(directory, script), 2),
        expected
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('drains output beyond both diagnostic caps before and after success', async () => {
    const directory = makeDirectory();
    try {
      const expected = makeArtifact(directory);
      const script = [
        "const noisyLine = 'x'.repeat(1024) + '\\n';",
        'for (let i = 0; i < 40; i += 1) { process.stdout.write(noisyLine); process.stderr.write(noisyLine); }',
        `process.stdout.write(${JSON.stringify(`${successLine(expected)}\n`)});`,
        'for (let i = 0; i < 40; i += 1) { process.stdout.write(noisyLine); process.stderr.write(noisyLine); }'
      ].join('\n');
      assert.deepEqual(
        await runDatabaseBackupCommand(commandForScript(directory, script), 3),
        expected
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects missing, duplicate, malformed, and oversized output', async () => {
    const directory = makeDirectory();
    try {
      const expected = makeArtifact(directory);
      const scripts = [
        "console.log('no result');",
        `console.log(${JSON.stringify(successLine(expected))}); console.log(${JSON.stringify(successLine(expected))});`,
        "console.log('{\"event\":\"database_backup_created\"');",
        `process.stdout.write('x'.repeat(70 * 1024) + '\\n'); console.log(${JSON.stringify(successLine(expected))});`
      ];
      for (const script of scripts) {
        await expectBackupError(
          runDatabaseBackupCommand(commandForScript(directory, script), 2),
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
      const expected = makeArtifact(directory);
      await expectBackupError(
        runDatabaseBackupCommand(
          { executable: path.join(directory, 'missing-node'), args: [], cwd: directory, env: {} },
          2
        ),
        'spawn'
      );
      await expectBackupError(
        runDatabaseBackupCommand(
          commandForScript(
            directory,
            `console.log(${JSON.stringify(successLine(expected))}); process.exitCode = 7;`
          ),
          2
        ),
        'exit'
      );
      await expectBackupError(
        runDatabaseBackupCommand(
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
      await expectBackupError(runDatabaseBackupCommand(command, 0.05, undefined, 20), 'timeout');
      assert.ok(Date.now() - startedAt < 2_000);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps failure messages bounded and excludes child environment values', async () => {
    const directory = makeDirectory();
    try {
      const sentinel = 'private-database-password';
      const command = commandForScript(
        directory,
        `process.stderr.write(${JSON.stringify(sentinel.repeat(10_000))}); process.exit(3);`,
        { ...process.env, PGPASSWORD: sentinel }
      );
      const error = await expectBackupError(runDatabaseBackupCommand(command, 2), 'exit');
      assert.ok(error.message.length < 200);
      assert.ok(!error.message.includes(sentinel));
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('verifyBackupArtifact', () => {
  it('accepts a matching regular nonempty file', async () => {
    const directory = makeDirectory();
    try {
      const expected = makeArtifact(directory);
      assert.deepEqual(await verifyBackupArtifact(expected), expected);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects missing, directory, empty, size-mismatched, and hash-mismatched paths', async () => {
    const directory = makeDirectory();
    try {
      const valid = makeArtifact(directory);
      const emptyPath = path.join(directory, 'empty.zip');
      fs.writeFileSync(emptyPath, '');
      const cases: CreateDatabaseBackupResult[] = [
        { ...valid, backupPath: path.join(directory, 'missing.zip') },
        { ...valid, backupPath: directory },
        { ...valid, backupPath: emptyPath, byteSize: 1 },
        { ...valid, byteSize: valid.byteSize + 1 },
        { ...valid, sha256: '0'.repeat(64) }
      ];
      for (const candidate of cases) {
        await expectBackupError(verifyBackupArtifact(candidate), 'artifact_verification');
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
