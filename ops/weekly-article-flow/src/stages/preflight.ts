import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  AiApproverPromptVersionV02,
  initModels,
  sequelize
} from '@newsnexus/db-models';
import { WeeklyFlowCliOptions, WeeklyFlowConfig } from '../config';
import { WorkerHttpClient } from '../http';
import { assertProductionIdentity } from '../productionIdentity';
import { runCommand } from './commandRunner';

export interface PreflightEvidence {
  host: string;
  databaseName: string;
  databaseUser: string;
  sourceRevision: string;
  repositoryPath: string;
  minimumFreeDiskBytes: number;
  availableDiskBytes: number;
  activePromptVersionId: number;
  checkedAt: string;
}

export interface PreflightDependencies {
  env?: NodeJS.ProcessEnv;
  hostname?: () => string;
  username?: () => string;
  access?: typeof fs.access;
  stat?: typeof fs.stat;
  statfs?: typeof fs.statfs;
  workerClient: WorkerHttpClient;
  authenticateDb?: () => Promise<void>;
  loadActivePromptIds?: () => Promise<number[]>;
  resolveRevision?: () => Promise<string>;
}

const assertFile = async (filePath: string, stat: typeof fs.stat): Promise<void> => {
  const value = await stat(filePath);
  if (!value.isFile()) {
    throw new Error(`required file is not a regular file: ${filePath}`);
  }
};

const assertDirectory = async (directoryPath: string, stat: typeof fs.stat): Promise<void> => {
  const value = await stat(directoryPath);
  if (!value.isDirectory()) {
    throw new Error(`required path is not a directory: ${directoryPath}`);
  }
};

const findExecutable = async (
  name: string,
  executablePath: string,
  access: typeof fs.access
): Promise<string | null> => {
  const pathEntries = executablePath.split(path.delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = path.join(entry, name);
    try {
      await access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Continue through the fixed PATH entries.
    }
  }
  return null;
};

export const runPreflight = async (
  config: WeeklyFlowConfig,
  options: WeeklyFlowCliOptions,
  dependencies: PreflightDependencies
): Promise<PreflightEvidence> => {
  const env = dependencies.env ?? process.env;
  const hostname = dependencies.hostname ?? os.hostname;
  const username = dependencies.username ?? (() => os.userInfo().username);
  const access = dependencies.access ?? fs.access;
  const stat = dependencies.stat ?? fs.stat;
  const statfs = dependencies.statfs ?? fs.statfs;
  const host = hostname();
  const databaseName = env.PG_DATABASE?.trim() ?? '';
  const databaseUser = env.PG_USER?.trim() ?? '';
  assertProductionIdentity(options.mode, username(), databaseUser);
  if (!options.allowLiveAi) {
    throw new Error('explicit live-AI permission is required for the weekly flow');
  }

  await assertDirectory(config.repositoryPath, stat);
  await assertDirectory(config.resourcesPath, stat);
  await assertDirectory(config.backupDirectory, stat);
  await assertDirectory(config.journalDirectory, stat);
  await assertFile(config.rssSpreadsheetPath, stat);
  await assertDirectory(config.semanticDirectory, stat);
  await assertFile(path.join(config.semanticDirectory, 'NewsNexusSemanticScorerKeywords.xlsx'), stat);
  await assertDirectory(config.stateFilesPath, stat);
  await assertDirectory(path.join(config.stateFilesPath, 'prompts'), stat);
  await access(config.journalDirectory, fs.constants.W_OK);
  await access(config.backupDirectory, fs.constants.W_OK);

  const playwrightCandidates = [
    path.join(config.repositoryPath, 'worker-node', 'node_modules', '.bin', 'playwright'),
    path.join(config.repositoryPath, 'node_modules', '.bin', 'playwright')
  ];
  let playwrightBinary: string | null = null;
  for (const candidate of playwrightCandidates) {
    try {
      await access(candidate, fs.constants.X_OK);
      playwrightBinary = candidate;
      break;
    } catch {
      // npm may install workspace binaries locally or hoist them to the repository root.
    }
  }
  if (!playwrightBinary) {
    throw new Error(`Playwright CLI was not found in the worker or repository node_modules: ${playwrightCandidates.join(', ')}`);
  }
  if (!await findExecutable('codex', env.PATH ?? '', access)) {
    throw new Error('codex CLI was not found on PATH');
  }

  const disk = await statfs(config.resourcesPath);
  const availableDiskBytes = Number(disk.bavail) * Number(disk.bsize);
  if (availableDiskBytes < config.minimumFreeDiskBytes) {
    throw new Error('available disk space is below the configured minimum');
  }

  await dependencies.workerClient.requestJson('node', '/health');
  if (!options.resumeRunId) {
    if (!await dependencies.workerClient.isQueueIdle('node')) {
      throw new Error('worker-node queue is not idle');
    }
    if (!await dependencies.workerClient.isQueueIdle('python')) {
      throw new Error('worker-python queue is not idle');
    }
    const latestV02 = await dependencies.workerClient.requestJson<{ status?: string } | null>(
      'python',
      '/ai-approver-v02/runs/latest'
    );
    if (latestV02 && ['queued', 'running'].includes(String(latestV02.status))) {
      throw new Error('an AI Approver V02 execution is already active');
    }
  }

  const authenticateDb = dependencies.authenticateDb ?? (async () => {
    initModels();
    await sequelize.authenticate();
  });
  await authenticateDb();
  const activePromptIds = dependencies.loadActivePromptIds ?? (async () => {
    const prompts = await AiApproverPromptVersionV02.findAll({ where: { isActive: true } });
    return prompts.map(({ id }) => id);
  });
  const promptIds = await activePromptIds();
  if (promptIds.length !== 1) {
    throw new Error('exactly one active AI Approver V02 prompt is required');
  }

  const resolveRevision = dependencies.resolveRevision ?? (async () => {
    const result = await runCommand({
      command: 'git',
      args: ['rev-parse', 'HEAD'],
      cwd: config.repositoryPath,
      timeoutMs: 10_000
    });
    if (result.exitCode !== 0) return '';
    return result.stdout.trim();
  });
  const sourceRevision = await resolveRevision();
  if (!/^[0-9a-f]{40}$/.test(sourceRevision)) {
    throw new Error('unable to resolve the repository source revision');
  }

  return {
    host,
    databaseName,
    databaseUser: databaseUser || username(),
    sourceRevision,
    repositoryPath: config.repositoryPath,
    minimumFreeDiskBytes: config.minimumFreeDiskBytes,
    availableDiskBytes,
    activePromptVersionId: promptIds[0],
    checkedAt: new Date().toISOString()
  };
};
