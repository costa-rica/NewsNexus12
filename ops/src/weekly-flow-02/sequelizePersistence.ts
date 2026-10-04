import type { WeeklyArticleFlowRun02 } from '@newsnexus/db-models';
import {
  isWeeklyFlowPhase,
  type JsonRecord,
  type PhaseCompletionFields,
  type WeeklyFlowFailure,
  type WeeklyFlowPersistence,
  WeeklyFlowPersistenceError,
  type WeeklyFlowPhase,
  type WeeklyFlowRunRecord
} from './persistence';

type WeeklyFlowRunModel = typeof WeeklyArticleFlowRun02;
type WeeklyFlowRunInstance = InstanceType<WeeklyFlowRunModel>;

const phaseKey = (phase: WeeklyFlowPhase): string => `phase${phase}`;

const performPersistenceOperation = async <Result>(
  failureMessage: string,
  operation: () => Promise<Result>
): Promise<Result> => {
  try {
    return await operation();
  } catch (error: unknown) {
    if (error instanceof WeeklyFlowPersistenceError) throw error;
    throw new WeeklyFlowPersistenceError(failureMessage);
  }
};

const asJsonRecord = (value: unknown): JsonRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WeeklyFlowPersistenceError('Persisted phase data must be a JSON object');
  }
  return value as JsonRecord;
};

const asPhase = (value: number | null, fieldName: string): WeeklyFlowPhase | null => {
  if (value === null) return null;
  if (!isWeeklyFlowPhase(value)) {
    throw new WeeklyFlowPersistenceError(`${fieldName} is outside the supported phase range`);
  }
  return value;
};

const asNullableNonNegativeSafeInteger = (
  value: number | null,
  fieldName: string
): number | null => {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new WeeklyFlowPersistenceError(`${fieldName} must be a non-negative safe integer`);
  }
  return value;
};

const toRunRecord = (run: WeeklyFlowRunInstance): WeeklyFlowRunRecord => ({
  id: run.id,
  runStartedAt: run.runStartedAt,
  runCompleted: run.runCompleted,
  runCompletedAt: run.runCompletedAt,
  lastPhaseStarted: asPhase(run.lastPhaseStarted, 'lastPhaseStarted'),
  lastPhaseCompleted: asPhase(run.lastPhaseCompleted, 'lastPhaseCompleted'),
  phaseData: asJsonRecord(run.phaseData),
  lastError: run.lastError === null ? null : asJsonRecord(run.lastError),
  backupPath: run.backupPath,
  backupByteSize: run.backupByteSize,
  backupSha256: run.backupSha256,
  backupManifestVersion: run.backupManifestVersion,
  newsApiRequestIdHighWaterMark: asNullableNonNegativeSafeInteger(
    run.newsApiRequestIdHighWaterMark,
    'newsApiRequestIdHighWaterMark'
  ),
  articleIdHighWaterMark: asNullableNonNegativeSafeInteger(
    run.articleIdHighWaterMark,
    'articleIdHighWaterMark'
  ),
  firstRssRequestId: run.firstRssRequestId,
  firstRssArticleId: run.firstRssArticleId,
  rssArticlesAddedCount: run.rssArticlesAddedCount,
  articleCount: run.articleCount,
  rssJobId: run.rssJobId,
  semanticScorerJobId: run.semanticScorerJobId,
  stateAssignerJobId: run.stateAssignerJobId,
  aiApproverV02JobId: run.aiApproverV02JobId,
  targetArticleThresholdDaysOld: run.targetArticleThresholdDaysOld,
  createdAt: run.createdAt,
  updatedAt: run.updatedAt
});

const requireRun = async (
  model: WeeklyFlowRunModel,
  runId: number
): Promise<WeeklyFlowRunInstance> => {
  if (!Number.isSafeInteger(runId) || runId <= 0) {
    throw new WeeklyFlowPersistenceError('Run ID must be a positive safe integer');
  }
  const run = await model.findByPk(runId);
  if (!run) throw new WeeklyFlowPersistenceError(`Weekly flow run ${runId} was not found`);
  return run;
};

const assertCanStartPhase = (run: WeeklyFlowRunInstance, phase: WeeklyFlowPhase): void => {
  if (run.runCompleted) {
    throw new WeeklyFlowPersistenceError('A completed run cannot start another phase');
  }
  const completed = run.lastPhaseCompleted ?? 0;
  if (phase !== completed + 1) {
    throw new WeeklyFlowPersistenceError(
      `Phase ${phase} cannot start after completed phase ${completed}`
    );
  }
};

const assertCanCompletePhase = (run: WeeklyFlowRunInstance, phase: WeeklyFlowPhase): void => {
  const completed = run.lastPhaseCompleted ?? 0;
  if (run.lastPhaseStarted !== phase || completed !== phase - 1) {
    throw new WeeklyFlowPersistenceError(`Phase ${phase} was not the next started phase`);
  }
};

