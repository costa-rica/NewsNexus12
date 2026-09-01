const runCommand = jest.fn();
jest.mock('../src/stages/commandRunner', () => ({ runCommand }));

import { mkdtemp, readFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  formatWeeklyFlowAlert,
  publishWeeklyFlowAlert,
  stageWeeklyFlowAlert,
  WeeklyFlowAlert
} from '../src/alerts';

const alert = (): WeeklyFlowAlert => ({
  runId: 9,
  status: 'failed',
  host: 'dev-host',
  failedStage: 'ai_approver_v02_execution',
  endingReason: 'token=should-not-appear',
  counts: { failed: 1 },
  unresolvedArticleIds: [7],
  startedAt: '2026-08-31T20:00:00.000Z',
  occurredAt: '2026-08-31T21:00:00.000Z',
  logPath: 'journalctl -u service',
  jsonlPath: '/resources/weekly-flow-20260831.jsonl',
  firstRecoveryAction: 'inspect Postgres evidence'
});

describe('weekly flow alerts', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders required recovery details with secret-like values redacted', () => {
    const markdown = formatWeeklyFlowAlert(alert());
    expect(markdown).toContain('failed stage: ai_approver_v02_execution');
    expect(markdown).toContain('first recovery action: inspect Postgres evidence');
    expect(markdown).not.toContain('should-not-appear');
  });

  it('atomically stages the fixed alert and rejects an existing symlink', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'weekly-alert-'));
    const target = path.join(directory, 'ALERT-newsnexus12-weekly-cron.md');
    await stageWeeklyFlowAlert(target, alert());
    expect(await readFile(target, 'utf8')).toContain('run ID: 9');

    const linked = path.join(directory, 'linked-alert.md');
    await symlink(target, linked);
    await expect(stageWeeklyFlowAlert(linked, alert())).rejects.toThrow('unsafe');
  });

  it('invokes only the fixed root-owned publisher service', async () => {
    runCommand.mockResolvedValue({ exitCode: 0, durationMs: 12 });
    await expect(publishWeeklyFlowAlert(
      'newsnexus12-publish-weekly-alert.service',
      1000,
      { PATH: '/usr/bin' }
    )).resolves.toEqual({ exitCode: 0, durationMs: 12 });
    expect(runCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: '/usr/bin/sudo',
      args: ['-n', '/usr/bin/systemctl', 'start', 'newsnexus12-publish-weekly-alert.service']
    }));
    await expect(publishWeeklyFlowAlert('other.service', 1000)).rejects.toThrow('unapproved');
  });

  it('reports helper failure', async () => {
    runCommand.mockResolvedValue({ exitCode: 1, durationMs: 12 });
    await expect(publishWeeklyFlowAlert(
      'newsnexus12-publish-weekly-alert.service',
      1000
    )).rejects.toThrow('exit code 1');
  });
});
