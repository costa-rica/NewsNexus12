import type {
  Article,
  NewsApiRequest,
  NewsArticleAggregatorSource,
  WeeklyArticleFlowRun02
} from '@newsnexus/db-models';
import { Op } from 'sequelize';
import {
  GOOGLE_NEWS_RSS_SOURCE_NAME,
  isWeeklyFlowPhase,
  type JsonRecord,
  type PhaseCompletionFields,
  type PhaseFourCompletionFields,
  type PhaseFourDataStore,
  type PhaseFourDatabaseResult,
  type PhaseFourHighWaterMarks,
  type PhaseFourNonzeroCompletionFields,
  type PhaseFourProgress,
  type PhaseFiveProgress,
  type PhaseFiveCompletionFields,
  type PhaseSixCompletionFields,
  type PhaseSixIncompatibleContractRecovery,
  type PhaseSixProgress,
  type WeeklyFlowFailure,
  type WeeklyFlowPersistence,
  WeeklyFlowPersistenceError,
  type WeeklyFlowPhase,
  type WeeklyFlowRunRecord
} from './persistence';

type WeeklyFlowRunModel = typeof WeeklyArticleFlowRun02;
type WeeklyFlowRunInstance = InstanceType<WeeklyFlowRunModel>;
type ArticleModel = typeof Article;
type NewsApiRequestModel = typeof NewsApiRequest;
type NewsArticleAggregatorSourceModel = typeof NewsArticleAggregatorSource;

export interface PhaseFourDataModels {
  Article: ArticleModel;
  NewsApiRequest: NewsApiRequestModel;
  NewsArticleAggregatorSource: NewsArticleAggregatorSourceModel;
}

const phaseKey = (phase: WeeklyFlowPhase): string => `phase${phase}`;

const performPersistenceOperation = async <Result>(
  failureMessage: string,
  operation: () => Promise<Result>
): Promise<Result> => {
  try {
    return await operation();
  } catch (error: unknown) {
    if (error instanceof WeeklyFlowPersistenceError) throw error;
    throw new WeeklyFlowPersistenceError(failureMessage, { cause: error });
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

const asAggregateInteger = (
  value: unknown,
  fieldName: string,
  options: { nullable: boolean }
): number | null => {
  if (value === null || value === undefined) {
    if (options.nullable) return null;
    throw new WeeklyFlowPersistenceError(`${fieldName} was not returned by the database`);
  }
  const parsed =
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || (parsed as number) < 0) {
    throw new WeeklyFlowPersistenceError(`${fieldName} must be a non-negative safe integer`);
  }
  return parsed as number;
};

const requireValidDate = (value: Date, fieldName: string): void => {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new WeeklyFlowPersistenceError(`${fieldName} must be a valid date`);
  }
};

const requireNonEmptyString = (value: string, fieldName: string): string => {
  const trimmed = value.trim();
  if (!trimmed) throw new WeeklyFlowPersistenceError(`${fieldName} must be a non-empty string`);
  return trimmed;
};

const requireTimestampString = (value: string, fieldName: string): string => {
  const timestamp = requireNonEmptyString(value, fieldName);
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new WeeklyFlowPersistenceError(`${fieldName} must be a valid timestamp`);
  }
  return timestamp;
};

const requirePositiveSafeInteger = (value: unknown, fieldName: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new WeeklyFlowPersistenceError(`${fieldName} must be a positive safe integer`);
  }
  return value;
};

const requireNonnegativeSafeInteger = (value: unknown, fieldName: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new WeeklyFlowPersistenceError(`${fieldName} must be a non-negative safe integer`);
  }
  return value;
};