const mergePhaseData = (
  currentValue: unknown,
  phase: WeeklyFlowPhase,
  additions: JsonRecord
): JsonRecord => {
  const current = asJsonRecord(currentValue);
  const existingPhase = current[phaseKey(phase)];
  const existing =
    typeof existingPhase === 'object' && existingPhase !== null && !Array.isArray(existingPhase)
      ? (existingPhase as JsonRecord)
      : {};
  return {
    ...current,
    [phaseKey(phase)]: { ...existing, ...additions }
  };
};

export const createSequelizeWeeklyFlowPersistence = (
  model: WeeklyFlowRunModel
): WeeklyFlowPersistence => ({
  async getLatestRun() {
    return performPersistenceOperation('Latest weekly flow run lookup failed', async () => {
      const run = await model.findOne({ order: [['id', 'DESC']] });
      return run ? toRunRecord(run) : null;
    });
  },

  async getRunById(runId) {
    return performPersistenceOperation('Weekly flow run lookup failed', async () => {
      if (!Number.isSafeInteger(runId) || runId <= 0) {
        throw new WeeklyFlowPersistenceError('Run ID must be a positive safe integer');
      }
      const run = await model.findByPk(runId);
      return run ? toRunRecord(run) : null;
    });
  },

  async createRun(runStartedAt) {
    if (!(runStartedAt instanceof Date) || !Number.isFinite(runStartedAt.getTime())) {
      throw new WeeklyFlowPersistenceError('Run start time must be a valid date');
    }
    return performPersistenceOperation('Weekly flow run creation failed', async () => {
      const run = await model.create({ runStartedAt });
      return toRunRecord(run);
    });
  },

  async recordPhaseStarted(runId, phase, startedAt) {
    return performPersistenceOperation(`Phase ${phase} start could not be persisted`, async () => {
      const run = await requireRun(model, runId);
      assertCanStartPhase(run, phase);
      await run.update({
        lastPhaseStarted: phase,
        phaseData: mergePhaseData(run.phaseData, phase, {
          status: 'started',
          startedAt: startedAt.toISOString()
        })
      });
      return toRunRecord(run);
    });
  },

  async recordPhaseCompleted(runId, phase, completedAt, phaseResult, fields = {}) {
    return performPersistenceOperation(`Phase ${phase} completion could not be persisted`, async () => {
      const run = await requireRun(model, runId);
      assertCanCompletePhase(run, phase);
      const fieldUpdates: PhaseCompletionFields = fields;
      await run.update({
        ...fieldUpdates,
        lastPhaseCompleted: phase,
        phaseData: mergePhaseData(run.phaseData, phase, {
          status: 'completed',
          completedAt: completedAt.toISOString(),
          result: asJsonRecord(phaseResult)
        })
      });
      return toRunRecord(run);
    });
  },

  async recordFailure(runId, failure: WeeklyFlowFailure) {
    return performPersistenceOperation('Weekly flow failure could not be persisted', async () => {
      const run = await requireRun(model, runId);
      const errorData: JsonRecord = {
        phase: failure.phase,
        category: failure.category,
        message: failure.message,
        failedAt: failure.failedAt.toISOString(),
      };
      const updates: Record<string, unknown> = { lastError: errorData };
      if (failure.phase !== null) {
        updates.phaseData = mergePhaseData(run.phaseData, failure.phase, {
          status: 'failed',
          failedAt: failure.failedAt.toISOString(),
          error: errorData
        });
      }
      await run.update(updates);
      return toRunRecord(run);
    });
  },

  async recordRunCompleted(runId, completedAt) {
    return performPersistenceOperation('Weekly flow completion could not be persisted', async () => {
      const run = await requireRun(model, runId);
      if (run.runCompleted) {
        throw new WeeklyFlowPersistenceError('Weekly flow run is already complete');
      }
      await run.update({ runCompleted: true, runCompletedAt: completedAt });
      return toRunRecord(run);
    });
  }
});

export interface LoadedWeeklyFlowPersistence {
  persistence: WeeklyFlowPersistence;
  close(): Promise<void>;
}

export async function loadWeeklyFlowPersistence(): Promise<LoadedWeeklyFlowPersistence> {
  try {
    const dbModels = await import('@newsnexus/db-models');
    const models = dbModels.initModels();
    await dbModels.sequelize.authenticate();
    return {
      persistence: createSequelizeWeeklyFlowPersistence(models.WeeklyArticleFlowRun02),
      close: async () => dbModels.sequelize.close()
    };
  } catch (error: unknown) {
    if (error instanceof Error && /^Missing required environment variable: PG_/.test(error.message)) {
      throw new WeeklyFlowPersistenceError(error.message);
    }
    throw new WeeklyFlowPersistenceError('Weekly flow persistence initialization failed');
  }
}
