import fs from 'node:fs';
import path from 'node:path';

describe('weekly flow operational assets', () => {
  const packageDir = path.resolve(__dirname, '..');
  const read = (relativePath: string): string =>
    fs.readFileSync(path.join(packageDir, relativePath), 'utf8');

  it('ships a fixed production service with the required runtime boundary', () => {
    const unit = read('systemd/newsnexus12-weekly-article-flow.service');
    expect(unit).toContain('User=limited_user');
    expect(unit).toContain('Group=limited_user');
    expect(unit).toContain('WorkingDirectory=/home/limited_user/applications/NewsNexus12');
    expect(unit).toContain('EnvironmentFile=/etc/newsnexus12/weekly-article-flow.env');
    expect(unit).toContain(
      'ExecStart=/home/limited_user/applications/NewsNexus12/ops/weekly-article-flow/bin/run-weekly-flow --mode scheduled_production --allow-live-ai'
    );
    expect(unit).toContain('TimeoutStartSec=73h');
    expect(unit).toContain('StandardOutput=journal');
    expect(unit).toContain('StandardError=journal');
  });

  it('ships the fixed Pacific Friday timer with persistence', () => {
    const timer = read('systemd/newsnexus12-weekly-article-flow.timer');
    expect(timer).toContain('OnCalendar=Fri *-*-* 05:00:00 America/Los_Angeles');
    expect(timer).toContain('Persistent=true');
    expect(timer).toContain('Unit=newsnexus12-weekly-article-flow.service');
  });

  it('scopes alert publication to a fixed service and argument-free helper', () => {
    const unit = read('systemd/newsnexus12-publish-weekly-alert.service');
    const helper = read('libexec/newsnexus12-publish-weekly-alert');
    const sudoers = read('sudoers/newsnexus12-publish-weekly-alert').trim();

    expect(unit).toContain('User=root');
    expect(unit).toContain('ExecStart=/usr/local/libexec/newsnexus12-publish-weekly-alert');
    expect(helper).toContain('if [[ "$#" -ne 0 ]]');
    expect(helper).toContain('/home/nick/.npm-global/bin/ob');
    expect(helper.match(/sync --path "\$\{VAULT_ROOT\}"/g)).toHaveLength(2);
    expect(helper).toContain('STAGED_ALERT="/home/limited_user/project_resources/NewsNexus12/weekly-flow/ALERT-newsnexus12-weekly-cron.md"');
    expect(helper).toContain('DESTINATION="${VAULT_ROOT}/ALERT-newsnexus12-weekly-cron.md"');
    expect(helper).toContain('"${RUNUSER}" --user nick -- /bin/mv');
    expect(sudoers).toBe(
      'limited_user ALL=(root) NOPASSWD: /usr/bin/systemctl start newsnexus12-publish-weekly-alert.service'
    );
  });

  it('keeps development helper-only and schedule activation separate', () => {
    const installer = read('install.sh');
    expect(installer).toContain('development:--install-helper');
    expect(installer).toContain('development:--install-assets|development:--enable-timer');
    expect(installer).toContain('production:--install-assets');
    expect(installer).toContain('systemctl disable --now newsnexus12-weekly-article-flow.timer');
    expect(installer).toContain('production:--enable-timer');
    expect(installer).toContain('systemctl enable --now newsnexus12-weekly-article-flow.timer');
  });

  it('checks the read-only configuration wrapper as a source asset', () => {
    const installer = read('install.sh');
    expect(installer).toContain('"${SCRIPT_DIR}/bin/run-config-check"; do');
    expect(installer).toContain('/bin/bash -n "${SCRIPT_DIR}/bin/run-config-check"');
  });

  it('limits uninstall to fixed assets and preserves operational data', () => {
    const uninstaller = read('uninstall.sh');
    expect(uninstaller).toContain('uninstall.sh --confirm');
    expect(uninstaller).not.toMatch(/project_resources|NickVault|WeeklyArticleFlowRuns|dropdb|psql/);
    expect(uninstaller).toContain('database records, JSONL, alerts, backups, environment configuration, and unrelated schedules were preserved');
  });
});
