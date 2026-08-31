const { execFileSync } = require('node:child_process');

module.exports = async () => {
  const database = process.env.PG_DATABASE || 'newsnexus_test_worker_node';
  const env = {
    ...process.env,
    PGHOST: process.env.PG_HOST || 'localhost',
    PGPORT: process.env.PG_PORT || '5432',
    PGUSER: process.env.PG_USER || process.env.USER || 'newsnexus_boot',
    PGDATABASE: 'postgres',
    PGPASSWORD: process.env.PG_PASSWORD || '',
  };
  execFileSync('dropdb', ['--if-exists', '--force', database], { env });
};
