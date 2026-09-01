import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { assertNoReportingSecrets, redactForReporting } from './redaction';

export * from './redaction';

export interface WeeklyFlowJournalEvent {
  schemaVersion: 1;
  occurredAt: string;
  runId: number;
  mode: string;
  host: string;
  sourceRevision: string;
  stage: string;
  eventType: string;
  status?: string;
  jobId?: string;
  v02RunId?: number;
  rssArticlesAddedCount?: number;
  cohortArticleCount?: number;
  selectedCount?: number;
  attemptedCount?: number;
  completedCount?: number;
  skippedCount?: number;
  failedCount?: number;
  invalidResponseCount?: number;
  unattemptedCount?: number;
  unresolvedArticleIds?: number[];
  endingReason?: string | null;
  reportPath?: string;
  alertPath?: string;
  path?: string;
}

const assertSafeJournalEvent = (event: WeeklyFlowJournalEvent): void => {
  if (event.schemaVersion !== 1 || !Number.isInteger(event.runId) || event.runId <= 0) {
    throw new Error('invalid weekly-flow journal event');
  }
  const occurredAt = new Date(event.occurredAt);
  if (Number.isNaN(occurredAt.getTime()) || occurredAt.toISOString() !== event.occurredAt) {
    throw new Error('weekly-flow journal timestamp must be UTC ISO 8601');
  }
  assertNoReportingSecrets(event);
};

export const weeklyJournalPath = (directory: string, occurredAt: string): string => {
  const date = occurredAt.slice(0, 10).replaceAll('-', '');
  if (!/^\d{8}$/.test(date)) throw new Error('invalid journal date');
  return path.join(directory, `weekly-flow-${date}.jsonl`);
};

export const appendWeeklyFlowJournal = async (
  directory: string,
  event: WeeklyFlowJournalEvent,
  journalDate: string = event.occurredAt,
  signal?: AbortSignal
): Promise<string> => {
  signal?.throwIfAborted();
  const directoryState = await lstat(directory);
  if (!directoryState.isDirectory() || directoryState.isSymbolicLink()) {
    throw new Error('weekly-flow journal directory must be a real directory');
  }
  const safe = redactForReporting(event) as WeeklyFlowJournalEvent;
  assertSafeJournalEvent(safe);
  const filePath = weeklyJournalPath(directory, journalDate);
  try {
    const fileState = await lstat(filePath);
    if (!fileState.isFile() || fileState.isSymbolicLink()) {
      throw new Error('weekly-flow journal target must be a regular file');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const handle = await open(
    filePath,
    constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600
  );
  try {
    signal?.throwIfAborted();
    await handle.writeFile(`${JSON.stringify(safe)}\n`, { encoding: 'utf8', signal });
    await handle.sync();
    signal?.throwIfAborted();
  } finally {
    await handle.close();
  }
  return filePath;
};
