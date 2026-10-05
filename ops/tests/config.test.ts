import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { parseOpsConfig } from '../src/config';

const baseDirectory = path.join(path.sep, 'test', 'ops');

const validEnvironment = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'development',
  NAME_APP: 'newsnexus12-weekly-pipeline',
  URL_BASE_NEWS_NEXUS_PYTHON_QUEUER: 'http://127.0.0.1:5000/',
  WORKER_PYTHON_REQUEST_TIMEOUT_SECONDS: '90',
  URL_BASE_NEWS_NEXUS_WORKER_NODE: 'http://127.0.0.1:3002/',
  WORKER_NODE_REQUEST_TIMEOUT_SECONDS: '60',
  RSS_STATUS_POLL_INTERVAL_SECONDS: '300',
  RSS_TOLERATED_CONSECUTIVE_STATUS_FAILURES: '2',
  RSS_JOB_TIMEOUT_HOURS: '24',
  STATE_ASSIGNER_TARGET_ARTICLE_THRESHOLD_DAYS_OLD: '180',
  DB_MANAGER_BACKUP_TIMEOUT_SECONDS: '1800',
  DB_MANAGER_DELETE_ARTICLES_TIMEOUT_SECONDS: '1800',
  PATH_TO_LOGS: './logs'
});

