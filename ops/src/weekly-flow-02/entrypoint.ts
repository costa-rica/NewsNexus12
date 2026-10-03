import { loadConfig, type OpsConfig } from '../config';
import { finishLogging, initializeLogger } from '../logger';
import { parseWeeklyFlowInvocation, type WeeklyFlowInvocation } from './cli';
import {
  runCoordinator,
  type CoordinatorLogger
} from './coordinator';
import type { WeeklyFlowPersistence } from './persistence';
import {
  loadWeeklyFlowPersistence,
  type LoadedWeeklyFlowPersistence
} from './sequelizePersistence';

interface EntryPointDependencies {
  loadConfiguration(): OpsConfig;
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

const defaultDependencies: EntryPointDependencies = {
  loadConfiguration: loadConfig,
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
  const logger = dependencies.initializeLog(config);
  let loadedPersistence: LoadedWeeklyFlowPersistence | undefined;

  try {
    const invocation = dependencies.parseInvocation(args);
    loadedPersistence = await dependencies.loadPersistence();
    await dependencies.run(logger, config, {
      persistence: loadedPersistence.persistence,
      invocation
    });
  } finally {
    try {
      if (loadedPersistence) await loadedPersistence.close();
    } finally {
      await dependencies.finishLog(logger);
    }
  }
}