export const createSequelizePhaseFourDataStore = (
  models: PhaseFourDataModels
): PhaseFourDataStore => ({
  async readHighWaterMarks() {
    const [requestMaximum, articleMaximum] = await Promise.all([
      models.NewsApiRequest.max('id'),
      models.Article.max('id')
    ]);
    return {
      newsApiRequestIdHighWaterMark:
        asAggregateInteger(requestMaximum, 'NewsApiRequests maximum ID', {
          nullable: true
        }) ?? 0,
      articleIdHighWaterMark:
        asAggregateInteger(articleMaximum, 'Articles maximum ID', { nullable: true }) ?? 0
    };
  },

  async readPostMarkResult(marks) {
    const source = await models.NewsArticleAggregatorSource.findOne({
      attributes: ['id'],
      where: { nameOfOrg: GOOGLE_NEWS_RSS_SOURCE_NAME }
    });
    const firstRequestRaw = source
      ? await models.NewsApiRequest.min('id', {
          where: {
            id: { [Op.gt]: marks.newsApiRequestIdHighWaterMark },
            newsArticleAggregatorSourceId: source.id
          }
        })
      : null;
    const firstRssRequestId = asAggregateInteger(
      firstRequestRaw,
      'firstRssRequestId',
      { nullable: true }
    );
    const firstArticle = source
      ? await models.Article.findOne({
          attributes: ['id'],
          include: [
            {
              model: models.NewsApiRequest,
              attributes: [],
              required: true,
              where: {
                id: { [Op.gt]: marks.newsApiRequestIdHighWaterMark },
                newsArticleAggregatorSourceId: source.id
              }
            }
          ],
          order: [['id', 'ASC']]
        })
      : null;
    const firstRssArticleId = asAggregateInteger(
      firstArticle?.id ?? null,
      'firstRssArticleId',
      { nullable: true }
    );
    const articleCountRaw = await models.Article.count({
      where: { id: { [Op.gt]: marks.articleIdHighWaterMark } }
    });
    const articleCount = asAggregateInteger(articleCountRaw, 'articleCount', {
      nullable: false
    });
    if (articleCount === null) {
      throw new WeeklyFlowPersistenceError('articleCount was not returned by the database');
    }
    return { firstRssRequestId, firstRssArticleId, articleCount };
  }
});

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

const assertPhaseFourInProgress = (run: WeeklyFlowRunInstance): void => {
  if (
    run.runCompleted ||
    run.lastPhaseStarted !== 4 ||
    (run.lastPhaseCompleted ?? 0) !== 3
  ) {
    throw new WeeklyFlowPersistenceError('Phase 4 is not the active incomplete phase');
  }
};

const assertPhaseFiveInProgress = (run: WeeklyFlowRunInstance): void => {
  if (run.runCompleted || run.lastPhaseStarted !== 5 || (run.lastPhaseCompleted ?? 0) !== 4) {
    throw new WeeklyFlowPersistenceError('Phase 5 is not the active incomplete phase');
  }
};

const assertPhaseSixInProgress = (run: WeeklyFlowRunInstance): void => {
  if (run.runCompleted || run.lastPhaseStarted !== 6 || (run.lastPhaseCompleted ?? 0) !== 5) {
    throw new WeeklyFlowPersistenceError('Phase 6 is not the active incomplete phase');
  }
};

const phaseRecord = (phaseData: unknown, phase: WeeklyFlowPhase): JsonRecord => {
  const value = asJsonRecord(phaseData)[phaseKey(phase)];
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
};

const requirePhaseFourMarks = (run: WeeklyFlowRunInstance): PhaseFourHighWaterMarks => {
  const newsApiRequestIdHighWaterMark = asNullableNonNegativeSafeInteger(
    run.newsApiRequestIdHighWaterMark,
    'newsApiRequestIdHighWaterMark'
  );
  const articleIdHighWaterMark = asNullableNonNegativeSafeInteger(
    run.articleIdHighWaterMark,
    'articleIdHighWaterMark'
  );
  if (newsApiRequestIdHighWaterMark === null || articleIdHighWaterMark === null) {
    throw new WeeklyFlowPersistenceError('Phase 4 high-water marks are missing');
  }
  return { newsApiRequestIdHighWaterMark, articleIdHighWaterMark };
};

const requirePhaseSixInputs = (run: WeeklyFlowRunInstance): {
  targetArticleStateReviewCount: number;
  targetArticleThresholdDaysOld: number;
} => {
  const targetArticleStateReviewCount = requirePositiveSafeInteger(
    run.articleCount,
    'Phase 6 articleCount'
  );
  const targetArticleThresholdDaysOld = requirePositiveSafeInteger(
    run.targetArticleThresholdDaysOld,
    'Phase 6 targetArticleThresholdDaysOld'
  );
  const input = phaseRecord(run.phaseData, 6).input;
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new WeeklyFlowPersistenceError('Phase 6 input audit mirror is missing');
  }
  const mirror = input as JsonRecord;
  if (
    mirror.targetArticleStateReviewCount !== targetArticleStateReviewCount ||
    mirror.targetArticleThresholdDaysOld !== targetArticleThresholdDaysOld
  ) {
    throw new WeeklyFlowPersistenceError('Phase 6 input audit mirror does not match its columns');
  }
  return { targetArticleStateReviewCount, targetArticleThresholdDaysOld };
};

