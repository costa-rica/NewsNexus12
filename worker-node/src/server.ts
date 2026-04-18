import 'dotenv/config';
import { createApp } from './app';
import logger, { initializeLogger, isLoggerInitialized } from './modules/logger';
import { isStartupConfigError, loadAppConfig } from './modules/startup/config';
import { ensureStateAssignerDirectories } from './modules/startup/stateAssignerFiles';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const getStartupFailureMessage = (error: unknown): string => {
  if (isStartupConfigError(error)) {
    return `[worker-node] startup failed: ${error.message}`;
  }

  if (error instanceof Error) {
    return `[worker-node] startup failed: ${error.message}`;
  }

  return '[worker-node] startup failed due to an unknown error';
};

interface StartServerOptions {
  env?: NodeJS.ProcessEnv;
  exit?: (code: number) => never;
  exitDelayMs?: number;
}

export const startServer = async (options: StartServerOptions = {}): Promise<void> => {
  const env = options.env ?? process.env;
  const exit = options.exit ?? ((code: number): never => process.exit(code));
  const exitDelayMs = options.exitDelayMs ?? 100;

  try {
    const config = loadAppConfig(env);

    initializeLogger({
      nodeEnv: config.nodeEnv,
      nameApp: config.nameApp,
      pathToLogs: config.pathToLogs,
      logMaxFiles: config.logMaxFiles,
      logMaxSizeMb: config.logMaxSizeMb
    });

    logger.info('Worker-node startup attempt');
    logger.info('Worker-node runtime configuration loaded', {
      nodeEnv: config.nodeEnv,
      port: config.port,
      databaseTarget: `${config.pgHost}:${config.pgPort}/${config.pgDatabase}`,
      databaseUser: config.pgUser,
      pathToStateAssignerFiles: config.pathToStateAssignerFiles,
      pathToSemanticScorerDir: config.pathToSemanticScorerDir,
      pathToLogs: config.pathToLogs
    });
    await ensureStateAssignerDirectories(config.pathToStateAssignerFiles);

    const app = createApp();
    app.listen(config.port, () => {
      logger.info(`Worker-node listening on port ${config.port}`);
    });
  } catch (error) {
    const startupMessage = getStartupFailureMessage(error);
    process.stderr.write(`${startupMessage}\n`);

    if (isLoggerInitialized()) {
      logger.error(startupMessage);
    }

    await sleep(exitDelayMs);
    exit(1);
  }
};

if (require.main === module) {
  void startServer();
}
