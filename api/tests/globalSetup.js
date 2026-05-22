const path = require('node:path');
const { execFileSync } = require('node:child_process');

require('dotenv').config({
  path: path.resolve(__dirname, '../../db-manager/.env'),
});

const REQUIRED_TEST_DB_VARS = ['PG_HOST', 'PG_PORT', 'PG_USER', 'PG_SCHEMA'];

module.exports = async () => {
  const missing = REQUIRED_TEST_DB_VARS.filter((name) => {
    const value = process.env[name];
    return !value || value.trim() === '';
  });
  if (missing.length > 0) {
    throw new Error(
      `Missing required test DB env var(s) from db-manager/.env: ${missing.join(', ')}`,
    );
  }

  process.env.PG_DATABASE = 'newsnexus_test_api';
  process.env.PGHOST = process.env.PG_HOST;
  process.env.PGPORT = process.env.PG_PORT;
  process.env.PGUSER = process.env.PG_USER;
  process.env.PGDATABASE = 'postgres';
  process.env.PGPASSWORD = process.env.PG_PASSWORD ?? '';

  execFileSync(
    'dropdb',
    ['--if-exists', '-U', process.env.PG_USER, process.env.PG_DATABASE],
    { env: process.env },
  );
  execFileSync(
    'createdb',
    ['-U', process.env.PG_USER, process.env.PG_DATABASE],
    { env: process.env },
  );

  const db = require('@newsnexus/db-models');
  db.initModels();
  await db.sequelize.sync();
  await db.sequelize.close();
};