const serializePhaseSixIncompatibleRecovery = (
  recovery: PhaseSixIncompatibleContractRecovery
): JsonRecord => {
  requireValidDate(recovery.detectedAt, 'Phase 6 incompatible-contract detection time');
  if (recovery.cancellationRequestedAt) {
    requireValidDate(
      recovery.cancellationRequestedAt,
      'Phase 6 incompatible-contract cancellation time'
    );
  }
  if (recovery.replacementStartedAt) {
    requireValidDate(
      recovery.replacementStartedAt,
      'Phase 6 incompatible-contract replacement time'
    );
  }
  if (
    !Array.isArray(recovery.missingParameterFields) ||
    recovery.missingParameterFields.length === 0 ||
    recovery.missingParameterFields.some(
      (field) => typeof field !== 'string' || field.trim() === ''
    )
  ) {
    throw new WeeklyFlowPersistenceError(
      'Phase 6 incompatible-contract missing fields must be non-empty strings'
    );
  }
  return {
    sourceJobId: requireNonEmptyString(recovery.sourceJobId, 'sourceJobId'),
    sourceJobCreatedAt: requireTimestampString(
      recovery.sourceJobCreatedAt,
      'sourceJobCreatedAt'
    ),
    detectedAt: recovery.detectedAt.toISOString(),
    missingParameterFields: [...recovery.missingParameterFields],
    lastStatus: requireNonEmptyString(recovery.lastStatus, 'lastStatus'),
    ...(recovery.cancellationRequestedAt
      ? { cancellationRequestedAt: recovery.cancellationRequestedAt.toISOString() }
      : {}),
    ...(recovery.cancellationOutcome
      ? { cancellationOutcome: requireNonEmptyString(recovery.cancellationOutcome, 'cancellationOutcome') }
      : {}),
    ...(recovery.verification
      ? { verification: asJsonRecord(recovery.verification) }
      : {}),
    ...(recovery.replacementStartedAt
      ? { replacementStartedAt: recovery.replacementStartedAt.toISOString() }
      : {}),
    ...(recovery.replacementJobId
      ? { replacementJobId: requireNonEmptyString(recovery.replacementJobId, 'replacementJobId') }
      : {})
  };
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
  model: WeeklyFlowRunModel,
  phaseFourDataStore?: PhaseFourDataStore
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
    if (phase === 4) {
      throw new WeeklyFlowPersistenceError(
        'Phase 4 must start through recordPhaseFourStarted'
      );
    }

    if (phase === 6) {
      throw new WeeklyFlowPersistenceError(
        'Phase 6 must start through its dedicated persistence operation recordPhaseSixStarted'
      );
    }
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

  async recordPhaseFourStarted(runId, startedAt) {
    requireValidDate(startedAt, 'Phase 4 start time');
    return performPersistenceOperation('Phase 4 start could not be persisted', async () => {
      if (!phaseFourDataStore) {
        throw new WeeklyFlowPersistenceError('Phase 4 data store is unavailable');
      }
      const run = await requireRun(model, runId);
      assertCanStartPhase(run, 4);
      if (
        run.newsApiRequestIdHighWaterMark !== null ||
        run.articleIdHighWaterMark !== null
      ) {
        throw new WeeklyFlowPersistenceError('Phase 4 high-water marks are already set');
      }
      const marks = await phaseFourDataStore.readHighWaterMarks();
      const newsApiRequestIdHighWaterMark = asAggregateInteger(
        marks.newsApiRequestIdHighWaterMark,
        'newsApiRequestIdHighWaterMark',
        { nullable: false }
      );
      const articleIdHighWaterMark = asAggregateInteger(
        marks.articleIdHighWaterMark,
        'articleIdHighWaterMark',
        { nullable: false }
      );
      if (
        newsApiRequestIdHighWaterMark === null ||
        articleIdHighWaterMark === null
      ) {
        throw new WeeklyFlowPersistenceError('Phase 4 high-water marks are missing');
      }
      await run.update({
        lastPhaseStarted: 4,
        newsApiRequestIdHighWaterMark,
        articleIdHighWaterMark,
        phaseData: mergePhaseData(run.phaseData, 4, {
          status: 'started',
          startedAt: startedAt.toISOString(),
          newsApiRequestIdHighWaterMark,
          articleIdHighWaterMark
        })
      });
      return toRunRecord(run);
    });
  },

  async recordPhaseFourProgress(runId, progress: PhaseFourProgress) {
    requireValidDate(progress.observedAt, 'Phase 4 progress time');
    return performPersistenceOperation('Phase 4 progress could not be persisted', async () => {
      const run = await requireRun(model, runId);
      assertPhaseFourInProgress(run);
      requirePhaseFourMarks(run);
      const rssJobId =
        progress.rssJobId === undefined
          ? run.rssJobId
          : requireNonEmptyString(progress.rssJobId, 'rssJobId');
      const status =
        progress.status === undefined
          ? undefined
          : requireNonEmptyString(progress.status, 'Phase 4 status');
      const reportedCount =
        progress.rssArticlesAddedCount === undefined
          ? undefined
          : asAggregateInteger(
              progress.rssArticlesAddedCount,
              'rssArticlesAddedCount',
              { nullable: false }
            );
      const rssArticlesAddedCount =
        reportedCount === undefined
          ? run.rssArticlesAddedCount
          : Math.max(run.rssArticlesAddedCount ?? 0, reportedCount ?? 0);
      const progressData: JsonRecord = {
        observedAt: progress.observedAt.toISOString()
      };
      if (rssJobId !== null) progressData.rssJobId = rssJobId;
      if (status !== undefined) progressData.status = status;
      if (rssArticlesAddedCount !== null) {
        progressData.rssArticlesAddedCount = rssArticlesAddedCount;
      }
      if (progress.details !== undefined) {
        progressData.details = asJsonRecord(progress.details);
      }
      await run.update({
        rssJobId,
        rssArticlesAddedCount,
        phaseData: mergePhaseData(run.phaseData, 4, {
          progress: progressData
        })
      });
      return toRunRecord(run);
    });
  },

  async readPhaseFourDatabaseResult(runId): Promise<PhaseFourDatabaseResult> {
    return performPersistenceOperation('Phase 4 database result lookup failed', async () => {
      if (!phaseFourDataStore) {
        throw new WeeklyFlowPersistenceError('Phase 4 data store is unavailable');
      }
      const run = await requireRun(model, runId);
      assertPhaseFourInProgress(run);
      const marks = requirePhaseFourMarks(run);
      const result = await phaseFourDataStore.readPostMarkResult(marks);
      return {
        firstRssRequestId: asNullableNonNegativeSafeInteger(
          result.firstRssRequestId,
          'firstRssRequestId'
        ),
        firstRssArticleId: asNullableNonNegativeSafeInteger(
          result.firstRssArticleId,
          'firstRssArticleId'
        ),
        articleCount:
          asAggregateInteger(result.articleCount, 'articleCount', { nullable: false }) ?? 0
      };
    });
  },

  async recordPhaseCompleted(runId, phase, completedAt, phaseResult, fields = {}) {
    if (phase === 5) {
      throw new WeeklyFlowPersistenceError(
        'Phase 5 must complete through recordPhaseFiveCompleted'
      );
    }

    if (phase === 6) {
      throw new WeeklyFlowPersistenceError(
        'Phase 6 must complete through its dedicated persistence operation recordPhaseSixCompleted'
      );
    }
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

  async recordPhaseFourCompleted(
    runId,
    completedAt,
    phaseResult,
    fields: PhaseFourNonzeroCompletionFields
  ) {
    requireValidDate(completedAt, 'Phase 4 completion time');
    return performPersistenceOperation('Phase 4 completion could not be persisted', async () => {
      const run = await requireRun(model, runId);
      assertCanCompletePhase(run, 4);
      requirePhaseFourMarks(run);
      const firstRssRequestId = asNullableNonNegativeSafeInteger(
        fields.firstRssRequestId,
        'firstRssRequestId'
      );
      const firstRssArticleId = asNullableNonNegativeSafeInteger(
        fields.firstRssArticleId,
        'firstRssArticleId'
      );
      const reportedRssCount = asNullableNonNegativeSafeInteger(
        fields.rssArticlesAddedCount,
        'rssArticlesAddedCount'
      );
      const rssArticlesAddedCount =
        reportedRssCount === null
          ? run.rssArticlesAddedCount
          : Math.max(run.rssArticlesAddedCount ?? 0, reportedRssCount);
      const articleCount = asAggregateInteger(fields.articleCount, 'articleCount', {
        nullable: false
      });
      if (articleCount === null || articleCount <= 0) {
        throw new WeeklyFlowPersistenceError(
          'Nonzero Phase 4 completion requires a positive articleCount'
        );
      }
      const rssJobId = requireNonEmptyString(fields.rssJobId ?? '', 'rssJobId');
      await run.update({
        firstRssRequestId,
        firstRssArticleId,
        rssArticlesAddedCount,
        articleCount,
        rssJobId,
        lastPhaseCompleted: 4,
        phaseData: mergePhaseData(run.phaseData, 4, {
          status: 'completed',
          completedAt: completedAt.toISOString(),
          result: asJsonRecord(phaseResult)
        })
      });
      return toRunRecord(run);
    });
  },

  async recordPhaseFourZeroWorkCompletion(
    runId,
    completedAt,
    phaseResult,
    fields: PhaseFourCompletionFields
  ) {
    requireValidDate(completedAt, 'Phase 4 completion time');
    return performPersistenceOperation('Phase 4 zero-work completion could not be persisted', async () => {
      const run = await requireRun(model, runId);
      assertCanCompletePhase(run, 4);
      requirePhaseFourMarks(run);
      const firstRssRequestId = asNullableNonNegativeSafeInteger(
        fields.firstRssRequestId,
        'firstRssRequestId'
      );
      const firstRssArticleId = asNullableNonNegativeSafeInteger(
        fields.firstRssArticleId,
        'firstRssArticleId'
      );
      if (firstRssArticleId !== null) {
        throw new WeeklyFlowPersistenceError(
          'Zero-work completion cannot contain a first RSS Article ID'
        );
      }
      const reportedRssCount = asNullableNonNegativeSafeInteger(
        fields.rssArticlesAddedCount,
        'rssArticlesAddedCount'
      );
      const rssArticlesAddedCount =
        reportedRssCount === null
          ? run.rssArticlesAddedCount
          : Math.max(run.rssArticlesAddedCount ?? 0, reportedRssCount);
      const rssJobId = requireNonEmptyString(fields.rssJobId ?? '', 'rssJobId');
      await run.update({
        firstRssRequestId,
        firstRssArticleId,
        rssArticlesAddedCount,
        articleCount: 0,
        rssJobId,
        lastPhaseCompleted: 4,
        phaseData: mergePhaseData(run.phaseData, 4, {
          status: 'completed',
          completedAt: completedAt.toISOString(),
          result: asJsonRecord(phaseResult)
        }),
        runCompleted: true,
        runCompletedAt: completedAt
      });
      return toRunRecord(run);
    });
  },

  async recordPhaseFiveStarted(runId, startedAt) {
    requireValidDate(startedAt, 'Phase 5 start time');
    return performPersistenceOperation('Phase 5 start could not be persisted', async () => {
      const run = await requireRun(model, runId);
      assertCanStartPhase(run, 5);
      if (run.articleCount === null || run.articleCount <= 0) {
        throw new WeeklyFlowPersistenceError('Phase 5 requires a positive articleCount');
      }
      if (run.lastPhaseStarted === 5 || phaseRecord(run.phaseData, 5).startedAt !== undefined) {
        throw new WeeklyFlowPersistenceError('Phase 5 has already started');
      }
      await run.update({
        lastPhaseStarted: 5,
        phaseData: mergePhaseData(run.phaseData, 5, {
          status: 'started',
          startedAt: startedAt.toISOString()
        })
      });
      return toRunRecord(run);
    });
  },

  async recordPhaseFiveProgress(runId, progress: PhaseFiveProgress) {
    requireValidDate(progress.observedAt, 'Phase 5 progress time');
    return performPersistenceOperation('Phase 5 progress could not be persisted', async () => {
      const run = await requireRun(model, runId);
      assertPhaseFiveInProgress(run);
      const existing = phaseRecord(run.phaseData, 5);
      if (typeof existing.startedAt !== 'string') {
        throw new WeeklyFlowPersistenceError('Phase 5 start timestamp is missing');
      }
      const jobId = progress.semanticScorerJobId === undefined
        ? run.semanticScorerJobId
        : requireNonEmptyString(progress.semanticScorerJobId, 'semanticScorerJobId');
      const latestProgress: JsonRecord = { observedAt: progress.observedAt.toISOString() };
      for (const [key, value] of Object.entries({
        jobId,
        status: progress.status === undefined
          ? undefined
          : requireNonEmptyString(progress.status, 'Phase 5 status'),
        jobCreatedAt: progress.jobCreatedAt === undefined
          ? undefined
          : requireTimestampString(progress.jobCreatedAt, 'jobCreatedAt'),
        startedAt: progress.startedAt === undefined
          ? undefined
          : requireTimestampString(progress.startedAt, 'startedAt'),
        endedAt: progress.endedAt === undefined
          ? undefined
          : requireTimestampString(progress.endedAt, 'endedAt'),
        failureReason: progress.failureReason === undefined
          ? undefined
          : requireNonEmptyString(progress.failureReason, 'failureReason')
      })) {
        if (value !== undefined && value !== null) latestProgress[key] = value;
      }
      const additions: JsonRecord = { latestProgress };
      if (progress.monitoringLimit) {
        const limit = progress.monitoringLimit;
        requireValidDate(limit.reachedAt, 'Phase 5 monitoring limit time');
        if (limit.cancellationRequestedAt) {
          requireValidDate(
            limit.cancellationRequestedAt,
            'Phase 5 cancellation request time'
          );
        }
        additions.monitoringLimit = {
          jobId: requireNonEmptyString(limit.jobId, 'monitoringLimit.jobId'),
          jobCreatedAt: requireTimestampString(
            limit.jobCreatedAt,
            'monitoringLimit.jobCreatedAt'
          ),
          reachedAt: limit.reachedAt.toISOString(),
          ...(limit.cancellationRequestedAt
            ? { cancellationRequestedAt: limit.cancellationRequestedAt.toISOString() }
            : {}),
          ...(limit.cancellationOutcome ? { cancellationOutcome: limit.cancellationOutcome } : {}),
          ...(limit.verification ? { verification: asJsonRecord(limit.verification) } : {})
        };
      }
      await run.update({
        semanticScorerJobId: jobId,
        phaseData: mergePhaseData(run.phaseData, 5, additions)
      });
      return toRunRecord(run);
    });
  },

  async recordPhaseFiveCompleted(
    runId,
    completedAt,
    phaseResult,
    fields: PhaseFiveCompletionFields
  ) {
    requireValidDate(completedAt, 'Phase 5 completion time');
    return performPersistenceOperation('Phase 5 completion could not be persisted', async () => {
      const run = await requireRun(model, runId);
      assertPhaseFiveInProgress(run);
      const jobId = requireNonEmptyString(fields.semanticScorerJobId, 'semanticScorerJobId');
      const jobCreatedAt = requireTimestampString(fields.jobCreatedAt, 'jobCreatedAt');
      if (run.semanticScorerJobId !== jobId) {
        throw new WeeklyFlowPersistenceError('Phase 5 completion job does not match the saved job');
      }
      const marker = phaseRecord(run.phaseData, 5).monitoringLimit;
      if (typeof marker === 'object' && marker !== null && !Array.isArray(marker)) {
        const value = marker as JsonRecord;
        if (value.jobId === jobId && value.jobCreatedAt === jobCreatedAt) {
          throw new WeeklyFlowPersistenceError('A monitoring-limited job cannot complete Phase 5');
        }
      }
      await run.update({
        semanticScorerJobId: jobId,
        lastPhaseCompleted: 5,
        phaseData: mergePhaseData(run.phaseData, 5, {
          status: 'completed',
          completedAt: completedAt.toISOString(),
          result: asJsonRecord(phaseResult)
        })
      });
      return toRunRecord(run);
    });
  },

  async recordPhaseSixStarted(runId, startedAt, targetArticleThresholdDaysOld) {
    requireValidDate(startedAt, 'Phase 6 start time');
    const threshold = requirePositiveSafeInteger(
      targetArticleThresholdDaysOld,
      'targetArticleThresholdDaysOld'
    );
    return performPersistenceOperation('Phase 6 start could not be persisted', async () => {
      const run = await requireRun(model, runId);
      assertCanStartPhase(run, 6);
      const articleCount = requirePositiveSafeInteger(run.articleCount, 'Phase 6 articleCount');
      if (
        run.targetArticleThresholdDaysOld !== null ||
        phaseRecord(run.phaseData, 6).startedAt !== undefined
      ) {
        throw new WeeklyFlowPersistenceError('Phase 6 has already started');
      }
      await run.update({
        lastPhaseStarted: 6,
        targetArticleThresholdDaysOld: threshold,
        phaseData: mergePhaseData(run.phaseData, 6, {
          status: 'started',
          startedAt: startedAt.toISOString(),
          input: {
            targetArticleStateReviewCount: articleCount,
            targetArticleThresholdDaysOld: threshold
          }
        })
      });
      return toRunRecord(run);
    });
  },

  async recordPhaseSixProgress(runId, progress: PhaseSixProgress) {
    requireValidDate(progress.observedAt, 'Phase 6 progress time');
    return performPersistenceOperation('Phase 6 progress could not be persisted', async () => {
      const run = await requireRun(model, runId);
      assertPhaseSixInProgress(run);
      requirePhaseSixInputs(run);
      const existing = phaseRecord(run.phaseData, 6);
      if (typeof existing.startedAt !== 'string') {
        throw new WeeklyFlowPersistenceError('Phase 6 start timestamp is missing');
      }
      const jobId = progress.stateAssignerJobId === undefined
        ? run.stateAssignerJobId
        : requireNonEmptyString(progress.stateAssignerJobId, 'stateAssignerJobId');
      const latestProgress: JsonRecord = { observedAt: progress.observedAt.toISOString() };
      for (const [key, value] of Object.entries({
        jobId,
        status: progress.status === undefined
          ? undefined
          : requireNonEmptyString(progress.status, 'Phase 6 status'),
        jobCreatedAt: progress.jobCreatedAt === undefined
          ? undefined
          : requireTimestampString(progress.jobCreatedAt, 'jobCreatedAt'),
        startedAt: progress.startedAt === undefined
          ? undefined
          : requireTimestampString(progress.startedAt, 'startedAt'),
        endedAt: progress.endedAt === undefined
          ? undefined
          : requireTimestampString(progress.endedAt, 'endedAt'),
        failureReason: progress.failureReason === undefined
          ? undefined
          : requireNonEmptyString(progress.failureReason, 'failureReason'),
        selectedCount: progress.selectedCount === undefined
          ? undefined
          : requireNonnegativeSafeInteger(progress.selectedCount, 'selectedCount')
      })) {
        if (value !== undefined && value !== null) latestProgress[key] = value;
      }
      const additions: JsonRecord = { latestProgress };
      if (progress.monitoringLimit) {
        const limit = progress.monitoringLimit;
        requireValidDate(limit.reachedAt, 'Phase 6 monitoring limit time');
        if (limit.cancellationRequestedAt) {
          requireValidDate(limit.cancellationRequestedAt, 'Phase 6 cancellation request time');
        }
        additions.monitoringLimit = {
          jobId: requireNonEmptyString(limit.jobId, 'monitoringLimit.jobId'),
          jobCreatedAt: requireTimestampString(
            limit.jobCreatedAt,
            'monitoringLimit.jobCreatedAt'
          ),
          reachedAt: limit.reachedAt.toISOString(),
          ...(limit.cancellationRequestedAt
            ? { cancellationRequestedAt: limit.cancellationRequestedAt.toISOString() }
            : {}),
          ...(limit.cancellationOutcome
            ? { cancellationOutcome: limit.cancellationOutcome }
            : {}),
          ...(limit.verification
            ? { verification: asJsonRecord(limit.verification) }
            : {})
        };
      }
      if (progress.incompatibleContractRecovery) {
        additions.incompatibleContractRecovery = serializePhaseSixIncompatibleRecovery(
          progress.incompatibleContractRecovery
        );
      }
      await run.update({
        stateAssignerJobId: jobId,
        phaseData: mergePhaseData(run.phaseData, 6, additions)
      });
      return toRunRecord(run);
    });
  },

  async recordPhaseSixIncompatibleReplacementStarted(
    runId,
    replacementJobId,
    replacementStartedAt
  ) {
    requireValidDate(replacementStartedAt, 'Phase 6 replacement start time');
    return performPersistenceOperation(
      'Phase 6 incompatible-contract replacement could not be persisted',
      async () => {
        const run = await requireRun(model, runId);
        assertPhaseSixInProgress(run);
        requirePhaseSixInputs(run);
        const phase6 = phaseRecord(run.phaseData, 6);
        const rawMarker = phase6.incompatibleContractRecovery;
        if (typeof rawMarker !== 'object' || rawMarker === null || Array.isArray(rawMarker)) {
          throw new WeeklyFlowPersistenceError(
            'Phase 6 incompatible-contract recovery marker is missing'
          );
        }
        const marker = rawMarker as JsonRecord;
        if (marker.replacementJobId !== undefined) {
          throw new WeeklyFlowPersistenceError(
            'Phase 6 incompatible-contract replacement was already consumed'
          );
        }
        const jobId = requireNonEmptyString(replacementJobId, 'replacementJobId');
        await run.update({
          stateAssignerJobId: jobId,
          phaseData: mergePhaseData(run.phaseData, 6, {
            incompatibleContractRecovery: {
              ...marker,
              replacementStartedAt: replacementStartedAt.toISOString(),
              replacementJobId: jobId
            },
            latestProgress: {
              observedAt: replacementStartedAt.toISOString(),
              jobId,
              status: 'replacement_started'
            }
          })
        });
        return toRunRecord(run);
      }
    );
  },

  async recordPhaseSixCompleted(
    runId,
    completedAt,
    phaseResult,
    fields: PhaseSixCompletionFields
  ) {
    requireValidDate(completedAt, 'Phase 6 completion time');
    return performPersistenceOperation('Phase 6 completion could not be persisted', async () => {
      const run = await requireRun(model, runId);
      assertPhaseSixInProgress(run);
      const inputs = requirePhaseSixInputs(run);
      const jobId = requireNonEmptyString(fields.stateAssignerJobId, 'stateAssignerJobId');
      const jobCreatedAt = requireTimestampString(fields.jobCreatedAt, 'jobCreatedAt');
      if (run.stateAssignerJobId !== jobId) {
        throw new WeeklyFlowPersistenceError('Phase 6 completion job does not match the saved job');
      }
      const phase6 = phaseRecord(run.phaseData, 6);
      const monitoringMarker = phase6.monitoringLimit;
      if (
        typeof monitoringMarker === 'object' &&
        monitoringMarker !== null &&
        !Array.isArray(monitoringMarker)
      ) {
        const marker = monitoringMarker as JsonRecord;
        if (marker.jobId === jobId && marker.jobCreatedAt === jobCreatedAt) {
          throw new WeeklyFlowPersistenceError('A monitoring-limited job cannot complete Phase 6');
        }
      }
      const incompatibleMarker = phase6.incompatibleContractRecovery;
      if (
        typeof incompatibleMarker === 'object' &&
        incompatibleMarker !== null &&
        !Array.isArray(incompatibleMarker)
      ) {
        const marker = incompatibleMarker as JsonRecord;
        if (marker.sourceJobId === jobId && marker.sourceJobCreatedAt === jobCreatedAt) {
          throw new WeeklyFlowPersistenceError('An incompatible source job cannot complete Phase 6');
        }
        if (marker.replacementJobId !== undefined && marker.replacementJobId !== jobId) {
          throw new WeeklyFlowPersistenceError(
            'Phase 6 completion job does not match the incompatible-contract replacement'
          );
        }
      }
      const result = asJsonRecord(phaseResult);
      const selectedCount = requireNonnegativeSafeInteger(result.selectedCount, 'selectedCount');
      const completedCount = requireNonnegativeSafeInteger(result.completedCount, 'completedCount');
      const skippedCount = requireNonnegativeSafeInteger(result.skippedCount, 'skippedCount');
      const failedCount = requireNonnegativeSafeInteger(result.failedCount, 'failedCount');
      if (selectedCount !== completedCount + skippedCount + failedCount) {
        throw new WeeklyFlowPersistenceError('Phase 6 result counts are inconsistent');
      }
      if (selectedCount > inputs.targetArticleStateReviewCount) {
        throw new WeeklyFlowPersistenceError('Phase 6 selectedCount exceeds articleCount');
      }
      if (
        result.targetArticleStateReviewCount !== inputs.targetArticleStateReviewCount ||
        result.targetArticleThresholdDaysOld !== inputs.targetArticleThresholdDaysOld
      ) {
        throw new WeeklyFlowPersistenceError('Phase 6 result inputs do not match persisted inputs');
      }
      await run.update({
        stateAssignerJobId: jobId,
        lastPhaseCompleted: 6,
        phaseData: mergePhaseData(run.phaseData, 6, {
          status: 'completed',
          completedAt: completedAt.toISOString(),
          result
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
      persistence: createSequelizeWeeklyFlowPersistence(
        models.WeeklyArticleFlowRun02,
        createSequelizePhaseFourDataStore({
          Article: models.Article,
          NewsApiRequest: models.NewsApiRequest,
          NewsArticleAggregatorSource: models.NewsArticleAggregatorSource
        })
      ),
      close: async () => dbModels.sequelize.close()
    };
  } catch (error: unknown) {
    if (error instanceof Error && /^Missing required environment variable: PG_/.test(error.message)) {
      throw new WeeklyFlowPersistenceError(error.message, { cause: error });
    }
    throw new WeeklyFlowPersistenceError('Weekly flow persistence initialization failed', {
      cause: error
    });
  }
}
