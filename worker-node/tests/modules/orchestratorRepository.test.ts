jest.mock('@newsnexus/db-models', () => ({
  OrchestratorRun: {
    create: jest.fn(),
    update: jest.fn(),
    findAll: jest.fn(),
    findByPk: jest.fn(),
  },
  OrchestratorRunStep: {
    create: jest.fn(),
    update: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
  },
}));

import { OrchestratorRun, OrchestratorRunStep } from '@newsnexus/db-models';
import { createRun, reconcileOrphanedRuns } from '../../src/modules/orchestrator/repository';
import type { ContinuationAssessment } from '../../src/modules/orchestrator/continuationAssessment';

const mockedOrchestratorRun = OrchestratorRun as jest.Mocked<typeof OrchestratorRun>;
const mockedOrchestratorRunStep = OrchestratorRunStep as jest.Mocked<typeof OrchestratorRunStep>;

describe('orchestrator repository orphan reconciliation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('scopes restart reconciliation to affected running runs and running steps', async () => {
    mockedOrchestratorRun.findAll.mockResolvedValue([{ id: 101 }, { id: 202 }] as never);
    mockedOrchestratorRun.update.mockResolvedValue([2] as never);
    mockedOrchestratorRunStep.update.mockResolvedValue([2] as never);

    await expect(reconcileOrphanedRuns()).resolves.toBe(2);

    expect(mockedOrchestratorRun.findAll).toHaveBeenCalledWith({
      attributes: ['id'],
      where: { status: 'running' },
    });
    expect(mockedOrchestratorRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        failureReason: 'Worker restarted unexpectedly',
      }),
      { where: { id: [101, 202], status: 'running' } }
    );
    expect(mockedOrchestratorRunStep.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        endingReason: 'worker_restart',
        endingMessage: 'Worker restarted while step was active',
      }),
      { where: { orchestratorRunId: [101, 202], status: 'running' } }
    );
  });

  it('does not update runs or steps when no running runs are orphaned', async () => {
    mockedOrchestratorRun.findAll.mockResolvedValue([] as never);

    await expect(reconcileOrphanedRuns()).resolves.toBe(0);

    expect(mockedOrchestratorRun.update).not.toHaveBeenCalled();
    expect(mockedOrchestratorRunStep.update).not.toHaveBeenCalled();
  });

  it('persists linked continuation run metadata while creating normal step rows', async () => {
    mockedOrchestratorRun.create.mockResolvedValue({
      id: 88,
      get: () => ({ id: 88, runMode: 'continuation' }),
    } as never);
    mockedOrchestratorRunStep.create
      .mockResolvedValueOnce({
        id: 901,
        get: () => ({ id: 901, stepName: 'delete_articles' }),
      } as never)
      .mockResolvedValueOnce({
        id: 902,
        get: () => ({ id: 902, stepName: 'google_rss' }),
      } as never);

    const continuationPlan: ContinuationAssessment = {
      eligible: true,
      reasonCode: 'eligible_google_rss_interrupted',
      sourceRunId: 14,
      sourceStatus: 'failed',
      runMode: 'standard',
      articleIdMinExclusive: 100,
      articleIdMaxInclusive: null,
      plannedArticleIdMaxInclusive: null,
      inheritedSteps: [],
      runnableSteps: [],
      googleRssResumePlan: { status: 'ready', reason: 'resume', resumeAfter: null },
      retryPolicy: {
        aiApprover: {
          mode: 'gatekeeper',
          retryTransientFailures: true,
          retryInvalidResponses: false,
        },
        semanticScorer: { rerunAllowed: true },
      },
      warnings: ['range warning'],
      blockingReasons: [],
    };

    await createRun(
      { mode: 'weekly', aiApproverEnabled: true, semanticScorerEnabled: false },
      [
        {
          stepName: 'delete_articles',
          stepOrder: 1,
          enabled: true,
          timeoutSeconds: 1,
          worker: 'node',
          endpointName: '/delete-articles/start-job',
        },
        {
          stepName: 'google_rss',
          stepOrder: 2,
          enabled: true,
          timeoutSeconds: 1,
          worker: 'node',
          endpointName: '/request-google-rss/start-job',
        },
      ],
      7,
      {
        runMode: 'continuation',
        sourceOrchestratorRunId: 14,
        continuationPlan,
        articleIdMinExclusive: 100,
      }
    );

    expect(mockedOrchestratorRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'running',
        runMode: 'continuation',
        sourceOrchestratorRunId: 14,
        continuationPlan,
        articleIdMinExclusive: 100,
        aiApproverEnabled: true,
        semanticScorerEnabled: false,
        userId: 7,
      })
    );
    expect(mockedOrchestratorRunStep.create).toHaveBeenCalledWith(
      expect.objectContaining({
        orchestratorRunId: 88,
        stepName: 'delete_articles',
        status: 'pending',
      })
    );
  });
});
