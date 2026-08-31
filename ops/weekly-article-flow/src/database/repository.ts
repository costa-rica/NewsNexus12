import {
  AiApproverArticlePredictionV02,
  AiApproverRunV02,
  WeeklyArticleFlowMode,
  WeeklyArticleFlowRun,
  WeeklyArticleFlowStatus,
  sequelize
} from '@newsnexus/db-models';
import { Op, QueryTypes, UniqueConstraintError } from 'sequelize';

export class ActiveRunExistsError extends Error {
  constructor() {
    super('active_run_exists');
    this.name = 'ActiveRunExistsError';
  }
}

export class InvalidRunTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`invalid weekly run transition: ${from} -> ${to}`);
    this.name = 'InvalidRunTransitionError';
  }
}

const terminalStatuses = new Set<WeeklyArticleFlowStatus>([
  'completed',
  'completed_no_new_articles',
  'failed',
  'failed_worker_result_contract',
  'failure_rss_rate_limited',
  'failure_rss_cohort_mismatch',
  'failure_state_assigner_circuit_breaker',
  'failure_ai_approver_v02',
  'timed_out',
  'canceled'
]);

const allowedStatuses: Record<WeeklyArticleFlowStatus, Set<WeeklyArticleFlowStatus>> = {
  pending: new Set(['running', 'failed', 'canceled']),
  running: new Set(terminalStatuses),
  completed: new Set(),
  completed_no_new_articles: new Set(),
  failed: new Set(),
  failed_worker_result_contract: new Set(),
  failure_rss_rate_limited: new Set(),
  failure_rss_cohort_mismatch: new Set(),
  failure_state_assigner_circuit_breaker: new Set(),
  failure_ai_approver_v02: new Set(),
  timed_out: new Set(),
  canceled: new Set()
};

export const weeklyStageOrder = [
  'preflight',
  'duplicate_cleanup',
  'backup',
  'delete_old_articles',
  'google_rss',
  'semantic_scorer',
  'state_assigner',
  'ai_approver_v02_preview',
  'ai_approver_v02_execution',
  'reconciliation',
  'reporting'
] as const;

export type WeeklyStageName = (typeof weeklyStageOrder)[number];

export interface NewWeeklyRunInput {
  mode: WeeklyArticleFlowMode;
  host: string;
  databaseName: string;
  sourceRevision: string;
  scheduledFor?: Date | null;
  jsonlFilePath?: string | null;
}

export interface ResumeRunExpectation {
  runId: number;
  mode: WeeklyArticleFlowMode;
  host: string;
  databaseName: string;
  sourceRevision: string;
}

export interface V02Reconciliation {
  run: AiApproverRunV02;
  selectedArticleIds: number[];
  predictions: Array<{
    articleId: number;
    resultStatus: string;
    prediction: string | null;
  }>;
}

export class WeeklyFlowRepository {
  async createNewRun(input: NewWeeklyRunInput): Promise<WeeklyArticleFlowRun> {
    try {
      return await WeeklyArticleFlowRun.create({
        mode: input.mode,
        status: 'pending',
        currentStage: 'preflight',
        scheduledFor: input.scheduledFor ?? null,
        host: input.host,
        sourceRevision: input.sourceRevision,
        jsonlFilePath: input.jsonlFilePath ?? null,
        stageResults: {
          runContext: { databaseName: input.databaseName }
        }
      });
    } catch (error) {
      if (error instanceof UniqueConstraintError || (error as { name?: string }).name === 'SequelizeUniqueConstraintError') {
        throw new ActiveRunExistsError();
      }
      throw error;
    }
  }

  async transitionRun(
    run: WeeklyArticleFlowRun,
    status: WeeklyArticleFlowStatus,
    failureReason: string | null = null
  ): Promise<WeeklyArticleFlowRun> {
    if (!allowedStatuses[run.status].has(status)) {
      throw new InvalidRunTransitionError(run.status, status);
    }
    await run.update({
      status,
      failureReason,
      ...(terminalStatuses.has(status) ? { endedAt: new Date() } : {})
    });
    return run;
  }

