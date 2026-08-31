import fs from 'node:fs';
import path from 'node:path';

describe('weekly flow shell wrappers', () => {
  const binDir = path.resolve(__dirname, '../bin');

  it.each(['run-weekly-flow', 'run-dev-canary', 'run-dev-destructive-recovery'])(
    'ships executable %s with safe argument passing',
    (name) => {
      const filePath = path.join(binDir, name);
      const contents = fs.readFileSync(filePath, 'utf8');
      expect(fs.statSync(filePath).mode & 0o111).not.toBe(0);
      expect(contents).toContain('"$@"');
      expect(contents).not.toMatch(/systemctl|crontab|timer/);
    }
  );

  it('uses a fixed absolute nonblocking flock', () => {
    const contents = fs.readFileSync(path.join(binDir, 'run-weekly-flow'), 'utf8');
    expect(contents).toContain('LOCK_FILE="/var/lock/newsnexus12-weekly-article-flow.lock"');
    expect(contents).toContain('flock -n 9');
  });
});
