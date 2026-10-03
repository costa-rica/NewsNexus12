import { executeWeeklyFlow02 } from './entrypoint';

executeWeeklyFlow02(process.argv.slice(2)).catch((error: unknown) => {
  // Configuration or logger startup can fail before file logging is available.
  console.error('Weekly pipeline failed:', error);
  process.exitCode = 1;
});
