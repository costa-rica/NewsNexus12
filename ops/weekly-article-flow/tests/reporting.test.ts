import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { appendWeeklyFlowJournal, assertNoReportingSecrets, redactForReporting } from '../src/reporting';

const event = {
  schemaVersion: 1 as const,
  occurredAt: '2026-09-01T00:05:00.000Z',
  runId: 7,
  mode: 'dev_canary',
  host: 'dev-host',
  sourceRevision: 'abc123',
  stage: 'reporting',
  eventType: 'run_terminal',
  status: 'completed'
};

describe('weekly flow JSONL', () => {
  it('appends a complete line, flushes it, and keeps the run-date filename', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'weekly-journal-'));
    const filePath = await appendWeeklyFlowJournal(directory, event, '2026-08-31T23:55:00.000Z');
    await appendWeeklyFlowJournal(directory, { ...event, eventType: 'second' }, '2026-08-31T23:55:00.000Z');
    expect(path.basename(filePath)).toBe('weekly-flow-20260831.jsonl');
    const lines = (await readFile(filePath, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual(event);
  });

  it('rejects a symlink journal target', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'weekly-journal-link-'));
    const target = path.join(directory, 'real.jsonl');
    await symlink(target, path.join(directory, 'weekly-flow-20260831.jsonl'));
    await expect(appendWeeklyFlowJournal(directory, event, '2026-08-31T23:55:00.000Z')).rejects.toThrow();
  });

  it('does not treat missing or corrupt JSONL as recovery authority', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'weekly-journal-corrupt-'));
    const filePath = path.join(directory, 'weekly-flow-20260831.jsonl');
    await writeFile(filePath, 'not-json\n', { mode: 0o600 });

    await expect(
      appendWeeklyFlowJournal(directory, event, '2026-08-31T23:55:00.000Z')
    ).resolves.toBe(filePath);

    const lines = (await readFile(filePath, 'utf8')).trim().split('\n');
    expect(lines[0]).toBe('not-json');
    expect(JSON.parse(lines[1])).toEqual(event);
  });

  it('rejects forbidden reporting keys', () => {
    expect(() => assertNoReportingSecrets({ previewToken: 'forbidden' })).toThrow('forbidden secret');
    expect(() => assertNoReportingSecrets({ articleContent: 'forbidden' })).toThrow('forbidden secret');
    expect(redactForReporting({ endingReason: 'token=forbidden-value' })).toEqual({
      endingReason: 'token=[redacted]'
    });
  });
});
