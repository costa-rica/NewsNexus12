import { AppError } from '../errors/appError';
import { getActiveOrchestratorRunId, invalidateActiveRunCache } from './activeRunGuard';
import { startContinuationCoordinator } from './coordinator';
import { assessContinuationForRun } from './continuationAssessment';
import { getRunById } from './repository';

export interface ContinuationCreationResponse {
  statusCode: 202 | 409 | 422;
  body: Record<string, unknown>;
}

const unsupportedReasonCodes = new Set([
  'report_only_continuation_deferred',
  'unrecognized_failure_shape',
  'source_is_continuation',
]);

export const createContinuationForRun = async (
  sourceRunId: number
): Promise<ContinuationCreationResponse> => {
  const activeRunId = await getActiveOrchestratorRunId();
  if (activeRunId !== null) {
    return {
      statusCode: 409,
      body: {
        orchestratorRunId: activeRunId,
        message: `An orchestrator run (id: ${activeRunId}) is already in progress.`,
      },
    };
  }

  const result = await assessContinuationForRun(sourceRunId);
  if (!result.found || !result.assessment) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: `Run ${sourceRunId} not found` });
  }

  const { assessment } = result;
  if (!assessment.eligible) {
    return {
      statusCode: unsupportedReasonCodes.has(assessment.reasonCode) ? 422 : 409,
      body: assessment as unknown as Record<string, unknown>,
    };
  }

  if (assessment.articleIdMinExclusive === null || assessment.runnableSteps.length === 0) {
    return {
      statusCode: 409,
      body: {
        ...assessment,
        eligible: false,
        blockingReasons: [
          ...assessment.blockingReasons,
          'Continuation assessment did not include a runnable step or source lower article bound.',
        ],
      } as unknown as Record<string, unknown>,
    };
  }

  const sourceRun = await getRunById(sourceRunId);
  if (!sourceRun) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: `Run ${sourceRunId} not found` });
  }

  const continuationRunId = await startContinuationCoordinator({
    mode: 'weekly',
    aiApproverEnabled: sourceRun.aiApproverEnabled,
    semanticScorerEnabled: sourceRun.semanticScorerEnabled,
    continuation: {
      sourceOrchestratorRunId: sourceRun.id,
      inheritedSteps: assessment.inheritedSteps,
      firstRunnableStep: assessment.runnableSteps[0].stepName,
      articleIdMinExclusive: assessment.articleIdMinExclusive,
      plannedArticleIdMaxInclusive: assessment.plannedArticleIdMaxInclusive,
      googleRssResumePlan: assessment.googleRssResumePlan,
      retryPolicy: assessment.retryPolicy,
    },
  }, sourceRun.userId, assessment);

  invalidateActiveRunCache();

  return {
    statusCode: 202,
    body: {
      runId: continuationRunId,
      sourceRunId,
      runMode: 'continuation',
    },
  };
};
