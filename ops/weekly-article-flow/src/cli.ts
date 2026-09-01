import 'dotenv/config';
import { parseWeeklyFlowCli, parseWeeklyFlowConfig } from './config';
import { WeeklyArticleFlowCoordinator } from './coordinator';
import { WeeklyFlowRepository } from './database';
import { WorkerHttpClient } from './http';

export const runCli = async (
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): Promise<void> => {
  const options = parseWeeklyFlowCli(argv);
  const config = parseWeeklyFlowConfig(env);
  const workerClient = new WorkerHttpClient({
    workerNodeUrl: config.workerNodeUrl,
    workerPythonUrl: config.workerPythonUrl
  });
  const coordinator = new WeeklyArticleFlowCoordinator({
    config,
    repository: new WeeklyFlowRepository(),
    workerClient,
    env
  });
  await coordinator.run(options);
};

if (require.main === module) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'weekly flow failed'}\n`);
    process.exitCode = 1;
  });
}
