import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { ArticleDuplicateAnalysis, MODEL_LOAD_ORDER } from '@newsnexus/db-models';
import { CommandResult, parseMachineResult, runCommand } from './commandRunner';

export interface MaintenanceContext {
  repositoryPath: string;
  backupDirectory: string;
  env: NodeJS.ProcessEnv;
}

export interface DuplicateCleanupEvidence {
  command: 'clear_duplicate_analyses';
  success: true;
  beforeCount: number;
  deletedCount: number;
  remainingCount: number;
  batchCount: number;
  durationMs: number;
  exitCode: number;
}

export interface BackupEvidence {
  command: 'create_backup';
  success: true;
  archivePath: string;
  archiveSize: number;
  archiveSha256: string;
  manifestVersion: number;
  durationMs: number;
  exitCode: number;
}

export interface DeleteEvidence {
  command: 'delete_articles';
  success: true;
  foundCount: number;
  deletedCount: number;
  cutoffDate: string;
  durationMs: number;
  exitCode: number;
}

const requireSuccess = (result: CommandResult): void => {
  if (result.exitCode !== 0) {
    throw new Error(`db-manager failed with exit code ${result.exitCode}: ${result.stderr.slice(-500)}`);
  }
};

const dbManagerDirectory = (repositoryPath: string): string => path.join(repositoryPath, 'db-manager');

export const runDuplicateCleanup = async (
  context: MaintenanceContext,
  timeoutMs: number
): Promise<DuplicateCleanupEvidence> => {
  const commandResult = await runCommand({
    command: 'npm',
    args: ['start', '--', '--clear_duplicate_analyses'],
    cwd: dbManagerDirectory(context.repositoryPath),
    env: context.env,
    timeoutMs
  });
  requireSuccess(commandResult);
  const result = parseMachineResult<Omit<DuplicateCleanupEvidence, 'durationMs' | 'exitCode'>>(
    commandResult.stdout,
    'clear_duplicate_analyses'
  );
  const independentlyRemaining = await ArticleDuplicateAnalysis.count();
  if (result.success !== true || result.remainingCount !== 0 || independentlyRemaining !== 0) {
    throw new Error('duplicate cleanup did not satisfy the zero-row postcondition');
  }
  return { ...result, durationMs: commandResult.durationMs, exitCode: commandResult.exitCode };
};

export const duplicateCleanupPostconditionSatisfied = async (): Promise<boolean> =>
  (await ArticleDuplicateAnalysis.count()) === 0;

interface BackupManifestEntry {
  modelName: string;
  csvFilename: string | null;
  rowCount: number;
  byteSize: number | null;
  sha256: string | null;
}

interface BackupManifest {
  version: number;
  models: BackupManifestEntry[];
}

export const verifyBackupArchive = async (
  archivePath: string,
  backupDirectory: string
): Promise<Omit<BackupEvidence, 'command' | 'success' | 'durationMs' | 'exitCode'>> => {
  const resolvedArchive = path.resolve(archivePath);
  const resolvedRoot = `${path.resolve(backupDirectory)}${path.sep}`;
  if (!resolvedArchive.startsWith(resolvedRoot) || path.extname(resolvedArchive) !== '.zip') {
    throw new Error('backup archive is outside the configured backup directory');
  }
  const archiveBuffer = await fs.readFile(resolvedArchive);
  const zip = new AdmZip(archiveBuffer);
  const entries = zip.getEntries();
  const entryNames = new Set(entries.map((entry) => entry.entryName));
  if (!entryNames.has('manifest.json')) {
    throw new Error('backup archive is missing manifest.json');
  }
  const manifest = JSON.parse(zip.readAsText('manifest.json')) as BackupManifest;
  if (manifest.version !== 1 || !Array.isArray(manifest.models)) {
    throw new Error('backup manifest version is unsupported');
  }
  const expectedModels = [...MODEL_LOAD_ORDER].sort();
  const actualModels = manifest.models.map(({ modelName }) => modelName).sort();
  if (JSON.stringify(actualModels) !== JSON.stringify(expectedModels)) {
    throw new Error('backup manifest model membership is incomplete or unexpected');
  }
  let nonemptyModels = 0;
  for (const model of manifest.models) {
    if (model.rowCount === 0) {
      if (model.csvFilename !== null || model.byteSize !== null || model.sha256 !== null) {
        throw new Error(`zero-row manifest entry is invalid: ${model.modelName}`);
      }
      continue;
    }
    nonemptyModels += 1;
    if (!model.csvFilename || !entryNames.has(model.csvFilename)) {
      throw new Error(`backup CSV is missing: ${model.modelName}`);
    }
    const data = zip.readFile(model.csvFilename);
    if (!data || data.byteLength !== model.byteSize) {
      throw new Error(`backup CSV byte size mismatch: ${model.modelName}`);
    }
    const sha256 = crypto.createHash('sha256').update(data).digest('hex');
    if (sha256 !== model.sha256) {
      throw new Error(`backup CSV hash mismatch: ${model.modelName}`);
    }
  }
  const expectedEntries = new Set([
    'manifest.json',
    ...manifest.models.flatMap((model) => model.csvFilename ? [model.csvFilename] : [])
  ]);
  if ([...entryNames].some((name) => !expectedEntries.has(name))) {
    throw new Error('backup archive contains unexpected files');
  }
  if (nonemptyModels === 0) {
    throw new Error('backup archive has no nonempty models');
  }
  const duplicateEntry = manifest.models.find(({ modelName }) => modelName === 'ArticleDuplicateAnalysis');
  if (!duplicateEntry || duplicateEntry.rowCount !== 0) {
    throw new Error('backup was not taken after duplicate-analysis cleanup');
  }
  return {
    archivePath: resolvedArchive,
    archiveSize: archiveBuffer.byteLength,
    archiveSha256: crypto.createHash('sha256').update(archiveBuffer).digest('hex'),
    manifestVersion: manifest.version
  };
};

