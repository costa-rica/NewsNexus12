import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, type OpsConfig } from '../config';
import { finishLogging, initializeLogger } from '../logger';
import { parseWeeklyFlowInvocation, type WeeklyFlowInvocation } from './cli';
import {
  runCoordinator,
  type CoordinatorLogger
} from './coordinator';
import {
  persistenceErrorDiagnostics,
  type WeeklyFlowPersistence
} from './persistence';
import {
  loadWeeklyFlowPersistence,
  type LoadedWeeklyFlowPersistence
} from './sequelizePersistence';

interface EntryPointDependencies {
  loadConfiguration(): OpsConfig;
  registerProcessExitMarker(config: OpsConfig): void;
  initializeLog(config: OpsConfig): CoordinatorLogger;
  parseInvocation(args: readonly string[]): WeeklyFlowInvocation;
  loadPersistence(): Promise<LoadedWeeklyFlowPersistence>;
  run(
    logger: CoordinatorLogger,
    config: OpsConfig,
    dependencies: {
      persistence: WeeklyFlowPersistence;
      invocation: WeeklyFlowInvocation;
    }
  ): Promise<void>;
  finishLog(logger: CoordinatorLogger): Promise<void>;
}

let processExitMarkerRegistered = false;

const registerProcessExitMarker = (config: OpsConfig): void => {
  if (processExitMarkerRegistered) return;
  processExitMarkerRegistered = true;

  // TEMP shutdown diagnostic — remove after clean runs are confirmed.
  process.once('exit', (code) => {
    const line = `${new Date().toISOString()} [INFO] Process exiting pid=${process.pid} exitCode=${code}\n`;
    if (config.nodeEnv !== 'development') {
      try {
        fs.appendFileSync(path.join(config.pathToLogs, `${config.nameApp}.log`), line);
      } catch {
        // Exit diagnostics must never replace the process outcome.
      }
    }
    try {
      process.stderr.write(line);
    } catch {
      // The invoking terminal may already be disconnected.
    }
  });
};

const defaultDependencies: EntryPointDependencies = {
  loadConfiguration: loadConfig,
  registerProcessExitMarker,
  initializeLog: initializeLogger,
  parseInvocation: parseWeeklyFlowInvocation,
  loadPersistence: loadWeeklyFlowPersistence,
  run: runCoordinator,
  finishLog: finishLogging
};

export async function executeWeeklyFlow02(
  args: readonly string[],
  overrides: Partial<EntryPointDependencies> = {}
): Promise<void> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const config = dependencies.loadConfiguration();
  dependencies.registerProcessExitMarker(config);
  const logger = dependencies.initializeLog(config);
  let loadedPersistence: LoadedWeeklyFlowPersistence | undefined;

  try {
    const invocation = dependencies.parseInvocation(args);
    try {
      loadedPersistence = await dependencies.loadPersistence();
    } catch (error: unknown) {
      logger.error('Weekly pipeline persistence initialization failed', {
        error: error instanceof Error ? error.message : String(error),
        ...persistenceErrorDiagnostics(error)
      });
      throw error;
    }
    await dependencies.run(logger, config, {
      persistence: loadedPersistence.persistence,
      invocation
    });
  } finally {
    try {
      if (loadedPersistence) {
        logger.info('Shutdown: closing database');
        await loadedPersistence.close();
      }
    } finally {
      logger.info('Shutdown: closing logger');
      await dependencies.finishLog(logger);
    }
  }
}
