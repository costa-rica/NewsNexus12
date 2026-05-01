import { OrchestratorRun, OrchestratorRunStep } from '@newsnexus/db-models';
import type {
  OrchestratorRunStatus,
  OrchestratorRunStepName,
  OrchestratorRunStepStatus,
  OrchestratorRunRow,
  OrchestratorRunStepRow,
  OrchestratorConfig,
  StepConfig,
} from './types';

export const createRun = async (
  config: OrchestratorConfig,
  steps: StepConfig[],
  userId: number | null
): Promise<{ run: OrchestratorRunRow; runSteps: OrchestratorRunStepRow[] }> => {
  const run = await OrchestratorRun.create({
    status: 'running' as OrchestratorRunStatus,
    startedAt: new Date(),
    aiApproverEnabled: config.aiApproverEnabled,
    semanticScorerEnabled: config.semanticScorerEnabled,
    userId,
  });

  const runStepRecords = await Promise.all(
    steps.map((s) =>
      OrchestratorRunStep.create({
        orchestratorRunId: run.id,
        stepName: s.stepName,
        stepOrder: s.stepOrder,
        enabled: s.enabled,
        status: (s.enabled ? 'pending' : 'skipped') as OrchestratorRunStepStatus,
      })
    )
  );

  return { run: run.get({ plain: true }), runSteps: runStepRecords.map((r) => r.get({ plain: true })) };
};

export const updateRunStatus = async (
  runId: number,
  status: OrchestratorRunStatus,
  extra: Partial<{
    endedAt: Date;
    failureReason: string;
    articleIdMinExclusive: number;
    articleIdMaxInclusive: number;
    reportFilePath: string;
  }> = {}
): Promise<void> => {
  await OrchestratorRun.update(
    { status, ...extra },
    { where: { id: runId } }
  );
};

export const updateRunReportFilePath = async (
  runId: number,
  reportFilePath: string
): Promise<void> => {
  await OrchestratorRun.update(
    { reportFilePath },
    { where: { id: runId } }
  );
};

export const updateStepStatus = async (
  stepId: number,
  status: OrchestratorRunStepStatus,
  extra: Partial<{
    childJobId: string;
    startedAt: Date;
    endedAt: Date;
    result: Record<string, unknown>;
    endingReason: string;
    endingMessage: string;
  }> = {}
): Promise<void> => {
  await OrchestratorRunStep.update(
    { status, ...extra },
    { where: { id: stepId } }
  );
};

export const getRunWithSteps = async (
  runId: number
): Promise<{ run: OrchestratorRunRow; steps: OrchestratorRunStepRow[] } | null> => {
  const run = await OrchestratorRun.findByPk(runId);
  if (!run) return null;

  const steps = await OrchestratorRunStep.findAll({
    where: { orchestratorRunId: runId },
    order: [['stepOrder', 'ASC']],
  });

  return {
    run: run.get({ plain: true }),
    steps: steps.map((s) => s.get({ plain: true })),
  };
};

export const getRunById = async (runId: number): Promise<OrchestratorRunRow | null> => {
  const run = await OrchestratorRun.findByPk(runId);
  return run ? run.get({ plain: true }) : null;
};

export const listRuns = async (
  limit = 20,
  offset = 0
): Promise<OrchestratorRunRow[]> => {
  const runs = await OrchestratorRun.findAll({
    order: [['startedAt', 'DESC']],
    limit,
    offset,
  });
  return runs.map((r) => r.get({ plain: true }));
};

export const reconcileOrphanedRuns = async (): Promise<number> => {
  const [affectedCount] = await OrchestratorRun.update(
    { status: 'failed' as OrchestratorRunStatus, endedAt: new Date(), failureReason: 'Worker restarted unexpectedly' },
    { where: { status: 'running' } }
  );

  if (affectedCount > 0) {
    await OrchestratorRunStep.update(
      { status: 'failed' as OrchestratorRunStepStatus, endedAt: new Date(), endingReason: 'worker_restart', endingMessage: 'Worker restarted while step was active' },
      { where: { status: ['running', 'pending'] as OrchestratorRunStepStatus[] } }
    );
  }

  return affectedCount;
};

export const getStepByName = async (
  runId: number,
  stepName: OrchestratorRunStepName
): Promise<OrchestratorRunStepRow | null> => {
  const step = await OrchestratorRunStep.findOne({
    where: { orchestratorRunId: runId, stepName },
  });
  return step ? step.get({ plain: true }) : null;
};
