const dbMock = {
  ArticleDuplicateAnalysis: { count: jest.fn() },
  MODEL_LOAD_ORDER: ['Article', 'ArticleDuplicateAnalysis']
};

jest.mock('@newsnexus/db-models', () => dbMock);

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import {
  parseMachineResult,
  runCommand,
  verifyBackupArchive
} from '../src/stages';

const writeBackup = async (directory: string, overrides: Record<string, unknown> = {}): Promise<string> => {
  const articleCsv = Buffer.from('"id"\n1', 'utf8');
  const manifest = {
    version: 1,
    models: [
      {
        modelName: 'Article',
        csvFilename: 'Article.csv',
        rowCount: 1,
        byteSize: articleCsv.byteLength,
        sha256: crypto.createHash('sha256').update(articleCsv).digest('hex')
      },
      {
        modelName: 'ArticleDuplicateAnalysis',
        csvFilename: null,
        rowCount: 0,
        byteSize: null,
        sha256: null
      }
    ],
    ...overrides
  };
  const zip = new AdmZip();
  zip.addFile('Article.csv', articleCsv);
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
  const archivePath = path.join(directory, 'db_backup_202608312359599.zip');
  zip.writeZip(archivePath);
  return archivePath;
};

describe('maintenance safety helpers', () => {
  it('parses exactly one machine-readable command result', () => {
    expect(parseMachineResult('human log\n{"command":"delete_articles","success":true}\n', 'delete_articles'))
      .toEqual({ command: 'delete_articles', success: true });
    expect(() => parseMachineResult('', 'delete_articles')).toThrow('exactly one');
    expect(() => parseMachineResult(
      '{"command":"delete_articles"}\n{"command":"delete_articles"}',
      'delete_articles'
    )).toThrow('found 2');
  });

  it('runs commands without a shell and captures the exit contract', async () => {
    const result = await runCommand({
      command: process.execPath,
      args: ['-e', 'process.stdout.write(JSON.stringify({command:"ok"}) + "\\n")'],
      cwd: process.cwd(),
      timeoutMs: 1000
    });
    expect(result.exitCode).toBe(0);
    expect(parseMachineResult(result.stdout, 'ok')).toEqual({ command: 'ok' });
  });

  it('verifies archive location, membership, sizes, hashes, and cleanup ordering', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'weekly-backup-test-'));
    const archivePath = await writeBackup(directory);
    const evidence = await verifyBackupArchive(archivePath, directory);
    expect(evidence).toMatchObject({ archivePath, manifestVersion: 1 });
    expect(evidence.archiveSize).toBeGreaterThan(0);
    expect(evidence.archiveSha256).toMatch(/^[0-9a-f]{64}$/);
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('rejects incomplete, corrupt, unexpected, and pre-cleanup archives', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'weekly-backup-invalid-'));

    const incomplete = await writeBackup(directory, { models: [] });
    await expect(verifyBackupArchive(incomplete, directory)).rejects.toThrow('membership');

    const zip = new AdmZip();
    zip.addFile('manifest.json', Buffer.from(JSON.stringify({
      version: 1,
      models: [
        { modelName: 'Article', csvFilename: null, rowCount: 0, byteSize: null, sha256: null },
        { modelName: 'ArticleDuplicateAnalysis', csvFilename: 'dup.csv', rowCount: 1, byteSize: 1, sha256: 'bad' }
      ]
    })));
    zip.addFile('dup.csv', Buffer.from('x'));
    zip.addFile('unexpected.txt', Buffer.from('x'));
    const invalidPath = path.join(directory, 'db_backup_202608312359598.zip');
    zip.writeZip(invalidPath);
    await expect(verifyBackupArchive(invalidPath, directory)).rejects.toThrow();

    await expect(verifyBackupArchive(invalidPath, path.join(directory, 'other'))).rejects.toThrow('outside');
    await fs.rm(directory, { recursive: true, force: true });
  });
});
