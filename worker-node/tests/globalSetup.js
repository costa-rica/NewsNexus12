const { execFileSync } = require('node:child_process');

module.exports = async () => {
  process.env.PG_HOST = process.env.PG_HOST || 'localhost';
  process.env.PG_PORT = process.env.PG_PORT || '5432';
  process.env.PG_DATABASE = process.env.PG_DATABASE || 'newsnexus_test_worker_node';
  process.env.PG_USER = process.env.PG_USER || 'nick';
  process.env.PG_PASSWORD = process.env.PG_PASSWORD || '';

  execFileSync('dropdb', ['--if-exists', process.env.PG_DATABASE]);
  execFileSync('createdb', [process.env.PG_DATABASE]);

  const db = require('@newsnexus/db-models');
  db.initModels();
  await db.sequelize.sync();
  await db.sequelize.close();
};
