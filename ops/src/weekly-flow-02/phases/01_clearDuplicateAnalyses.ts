import type { OpsConfig } from '../../config';
import {
  requestClearDuplicateAnalyses,
  type ClearDuplicateAnalysesResult,
  type WorkerRequest
} from './01_clearDuplicateAnalysesRequest';

export type { ClearDuplicateAnalysesResult, WorkerRequest };

type PhaseOneConfig = Pick<
  OpsConfig,
  'workerPythonBaseUrl' | 'workerPythonRequestTimeoutSeconds'
>;

export const clearDuplicateAnalyses = (
  config: PhaseOneConfig,
  request: WorkerRequest = globalThis.fetch
): Promise<ClearDuplicateAnalysesResult> =>
  requestClearDuplicateAnalyses(
    config.workerPythonBaseUrl,
    config.workerPythonRequestTimeoutSeconds,
    request
  );
