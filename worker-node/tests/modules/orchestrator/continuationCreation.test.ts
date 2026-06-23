const mockGetActiveRunId = jest.fn();
const mockInvalidateCache = jest.fn();
const mockStartContinuationCoordinator = jest.fn();
const mockAssessContinuationForRun = jest.fn();
const mockGetRunById = jest.fn();

jest.mock('../../../src/modules/orchestrator/activeRunGuard', () => ({
  getActiveOrchestratorRunId: () => mockGetActiveRunId(),
  invalidateActiveRunCache: () => mockInvalidateCache(),
}));

jest.mock('../../../src/modules/orchestrator/coordinator', () => ({
  startContinuationCoordinator: (...args: unknown[]) => mockStartContinuationCoordinator(...args),
}));

jest.mock('../../../src/modules/orchestrator/continuationAssessment', () => ({
  assessContinuationForRun: (...args: unknown[]) => mockAssessContinuationForRun(...args),
}));

jest.mock('../../../src/modules/orchestrator/repository', () => ({
  getRunById: (...args: unknown[]) => mockGetRunById(...args),
}));

import { createContinuationForRun } from '../../../src/modules/orchestrator/continuationCreation';
import type { ContinuationAssessment } from '../../../src/modules/orchestrator/continuationAssessment';

const eligibleAssessment = (): ContinuationAssessment => ({
  eligible: true,
  reasonCode: 'eligible_downstream_interrupted',
  sourceRunId: 1,
  sourceStatus: 'timed_out',
  runMode: 'standard',
  articleIdMinExclusive: 100,
  articleIdMaxInclusive: 250,
  plannedArticleIdMaxInclusive: null,
  inheritedSteps: [
    {
      stepName: 'google_rss',
      stepOrder: 2,
      sourceStepId: 12,
      sourceStatus: 'completed',
      sourceChildJobId: 'rss-job',
      sourceEndingReason: 'completed',
      sourceEndingMessage: null,
      sourceResult: { articlesAddedCount: 42 },
    },
  ],
  runnableSteps: [
    {
      stepName: 'ai_approver',
      stepOrder: 4,
      sourceStepId: 14,
      sourceStatus: 'timed_out',
      sourceChildJobId: 'ai-job',
      sourceEndingReason: 'timeout',
      sourceEndingMessage: 'timed out',
      sourceResult: null,
    },
  ],
  googleRssResumePlan: {
    status: 'not_applicable',
    reason: 'downstream continuation',
    resumeAfter: null,
  },
  retryPolicy: {
    aiApprover: {
      mode: 'gatekeeper',
      retryTransientFailures: true,
      retryInvalidResponses: false,
    },
    semanticScorer: { rerunAllowed: true },
  },
  warnings: [
    'Continuation upper bound will be captured when downstream processing starts and may include articles from unrelated later runs or manual ingestion.',
  ],
  blockingReasons: [],
});

describe('continuation creation service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetActiveRunId.mockResolvedValue(null);
  });

  it('returns 409 before assessment when another run is active', async () => {
    mockGetActiveRunId.mockResolvedValueOnce(77);

    await expect(createContinuationForRun(1)).resolves.toEqual({
      statusCode: 409,
      body: {
        orchestratorRunId: 77,
        message: 'An orchestrator run (id: 77) is already in progress.',
      },
    });
    expect(mockAssessContinuationForRun).not.toHaveBeenCalled();
  });

  it('rejects no-longer-eligible source runs with assessment body', async () => {
    mockAssessContinuationForRun.mockResolvedValueOnce({
      found: true,
      assessment: {
        ...eligibleAssessment(),
        eligible: false,
        reasonCode: 'source_completed',
        blockingReasons: ['The source run completed successfully.'],
      },
    });

    const result = await createContinuationForRun(1);

    expect(result.statusCode).toBe(409);
    expect(result.body).toMatchObject({
      eligible: false,
      reasonCode: 'source_completed',
    });
    expect(mockStartContinuationCoordinator).not.toHaveBeenCalled();
  });

  it('starts a linked continuation run with copied source settings', async () => {
    const assessment = eligibleAssessment();
    mockAssessContinuationForRun.mockResolvedValueOnce({ found: true, assessment });
    mockGetRunById.mockResolvedValueOnce({
      id: 1,
      aiApproverEnabled: false,
      semanticScorerEnabled: true,
      userId: 12,
    });
    mockStartContinuationCoordinator.mockResolvedValueOnce(88);

    await expect(createContinuationForRun(1)).resolves.toEqual({
      statusCode: 202,
      body: { runId: 88, sourceRunId: 1, runMode: 'continuation' },
    });
    expect(mockStartContinuationCoordinator).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'weekly',
        aiApproverEnabled: false,
        semanticScorerEnabled: true,
        continuation: expect.objectContaining({
          sourceOrchestratorRunId: 1,
          firstRunnableStep: 'ai_approver',
          articleIdMinExclusive: 100,
          inheritedSteps: assessment.inheritedSteps,
          googleRssResumePlan: assessment.googleRssResumePlan,
          retryPolicy: assessment.retryPolicy,
        }),
      }),
      12,
      assessment
    );
    expect(mockInvalidateCache).toHaveBeenCalledTimes(1);
  });
});
