import 'dotenv/config';
import os from 'node:os';
import type { WeeklyArticleFlowMode } from '@newsnexus/db-models';
import { parseWeeklyFlowCli, parseWeeklyFlowConfig } from './config';
import { assertProductionIdentity } from './productionIdentity';

export interface ConfigCheckDatabase {
  authenticate: () => Promise<void>;
  close: () => Promise<void>;
}

export interface ConfigCheckDependencies {
  env?: NodeJS.ProcessEnv;
  hostname?: () => string;
  username?: () => string;
  loadDatabase?: () => Promise<ConfigCheckDatabase>;
  writeLine?: (line: string) => void;
}

const parseMode = (argv: string[]): WeeklyArticleFlowMode => {
  if (argv.length !== 2 || argv[0] !== '--mode') {
    throw new Error('usage: run-config-check --mode <existing_mode>');
  }
  return parseWeeklyFlowCli(argv).mode;
};

const loadDatabaseWithoutTargetLog = async (): Promise<ConfigCheckDatabase> => {
  const originalLog = console.log;
  console.log = () => undefined;
  try {
    const { sequelize } = await import('@newsnexus/db-models');
    return sequelize;
  } finally {
    console.log = originalLog;
  }
};

export const runConfigCheck = async (
  argv: string[] = process.argv.slice(2),
  dependencies: ConfigCheckDependencies = {}
): Promise<void> => {
  const env = dependencies.env ?? process.env;
  const hostname = dependencies.hostname ?? os.hostname;
  const username = dependencies.username ?? (() => os.userInfo().username);
  const writeLine = dependencies.writeLine ?? ((line) => process.stdout.write(`${line}\n`));
  const mode = parseMode(argv);

  parseWeeklyFlowConfig(env);

  const host = hostname();
  const databaseName = env.PG_DATABASE?.trim() ?? '';
  const databaseUser = env.PG_USER?.trim() ?? '';
  assertProductionIdentity(mode, username(), databaseUser);

  let database: ConfigCheckDatabase;
  try {
    database = await (dependencies.loadDatabase ?? loadDatabaseWithoutTargetLog)();
  } catch {
    throw new Error('PostgreSQL configuration could not be loaded');
  }

  let operationFailed = false;
  try {
    try {
      await database.authenticate();
    } catch {
      throw new Error('PostgreSQL connection check failed');
    }
    writeLine(JSON.stringify({ mode, host, databaseName, databaseUser }));
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    try {
      await database.close();
    } catch {
      if (!operationFailed) {
        throw new Error('PostgreSQL connection close failed');
      }
    }
  }
};

if (require.main === module) {
  runConfigCheck().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'configuration check failed'}\n`);
    process.exitCode = 1;
  });
}