  async startStage(
    run: WeeklyArticleFlowRun,
    stage: WeeklyStageName,
    evidence: Record<string, unknown> = {}
  ): Promise<void> {
    const currentIndex = weeklyStageOrder.indexOf(run.currentStage as WeeklyStageName);
    const nextIndex = weeklyStageOrder.indexOf(stage);
    if (nextIndex < 0 || (currentIndex >= 0 && nextIndex < currentIndex)) {
      throw new InvalidRunTransitionError(run.currentStage, stage);
    }
    const stageResults = { ...run.stageResults };
    stageResults[stage] = {
      status: 'running',
      startedAt: new Date().toISOString(),
      ...evidence
    };
    await run.update({ currentStage: stage, stageResults });
  }

  async finishStage(
    run: WeeklyArticleFlowRun,
    stage: WeeklyStageName,
    status: 'completed' | 'skipped' | 'failed',
    evidence: Record<string, unknown> = {}
  ): Promise<void> {
    if (run.currentStage !== stage) {
      throw new InvalidRunTransitionError(run.currentStage, stage);
    }
    const previous = run.stageResults[stage] ?? {};
    const stageResults = { ...run.stageResults };
    stageResults[stage] = {
      ...previous,
      ...evidence,
      status,
      endedAt: new Date().toISOString()
    };
    await run.update({ stageResults });
  }

  async getCohortArticleIds(runId: number): Promise<number[]> {
    const rows = await sequelize.query<{ id: number }>(
      `SELECT DISTINCT article."id" AS "id"
       FROM "Articles" article
       INNER JOIN "NewsApiRequests" request
         ON request."id" = article."newsApiRequestId"
       WHERE request."weeklyArticleFlowRunId" = :runId
       ORDER BY article."id" ASC`,
      { replacements: { runId }, type: QueryTypes.SELECT }
    );
    return rows.map(({ id }) => Number(id));
  }

  async loadV02Reconciliation(runId: number): Promise<V02Reconciliation | null> {
    const run = await AiApproverRunV02.findByPk(runId);
    if (!run) {
      return null;
    }
    const predictionRows = await AiApproverArticlePredictionV02.findAll({
      where: { runId },
      order: [['articleId', 'ASC']]
    });
    return {
      run,
      selectedArticleIds: run.selectionSnapshot.map(({ articleId }) => articleId),
      predictions: predictionRows.map((prediction) => ({
        articleId: prediction.articleId,
        resultStatus: prediction.resultStatus,
        prediction: prediction.prediction
      }))
    };
  }

  async loadForResume(expectation: ResumeRunExpectation): Promise<WeeklyArticleFlowRun> {
    const run = await WeeklyArticleFlowRun.findByPk(expectation.runId);
    if (!run) {
      throw new Error('weekly_run_not_found');
    }
    if (terminalStatuses.has(run.status)) {
      throw new Error('weekly_run_is_terminal');
    }
    if (!weeklyStageOrder.includes(run.currentStage as WeeklyStageName)) {
      throw new Error('weekly_run_resume_stage_state_conflict');
    }
    const currentStageEvidence = run.stageResults[run.currentStage];
    if (
      run.status === 'running' &&
      run.currentStage !== 'preflight' &&
      (!currentStageEvidence || !['running', 'completed', 'skipped'].includes(String(currentStageEvidence.status)))
    ) {
      throw new Error('weekly_run_resume_stage_state_conflict');
    }
    const databaseName = (run.stageResults.runContext as { databaseName?: unknown } | undefined)?.databaseName;
    if (
      run.mode !== expectation.mode ||
      run.host !== expectation.host ||
      run.sourceRevision !== expectation.sourceRevision ||
      databaseName !== expectation.databaseName
    ) {
      throw new Error('weekly_run_resume_context_mismatch');
    }
    const otherActive = await WeeklyArticleFlowRun.findOne({
      where: {
        id: { [Op.ne]: run.id },
        status: { [Op.in]: ['pending', 'running'] }
      }
    });
    if (otherActive) {
      throw new ActiveRunExistsError();
    }
    return run;
  }
}
