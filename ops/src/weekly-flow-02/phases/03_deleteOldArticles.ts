import type { OpsConfig } from '../../config';
import {
  buildProductionDeleteOldArticlesCommand,
  runDeleteOldArticlesCommand,
  type DeleteOldArticlesCommandSpec,
  type DeleteOldArticlesProcessLauncher,
  type DeleteOldArticlesResult
} from './03_deleteOldArticlesCommand';

export type {
  DeleteOldArticlesCommandSpec,
  DeleteOldArticlesProcessLauncher,
  DeleteOldArticlesResult
};

type PhaseThreeConfig = Pick<OpsConfig, 'dbManagerDeleteArticlesTimeoutSeconds'>;

export const deleteOldArticles = (
  config: PhaseThreeConfig,
  command: DeleteOldArticlesCommandSpec = buildProductionDeleteOldArticlesCommand(),
  launcher?: DeleteOldArticlesProcessLauncher
): Promise<DeleteOldArticlesResult> =>
  runDeleteOldArticlesCommand(
    command,
    config.dbManagerDeleteArticlesTimeoutSeconds,
    launcher
  );
