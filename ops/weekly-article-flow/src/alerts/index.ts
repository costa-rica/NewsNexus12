import { lstat, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { runCommand } from '../stages/commandRunner';

export interface WeeklyFlowAlert {
  runId: number;
  status: string;
  host: string;
  failedStage: string;
  endingReason: string;
  counts: Record<string, number>;
  unresolvedArticleIds: number[];
  startedAt: string;
  occurredAt: string;
  logPath: string;
  jsonlPath: string | null;
  firstRecoveryAction: string;
}

const safeText = (value: string, maximum = 500): string => value
  .replace(/[\u0000-\u001f\u007f]+/g, ' ')
  .replace(/(token|secret|password|authorization|api[_-]?key)\s*[:=]\s*\S+/gi, '$1=[redacted]')
  .slice(0, maximum);

export const formatWeeklyFlowAlert = (alert: WeeklyFlowAlert): string => [
  '# NewsNexus12 weekly flow alert',
  '',
  `- run ID: ${alert.runId}`,
  `- status: ${safeText(alert.status, 100)}`,
  `- host: ${safeText(alert.host, 255)}`,
  `- failed stage: ${safeText(alert.failedStage, 128)}`,
  `- ending reason: ${safeText(alert.endingReason)}`,
  `- started at: ${alert.startedAt}`,
  `- occurred at: ${alert.occurredAt}`,
  `- counts: ${Object.entries(alert.counts).map(([key, value]) => `${safeText(key, 50)}=${value}`).join(', ') || 'none'}`,
  `- unresolved article IDs: ${alert.unresolvedArticleIds.join(', ') || 'none'}`,
  `- log path: ${safeText(alert.logPath)}`,
  `- JSONL path: ${safeText(alert.jsonlPath ?? 'unavailable')}`,
  `- first recovery action: ${safeText(alert.firstRecoveryAction)}`,
  ''
].join('\n');

export const stageWeeklyFlowAlert = async (
  targetPath: string,
  alert: WeeklyFlowAlert,
  signal?: AbortSignal
): Promise<void> => {
  signal?.throwIfAborted();
  const directory = path.dirname(targetPath);
  const directoryState = await lstat(directory);
  if (!directoryState.isDirectory() || directoryState.isSymbolicLink()) {
    throw new Error('weekly-flow alert directory must be a real directory');
  }
  try {
    const targetState = await lstat(targetPath);
    if (!targetState.isFile() || targetState.isSymbolicLink()) throw new Error('weekly-flow alert target is unsafe');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporaryPath = path.join(directory, `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`);
  let handle;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(formatWeeklyFlowAlert(alert), { encoding: 'utf8', signal });
    await handle.sync();
    signal?.throwIfAborted();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, targetPath);
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
};

export const publishWeeklyFlowAlert = async (
  serviceName: string,
  timeoutMs: number,
  env: NodeJS.ProcessEnv = process.env,
  signal?: AbortSignal
): Promise<{ exitCode: number; durationMs: number }> => {
  if (serviceName !== 'newsnexus12-publish-weekly-alert.service') {
    throw new Error('refusing to invoke an unapproved alert publisher service');
  }
  const result = await runCommand({
    command: '/usr/bin/sudo',
    args: ['-n', '/usr/bin/systemctl', 'start', 'newsnexus12-publish-weekly-alert.service'],
    timeoutMs,
    cwd: '/',
    env,
    signal
  });
  if (result.exitCode !== 0) throw new Error(`weekly alert publisher failed with exit code ${result.exitCode}`);
  return { exitCode: result.exitCode, durationMs: result.durationMs };
};
