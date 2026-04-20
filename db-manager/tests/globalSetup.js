const { execFileSync } = require('node:child_process');

module.exports = async () => {
  process.env.PG_HOST = process.env.PG_HOST || 'localhost';
  process.env.PG_PORT = process.env.PG_PORT || '5432';
  process.env.PG_DATABASE = process.env.PG_DATABASE || 'newsnexus_test_db_manager';
  process.env.PG_USER = process.env.PG_USER || 'nick';
  process.env.PG_PASSWORD = process.env.PG_PASSWORD || '';
  process.env.PGHOST = process.env.PG_HOST;
  process.env.PGPORT = process.env.PG_PORT;
  process.env.PGUSER = process.env.PG_USER;
  process.env.PGDATABASE = 'postgres';
  process.env.PGPASSWORD = process.env.PG_PASSWORD;

  execFileSync('dropdb', ['--if-exists', process.env.PG_DATABASE], { env: process.env });
  execFileSync('createdb', [process.env.PG_DATABASE], { env: process.env });

  const db = require('@newsnexus/db-models');
  db.initModels();
  await db.sequelize.sync();
  await db.sequelize.close();
};