describe('parseOpsConfig', () => {
  it('returns the required worker and logging configuration', () => {
    const config = parseOpsConfig(validEnvironment(), baseDirectory);

    assert.equal(config.nodeEnv, 'development');
    assert.equal(config.nameApp, 'newsnexus12-weekly-pipeline');
    assert.equal(config.workerPythonBaseUrl, 'http://127.0.0.1:5000/');
    assert.equal(config.workerPythonRequestTimeoutSeconds, 90);
    assert.equal(config.workerNodeBaseUrl, 'http://127.0.0.1:3002/');
    assert.equal(config.workerNodeRequestTimeoutSeconds, 60);
    assert.equal(config.rssStatusPollIntervalSeconds, 300);
    assert.equal(config.rssToleratedConsecutiveStatusFailures, 2);
    assert.equal(config.rssJobTimeoutHours, 24);
    assert.equal(config.stateAssignerTargetArticleThresholdDaysOld, 180);
    assert.equal(config.stateAssignerStatusPollIntervalSeconds, 300);
    assert.equal(config.stateAssignerToleratedConsecutiveStatusFailures, 2);
    assert.equal(config.stateAssignerMonitoringLimitHours, 12);
    assert.equal(config.dbManagerBackupTimeoutSeconds, 1800);
    assert.equal(config.dbManagerDeleteArticlesTimeoutSeconds, 1800);
    assert.equal(config.pathToLogs, path.join(baseDirectory, 'logs'));
    assert.equal(config.logMaxSizeMb, 5);
    assert.equal(config.logMaxFiles, 5);
  });

  it('maps the test environment name to testing', () => {
    const env = validEnvironment();
    env.NODE_ENV = 'test';

    assert.equal(parseOpsConfig(env, baseDirectory).nodeEnv, 'testing');
  });

  it('accepts HTTP and HTTPS worker URLs', () => {
    for (const workerUrl of ['http://worker.test:5000', 'https://worker.test']) {
      const env = validEnvironment();
      env.URL_BASE_NEWS_NEXUS_PYTHON_QUEUER = workerUrl;

      assert.equal(parseOpsConfig(env, baseDirectory).workerPythonBaseUrl, workerUrl);
    }
  });

  it('requires every non-defaulted setting', () => {
    const requiredKeys = [
      'NODE_ENV',
      'NAME_APP',
      'URL_BASE_NEWS_NEXUS_PYTHON_QUEUER',
      'WORKER_PYTHON_REQUEST_TIMEOUT_SECONDS',
      'URL_BASE_NEWS_NEXUS_WORKER_NODE',
      'WORKER_NODE_REQUEST_TIMEOUT_SECONDS',
      'RSS_STATUS_POLL_INTERVAL_SECONDS',
      'RSS_TOLERATED_CONSECUTIVE_STATUS_FAILURES',
      'RSS_JOB_TIMEOUT_HOURS',
      'STATE_ASSIGNER_TARGET_ARTICLE_THRESHOLD_DAYS_OLD',
      'DB_MANAGER_BACKUP_TIMEOUT_SECONDS',
      'DB_MANAGER_DELETE_ARTICLES_TIMEOUT_SECONDS',
      'PATH_TO_LOGS'
    ];

    for (const key of requiredKeys) {
      const env = validEnvironment();
      delete env[key];

      assert.throws(
        () => parseOpsConfig(env, baseDirectory),
        new RegExp(`Missing required environment variable: ${key}`)
      );
    }
  });

  it('rejects unsupported application environments', () => {
    const env = validEnvironment();
    env.NODE_ENV = 'staging';

    assert.throws(
      () => parseOpsConfig(env, baseDirectory),
      /NODE_ENV must be development, testing, or production/
    );
  });

  it('rejects malformed and unsupported worker URLs', () => {
    for (const workerUrl of ['not-a-url', 'ftp://worker.test/path']) {
      const env = validEnvironment();
      env.URL_BASE_NEWS_NEXUS_PYTHON_QUEUER = workerUrl;

      assert.throws(() => parseOpsConfig(env, baseDirectory), /URL_BASE_NEWS_NEXUS_PYTHON_QUEUER/);
    }
  });

  it('requires a positive integer request timeout', () => {
    for (const timeout of ['0', '-1', '1.5', 'not-a-number', '']) {
      const env = validEnvironment();
      env.WORKER_PYTHON_REQUEST_TIMEOUT_SECONDS = timeout;

      assert.throws(
        () => parseOpsConfig(env, baseDirectory),
        /WORKER_PYTHON_REQUEST_TIMEOUT_SECONDS/
      );
    }
  });

  it('validates the worker-node URL and Phase 4 numeric settings', () => {
    const urlEnvironment = validEnvironment();
    urlEnvironment.URL_BASE_NEWS_NEXUS_WORKER_NODE = 'file:///tmp/worker';
    assert.throws(
      () => parseOpsConfig(urlEnvironment, baseDirectory),
      /URL_BASE_NEWS_NEXUS_WORKER_NODE/
    );

    for (const key of [
      'WORKER_NODE_REQUEST_TIMEOUT_SECONDS',
      'RSS_STATUS_POLL_INTERVAL_SECONDS',
      'RSS_TOLERATED_CONSECUTIVE_STATUS_FAILURES',
      'RSS_JOB_TIMEOUT_HOURS'
    ]) {
      for (const value of ['0', '-1', '1.5', 'not-a-number']) {
        const env = validEnvironment();
        env[key] = value;
        assert.throws(() => parseOpsConfig(env, baseDirectory), new RegExp(key));
      }
    }
  });

  it('uses defaults and validates explicit Phase 5 monitoring settings', () => {
    const defaults = parseOpsConfig(validEnvironment(), baseDirectory);
    assert.equal(defaults.semanticScorerStatusPollIntervalSeconds, 300);
    assert.equal(defaults.semanticScorerToleratedConsecutiveStatusFailures, 2);
    assert.equal(defaults.semanticScorerMonitoringLimitHours, 6);

    for (const key of [
      'SEMANTIC_SCORER_STATUS_POLL_INTERVAL_SECONDS',
      'SEMANTIC_SCORER_TOLERATED_CONSECUTIVE_STATUS_FAILURES',
      'SEMANTIC_SCORER_MONITORING_LIMIT_HOURS'
    ]) {
      for (const value of ['0', '-1', '1.5', 'not-a-number', '']) {
        const env = validEnvironment();
        env[key] = value;
        assert.throws(() => parseOpsConfig(env, baseDirectory), new RegExp(key));
      }
    }
  });

  it('uses defaults and validates explicit Phase 6 monitoring settings', () => {
    const defaults = parseOpsConfig(validEnvironment(), baseDirectory);
    assert.equal(defaults.stateAssignerStatusPollIntervalSeconds, 300);
    assert.equal(defaults.stateAssignerToleratedConsecutiveStatusFailures, 2);
    assert.equal(defaults.stateAssignerMonitoringLimitHours, 12);

    for (const key of [
      'STATE_ASSIGNER_STATUS_POLL_INTERVAL_SECONDS',
      'STATE_ASSIGNER_TOLERATED_CONSECUTIVE_STATUS_FAILURES',
      'STATE_ASSIGNER_MONITORING_LIMIT_HOURS'
    ]) {
      for (const value of ['0', '-1', '1.5', 'not-a-number', '']) {
        const env = validEnvironment();
        env[key] = value;
        assert.throws(() => parseOpsConfig(env, baseDirectory), new RegExp(key));
      }
    }
  });

  it('requires a positive Phase 6 Article age threshold', () => {
    for (const value of ['0', '-1', '1.5', 'not-a-number', '']) {
      const env = validEnvironment();
      env.STATE_ASSIGNER_TARGET_ARTICLE_THRESHOLD_DAYS_OLD = value;
      assert.throws(
        () => parseOpsConfig(env, baseDirectory),
        /STATE_ASSIGNER_TARGET_ARTICLE_THRESHOLD_DAYS_OLD/
      );
    }
  });

  it('requires a positive integer backup timeout', () => {
    for (const timeout of ['0', '-1', '1.5', 'not-a-number', '']) {
      const env = validEnvironment();
      env.DB_MANAGER_BACKUP_TIMEOUT_SECONDS = timeout;

      assert.throws(
        () => parseOpsConfig(env, baseDirectory),
        /DB_MANAGER_BACKUP_TIMEOUT_SECONDS/
      );
    }
  });

  it('requires a positive integer old-article deletion timeout', () => {
    for (const timeout of ['0', '-1', '1.5', 'not-a-number', '']) {
      const env = validEnvironment();
      env.DB_MANAGER_DELETE_ARTICLES_TIMEOUT_SECONDS = timeout;

      assert.throws(
        () => parseOpsConfig(env, baseDirectory),
        /DB_MANAGER_DELETE_ARTICLES_TIMEOUT_SECONDS/
      );
    }
  });

  it('accepts explicit positive log rotation settings', () => {
    const env = validEnvironment();
    env.LOG_MAX_SIZE = '8';
    env.LOG_MAX_FILES = '3';

    const config = parseOpsConfig(env, baseDirectory);
    assert.equal(config.logMaxSizeMb, 8);
    assert.equal(config.logMaxFiles, 3);
  });

  it('rejects invalid explicit log rotation settings', () => {
    for (const key of ['LOG_MAX_SIZE', 'LOG_MAX_FILES']) {
      const env = validEnvironment();
      env[key] = '0';

      assert.throws(() => parseOpsConfig(env, baseDirectory), new RegExp(key));
    }
  });

  it('resolves relative paths against the supplied base directory', () => {
    const env = validEnvironment();
    env.PATH_TO_LOGS = '../shared-logs';

    assert.equal(
      parseOpsConfig(env, baseDirectory).pathToLogs,
      path.resolve(baseDirectory, '../shared-logs')
    );
  });

  it('preserves absolute log paths', () => {
    const env = validEnvironment();
    const absoluteLogs = path.join(path.sep, 'var', 'tmp', 'weekly-flow-logs');
    env.PATH_TO_LOGS = absoluteLogs;

    assert.equal(parseOpsConfig(env, baseDirectory).pathToLogs, absoluteLogs);
  });

  it('leaves PostgreSQL variables available for the later persistence import', () => {
    const env = validEnvironment();
    Object.assign(env, {
      PG_HOST: 'database.test',
      PG_PORT: '5432',
      PG_DATABASE: 'newsnexus_test',
      PG_USER: 'newsnexus_app',
      PG_PASSWORD: 'test-only-value',
      PG_SCHEMA: 'public'
    });

    parseOpsConfig(env, baseDirectory);

    assert.equal(env.PG_HOST, 'database.test');
    assert.equal(env.PG_USER, 'newsnexus_app');
    assert.equal(env.PG_PASSWORD, 'test-only-value');
  });
});
