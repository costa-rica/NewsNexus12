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
import { reconcileOrphanedRuns } from '../../src/modules/orchestrator/repository';

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
});
