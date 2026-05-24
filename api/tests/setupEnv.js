const path = require('node:path');

require('dotenv').config({
  path: path.resolve(__dirname, '../../db-manager/.env'),
});

const REQUIRED_TEST_DB_VARS = ['PG_HOST', 'PG_PORT', 'PG_USER', 'PG_SCHEMA'];

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
process.env.PG_PASSWORD = process.env.PG_PASSWORD ?? '';
process.env.NAME_APP = process.env.NAME_APP || 'newsnexus12api-test';
process.env.PATH_TO_LOGS = process.env.PATH_TO_LOGS || '/tmp/newsnexus12-api-test-logs';
process.env.PATH_TO_UTILITIES_ANALYSIS_SPREADSHEETS =
  process.env.PATH_TO_UTILITIES_ANALYSIS_SPREADSHEETS || '/tmp';