export const runVerifiedBackup = async (
  context: MaintenanceContext,
  timeoutMs: number
): Promise<BackupEvidence> => {
  const commandResult = await runCommand({
    command: 'npm',
    args: ['start', '--', '--create_backup'],
    cwd: dbManagerDirectory(context.repositoryPath),
    env: { ...context.env, PATH_DB_BACKUPS: context.backupDirectory },
    timeoutMs
  });
  requireSuccess(commandResult);
  const result = parseMachineResult<{ command: string; success: boolean; archivePath: string; manifestVersion: number }>(
    commandResult.stdout,
    'create_backup'
  );
  if (result.success !== true || result.manifestVersion !== 1) {
    throw new Error('db-manager backup result is invalid');
  }
  const verified = await verifyBackupArchive(result.archivePath, context.backupDirectory);
  return {
    command: 'create_backup',
    success: true,
    ...verified,
    durationMs: commandResult.durationMs,
    exitCode: commandResult.exitCode
  };
};

export const reconcileBackupAfterStart = async (
  backupDirectory: string,
  stageStartedAt: Date
): Promise<Omit<BackupEvidence, 'command' | 'success' | 'durationMs' | 'exitCode'>> => {
  const entries = await fs.readdir(backupDirectory, { withFileTypes: true });
  const candidates: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^db_backup_\d{15}\.zip$/.test(entry.name)) {
      continue;
    }
    const candidate = path.join(backupDirectory, entry.name);
    const stats = await fs.stat(candidate);
    if (stats.mtime.getTime() >= stageStartedAt.getTime()) {
      candidates.push(candidate);
    }
  }
  const valid: Array<Omit<BackupEvidence, 'command' | 'success' | 'durationMs' | 'exitCode'>> = [];
  for (const candidate of candidates) {
    try {
      valid.push(await verifyBackupArchive(candidate, backupDirectory));
    } catch {
      // Invalid candidates remain evidence of ambiguity but are not resumable backups.
    }
  }
  if (candidates.length !== 1 || valid.length !== 1) {
    throw new Error('backup recovery evidence is ambiguous');
  }
  return valid[0];
};

export const runOldArticleDeletion = async (
  context: MaintenanceContext,
  timeoutMs: number
): Promise<DeleteEvidence> => {
  const commandResult = await runCommand({
    command: 'npm',
    args: ['start', '--', '--delete_articles'],
    cwd: dbManagerDirectory(context.repositoryPath),
    env: context.env,
    timeoutMs
  });
  requireSuccess(commandResult);
  const result = parseMachineResult<Omit<DeleteEvidence, 'durationMs' | 'exitCode'>>(
    commandResult.stdout,
    'delete_articles'
  );
  if (
    result.success !== true ||
    !Number.isInteger(result.foundCount) ||
    !Number.isInteger(result.deletedCount) ||
    result.foundCount < result.deletedCount ||
    !/^\d{4}-\d{2}-\d{2}$/.test(result.cutoffDate)
  ) {
    throw new Error('db-manager delete result is invalid');
  }
  return { ...result, durationMs: commandResult.durationMs, exitCode: commandResult.exitCode };
};
