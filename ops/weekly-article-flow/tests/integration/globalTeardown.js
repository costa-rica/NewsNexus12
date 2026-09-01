const { execFileSync } = require('node:child_process');

module.exports = async () => {
  process.env.PGHOST = process.env.PG_HOST || 'localhost';
  process.env.PGPORT = process.env.PG_PORT || '5432';
  process.env.PGUSER = process.env.PG_USER || process.env.USER || 'newsnexus_boot';
  process.env.PGDATABASE = 'postgres';
  process.env.PGPASSWORD = process.env.PG_PASSWORD || '';

  execFileSync('dropdb', ['--if-exists', 'newsnexus_test_weekly_coordinator'], {
    env: process.env
  });
};
