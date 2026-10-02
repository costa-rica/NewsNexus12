import { loadConfig } from '../config';
import { initializeLogger, finishLogging } from '../logger';
import { runCoordinator } from './coordinator';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = initializeLogger(config);

  try {
    runCoordinator(logger);
  } finally {
    // Let the last messages reach their destinations before the process exits.
    await finishLogging(logger);
  }
}

main().catch((error: unknown) => {
  // Configuration or logger startup can fail before file logging is available.
  console.error('Weekly pipeline scaffold failed:', error);
  process.exitCode = 1;
});
