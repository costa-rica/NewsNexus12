import type { Logger } from 'winston';
import { clearDuplicateAnalyses } from './phases/clearDuplicateAnalyses';

export function runCoordinator(logger: Logger): void {
  logger.info('------------------------------------------------------------');
  logger.info('### Starting weekly pipeline coordinator ###');
  clearDuplicateAnalyses(logger);
  logger.info('Scaffold stopped after phase 1 stub; no pipeline work performed');
}
