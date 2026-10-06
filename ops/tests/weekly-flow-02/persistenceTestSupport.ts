import type {
  PhaseFourDatabaseResult,
  PhaseFourHighWaterMarks,
  WeeklyFlowPersistence,
  WeeklyFlowRunRecord
} from '../../src/weekly-flow-02/persistence';
import {
  parsePhaseSixIncompatibleRecovery,
  serializePhaseSixIncompatibleRecovery,
  upsertPhaseSixIncompatibleAttempt,
  type PhaseSixIncompatibleRecoveryV06
} from '../../src/weekly-flow-02/phaseSixRecoveryState';

const mergePhaseSixRecovery = (
  existing: unknown,
  incoming?: PhaseSixIncompatibleRecoveryV06
): PhaseSixIncompatibleRecoveryV06 | null => {
  let recovery = parsePhaseSixIncompatibleRecovery(existing);
  if (incoming === undefined) return recovery;
  const validated = parsePhaseSixIncompatibleRecovery(
    serializePhaseSixIncompatibleRecovery(incoming)
  );
  for (const attempt of validated?.attempts ?? []) {
    recovery = upsertPhaseSixIncompatibleAttempt(recovery, attempt);
  }
  return recovery;
};

const cloneRun = (run: WeeklyFlowRunRecord): WeeklyFlowRunRecord => ({
  ...run,
  phaseData: structuredClone(run.phaseData),
  lastError: run.lastError ? structuredClone(run.lastError) : null
});

export interface InMemoryPersistence {
  persistence: WeeklyFlowPersistence;
  runs: WeeklyFlowRunRecord[];
  calls: string[];
}

interface InMemoryPersistenceOptions {
  phaseFourHighWaterMarks?: PhaseFourHighWaterMarks;
  phaseFourDatabaseResult?: PhaseFourDatabaseResult;
}

export const createRunRecord = (
  overrides: Partial<WeeklyFlowRunRecord> = {}
): WeeklyFlowRunRecord => {
  const startedAt = new Date('2026-10-03T12:00:00.000Z');
  return {
    id: 1,
    runStartedAt: startedAt,
    runCompleted: false,
    runCompletedAt: null,
    lastPhaseStarted: null,
    lastPhaseCompleted: null,
    phaseData: {},
    lastError: null,
    backupPath: null,
    backupByteSize: null,
    backupSha256: null,
    backupManifestVersion: null,
    newsApiRequestIdHighWaterMark: null,
    articleIdHighWaterMark: null,
    firstRssRequestId: null,
    firstRssArticleId: null,
    rssArticlesAddedCount: null,
    articleCount: null,
    rssJobId: null,
    semanticScorerJobId: null,
    stateAssignerJobId: null,
    aiApproverV02JobId: null,
    targetArticleThresholdDaysOld: null,
    createdAt: startedAt,
    updatedAt: startedAt,
    ...overrides
  };
};

export const createInMemoryPersistence = (
  initialRuns: WeeklyFlowRunRecord[] = [],
  options: InMemoryPersistenceOptions = {}
): InMemoryPersistence => {
  const runs = initialRuns.map(cloneRun);
  const calls: string[] = [];
  const requireRun = (runId: number): WeeklyFlowRunRecord => {
    const run = runs.find((candidate) => candidate.id === runId);
    if (!run) throw new Error(`Run ${runId} not found`);
    return run;
  };
  const touch = (run: WeeklyFlowRunRecord, at: Date): WeeklyFlowRunRecord => {
    run.updatedAt = at;
    return cloneRun(run);
  };

  const persistence: WeeklyFlowPersistence = {
    async getLatestRun() {
      calls.push('get-latest');
      const latest = [...runs].sort((left, right) => right.id - left.id)[0];
      return latest ? cloneRun(latest) : null;
    },
    async getRunById(runId) {
      calls.push(`get:${runId}`);
      const run = runs.find((candidate) => candidate.id === runId);
      return run ? cloneRun(run) : null;
    },
    async createRun(runStartedAt) {
      calls.push('create');
      const run = createRunRecord({
        id: runs.reduce((highest, candidate) => Math.max(highest, candidate.id), 0) + 1,
        runStartedAt,
        createdAt: runStartedAt,
        updatedAt: runStartedAt
      });
      runs.push(run);
      return cloneRun(run);
    },
    async recordPhaseStarted(runId, phase, startedAt) {
      calls.push(`start:${phase}`);
      if (phase === 7) throw new Error('Phase 7 requires dedicated start');
      const run = requireRun(runId);
      run.lastPhaseStarted = phase;
      run.phaseData[`phase${phase}`] = {
        status: 'started',
        startedAt: startedAt.toISOString()
      };
      return touch(run, startedAt);
    },
    async recordPhaseFourStarted(runId, startedAt) {
      calls.push('start:4');
      const run = requireRun(runId);
      const marks = options.phaseFourHighWaterMarks ?? {
        newsApiRequestIdHighWaterMark: 100,
        articleIdHighWaterMark: 200
      };
      run.lastPhaseStarted = 4;
      run.newsApiRequestIdHighWaterMark = marks.newsApiRequestIdHighWaterMark;
      run.articleIdHighWaterMark = marks.articleIdHighWaterMark;
      run.phaseData.phase4 = {
        status: 'started',
        startedAt: startedAt.toISOString(),
        ...marks
      };
      return touch(run, startedAt);
    },
    async recordPhaseFourProgress(runId, progress) {
      calls.push('progress:4');
      const run = requireRun(runId);
      if (progress.rssJobId !== undefined) run.rssJobId = progress.rssJobId;
      if (progress.rssArticlesAddedCount !== undefined) {
        run.rssArticlesAddedCount = Math.max(
          run.rssArticlesAddedCount ?? 0,
          progress.rssArticlesAddedCount
        );
      }
      run.phaseData.phase4 = {
        ...(run.phaseData.phase4 as Record<string, unknown>),
        progress: {
          observedAt: progress.observedAt.toISOString(),
          ...(progress.rssJobId === undefined ? {} : { rssJobId: progress.rssJobId }),
          ...(progress.status === undefined ? {} : { status: progress.status }),
          ...(progress.rssArticlesAddedCount === undefined
            ? {}
            : { rssArticlesAddedCount: run.rssArticlesAddedCount }),
          ...(progress.details === undefined ? {} : { details: structuredClone(progress.details) })
        }
      };
      return touch(run, progress.observedAt);
    },
    async readPhaseFourDatabaseResult(runId) {
      calls.push('database-result:4');
      requireRun(runId);
      return structuredClone(
        options.phaseFourDatabaseResult ?? {
          firstRssRequestId: 101,
          firstRssArticleId: 201,
          articleCount: 1
        }
      );
    },
    async recordPhaseCompleted(runId, phase, completedAt, phaseResult, fields = {}) {
      calls.push(`complete:${phase}`);
      if (phase === 6 || phase === 7) throw new Error(`Phase ${phase} requires dedicated completion`);
      const run = requireRun(runId);
      run.lastPhaseCompleted = phase;
      Object.assign(run, fields);
      run.phaseData[`phase${phase}`] = {
        ...(run.phaseData[`phase${phase}`] as Record<string, unknown>),
        status: 'completed',
        completedAt: completedAt.toISOString(),
        result: structuredClone(phaseResult)
      };
      return touch(run, completedAt);
    },
    async recordPhaseFourCompleted(runId, completedAt, phaseResult, fields) {
      calls.push('complete:4');
      const run = requireRun(runId);
      run.lastPhaseCompleted = 4;
      run.firstRssRequestId = fields.firstRssRequestId;
      run.firstRssArticleId = fields.firstRssArticleId;
      run.rssArticlesAddedCount =
        fields.rssArticlesAddedCount === null
          ? run.rssArticlesAddedCount
          : Math.max(run.rssArticlesAddedCount ?? 0, fields.rssArticlesAddedCount);
      run.articleCount = fields.articleCount;
      run.rssJobId = fields.rssJobId;
      run.phaseData.phase4 = {
        ...(run.phaseData.phase4 as Record<string, unknown>),
        status: 'completed',
        completedAt: completedAt.toISOString(),
        result: structuredClone(phaseResult)
      };
      return touch(run, completedAt);
    },
    async recordPhaseFourZeroWorkCompletion(runId, completedAt, phaseResult, fields) {
      calls.push('complete-zero:4');
      const run = requireRun(runId);
      run.lastPhaseCompleted = 4;
      run.firstRssRequestId = fields.firstRssRequestId;
      run.firstRssArticleId = fields.firstRssArticleId;
      run.rssArticlesAddedCount =
        fields.rssArticlesAddedCount === null
          ? run.rssArticlesAddedCount
          : Math.max(run.rssArticlesAddedCount ?? 0, fields.rssArticlesAddedCount);
      run.articleCount = 0;
      run.rssJobId = fields.rssJobId;
      run.runCompleted = true;
      run.runCompletedAt = completedAt;
      run.phaseData.phase4 = {
        ...(run.phaseData.phase4 as Record<string, unknown>),
        status: 'completed',
        completedAt: completedAt.toISOString(),
        result: structuredClone(phaseResult)
      };
      return touch(run, completedAt);
    },
    async recordPhaseFiveStarted(runId, startedAt) {
      calls.push('start:5');
      const run = requireRun(runId);
      if (run.lastPhaseStarted === 5) throw new Error('Phase 5 has already started');
      run.lastPhaseStarted = 5;
      run.phaseData.phase5 = { status: 'started', startedAt: startedAt.toISOString() };
      return touch(run, startedAt);
    },
    async recordPhaseFiveProgress(runId, progress) {
      calls.push('progress:5');
      const run = requireRun(runId);
      if (progress.semanticScorerJobId !== undefined) {
        run.semanticScorerJobId = progress.semanticScorerJobId;
      }
      const existing = (run.phaseData.phase5 as Record<string, unknown>) ?? {};
      const latestProgress: Record<string, unknown> = { observedAt: progress.observedAt.toISOString() };
      for (const [key, value] of Object.entries({
        jobId: run.semanticScorerJobId,
        status: progress.status,
        jobCreatedAt: progress.jobCreatedAt,
        startedAt: progress.startedAt,
        endedAt: progress.endedAt,
        failureReason: progress.failureReason
      })) if (value !== undefined && value !== null) latestProgress[key] = value;
      run.phaseData.phase5 = {
        ...existing,
        latestProgress,
        ...(progress.monitoringLimit
          ? {
              monitoringLimit: {
                jobId: progress.monitoringLimit.jobId,
                jobCreatedAt: progress.monitoringLimit.jobCreatedAt,
                reachedAt: progress.monitoringLimit.reachedAt.toISOString(),
                ...(progress.monitoringLimit.cancellationRequestedAt
                  ? {
                      cancellationRequestedAt:
                        progress.monitoringLimit.cancellationRequestedAt.toISOString()
                    }
                  : {}),
                ...(progress.monitoringLimit.cancellationOutcome
                  ? { cancellationOutcome: progress.monitoringLimit.cancellationOutcome }
                  : {}),
                ...(progress.monitoringLimit.verification
                  ? { verification: structuredClone(progress.monitoringLimit.verification) }
                  : {})
              }
            }
          : {})
      };
      return touch(run, progress.observedAt);
    },
    async recordPhaseFiveCompleted(runId, completedAt, phaseResult, fields) {
      calls.push('complete:5');
      const run = requireRun(runId);
      const phase5 = (run.phaseData.phase5 as Record<string, unknown>) ?? {};
      const marker = phase5.monitoringLimit as Record<string, unknown> | undefined;
      if (marker?.jobId === fields.semanticScorerJobId && marker.jobCreatedAt === fields.jobCreatedAt) {
        throw new Error('A monitoring-limited job cannot complete Phase 5');
      }
      run.semanticScorerJobId = fields.semanticScorerJobId;
      run.lastPhaseCompleted = 5;
      run.phaseData.phase5 = {
        ...phase5,
        status: 'completed',
        completedAt: completedAt.toISOString(),
        result: structuredClone(phaseResult)
      };
      return touch(run, completedAt);
    },
    async recordPhaseSixStarted(runId, startedAt, targetArticleThresholdDaysOld) {
      calls.push('start:6');
      const run = requireRun(runId);
      if (run.lastPhaseStarted === 6) throw new Error('Phase 6 has already started');
      if (run.lastPhaseCompleted !== 5 || !run.articleCount || run.articleCount <= 0) {
        throw new Error('Phase 6 requires completed Phase 5 and positive articleCount');
      }
      run.lastPhaseStarted = 6;
      run.targetArticleThresholdDaysOld = targetArticleThresholdDaysOld;
      run.phaseData.phase6 = {
        status: 'started',
        startedAt: startedAt.toISOString(),
        input: {
          targetArticleStateReviewCount: run.articleCount,
          targetArticleThresholdDaysOld
        }
      };
      return touch(run, startedAt);
    },
    async recordPhaseSixProgress(runId, progress) {
      calls.push('progress:6');
      const run = requireRun(runId);
      if (progress.stateAssignerJobId !== undefined) {
        run.stateAssignerJobId = progress.stateAssignerJobId;
      }
      const existing = (run.phaseData.phase6 as Record<string, unknown>) ?? {};
      const latestProgress: Record<string, unknown> = {
        observedAt: progress.observedAt.toISOString()
      };
      for (const [key, value] of Object.entries({
        jobId: run.stateAssignerJobId,
        status: progress.status,
        jobCreatedAt: progress.jobCreatedAt,
        startedAt: progress.startedAt,
        endedAt: progress.endedAt,
        failureReason: progress.failureReason,
        selectedCount: progress.selectedCount
      })) {
        if (value !== undefined && value !== null) latestProgress[key] = value;
      }
      const recovery = mergePhaseSixRecovery(
        existing.incompatibleContractRecovery,
        progress.incompatibleContractRecovery
      );
      run.phaseData.phase6 = {
        ...existing,
        latestProgress,
        ...(progress.monitoringLimit
          ? {
              monitoringLimit: {
                jobId: progress.monitoringLimit.jobId,
                jobCreatedAt: progress.monitoringLimit.jobCreatedAt,
                reachedAt: progress.monitoringLimit.reachedAt.toISOString(),
                ...(progress.monitoringLimit.cancellationRequestedAt
                  ? {
                      cancellationRequestedAt:
                        progress.monitoringLimit.cancellationRequestedAt.toISOString()
                    }
                  : {}),
                ...(progress.monitoringLimit.cancellationOutcome
                  ? { cancellationOutcome: progress.monitoringLimit.cancellationOutcome }
                  : {}),
                ...(progress.monitoringLimit.verification
                  ? { verification: structuredClone(progress.monitoringLimit.verification) }
                  : {})
              }
            }
          : {}),
        ...(recovery
          ? {
              incompatibleContractRecovery: serializePhaseSixIncompatibleRecovery(recovery)
            }
          : {})
      };
      return touch(run, progress.observedAt);
    },
    async recordPhaseSixContinuationJobStarted(
      runId,
      expectedPriorJobId,
      continuationJobId,
      continuationStartedAt,
      reason
    ) {
      calls.push('continuation:6');
      const run = requireRun(runId);
      if (run.lastPhaseStarted !== 6 || run.lastPhaseCompleted !== 5) {
        throw new Error('Phase 6 is not active');
      }
      if (run.stateAssignerJobId !== expectedPriorJobId) {
        throw new Error('Phase 6 continuation prior job does not match the saved job');
      }
      const phase6 = (run.phaseData.phase6 as Record<string, unknown>) ?? {};
      const input = phase6.input as Record<string, unknown> | undefined;
      if (
        !input ||
        input.targetArticleStateReviewCount !== run.articleCount ||
        input.targetArticleThresholdDaysOld !== run.targetArticleThresholdDaysOld
      ) {
        throw new Error('Phase 6 input audit mirror does not match its columns');
      }
      if (![
        'saved_job_failed',
        'saved_job_canceled',
        'saved_job_unavailable',
        'monitoring_limited',
        'incompatible_contract'
      ].includes(reason)) {
        throw new Error('Phase 6 continuation reason is invalid');
      }
      const recovery = parsePhaseSixIncompatibleRecovery(
        phase6.incompatibleContractRecovery
      );
      run.stateAssignerJobId = continuationJobId;
      run.phaseData.phase6 = {
        ...phase6,
        ...(recovery
          ? { incompatibleContractRecovery: serializePhaseSixIncompatibleRecovery(recovery) }
          : {}),
        latestProgress: {
          observedAt: continuationStartedAt.toISOString(),
          jobId: continuationJobId,
          status: 'continuation_started',
          priorJobId: expectedPriorJobId,
          reason
        }
      };
      return touch(run, continuationStartedAt);
    },
    async recordPhaseSixCompleted(runId, completedAt, phaseResult, fields) {
      calls.push('complete:6');
      const run = requireRun(runId);
      if (run.stateAssignerJobId !== fields.stateAssignerJobId) {
        throw new Error('Phase 6 completion job does not match the saved job');
      }
      const phase6 = (run.phaseData.phase6 as Record<string, unknown>) ?? {};
      const monitoring = phase6.monitoringLimit as Record<string, unknown> | undefined;
      if (
        monitoring?.jobId === fields.stateAssignerJobId &&
        monitoring.jobCreatedAt === fields.jobCreatedAt
      ) {
        throw new Error('A monitoring-limited job cannot complete Phase 6');
      }
      const incompatible = parsePhaseSixIncompatibleRecovery(
        phase6.incompatibleContractRecovery
      );
      if (
        incompatible?.attempts.some(
          (attempt) =>
            attempt.jobId === fields.stateAssignerJobId &&
            attempt.jobCreatedAt === fields.jobCreatedAt
        )
      ) {
        throw new Error('An incompatible job cannot complete Phase 6');
      }
      run.lastPhaseCompleted = 6;
      run.phaseData.phase6 = {
        ...phase6,
        status: 'completed',
        completedAt: completedAt.toISOString(),
        result: structuredClone(phaseResult),
        ...(incompatible
          ? { incompatibleContractRecovery: serializePhaseSixIncompatibleRecovery(incompatible) }
          : {})
      };
      return touch(run, completedAt);
    },
    async recordPhaseSevenStarted(runId, startedAt, inputs) {
      calls.push('start:7');
      const run = requireRun(runId);
      if (run.lastPhaseCompleted !== 6 || run.lastPhaseStarted === 7 || run.runCompleted) {
        throw new Error('Phase 7 cannot start');
      }
      if (
        inputs.selectionMode !== 'article_position_count' ||
        inputs.requestedArticleCount !== run.articleCount ||
        inputs.allowPastApprovedBoundary !== true ||
        inputs.allowDescriptionFallback !== true
      ) {
        throw new Error('Phase 7 inputs are invalid');
      }
      run.lastPhaseStarted = 7;
      run.aiApproverV02JobId = null;
      run.phaseData.phase7 = {
        status: 'started',
        startedAt: startedAt.toISOString(),
        input: structuredClone(inputs),
        attempts: []
      };
      return touch(run, startedAt);
    },
    async recordPhaseSevenPreview(
      runId,
      preview,
      expectedCurrentV02RunId,
      expectedCurrentJobId
    ) {
      calls.push('preview:7');
      const run = requireRun(runId);
      const phase7 = (run.phaseData.phase7 as Record<string, unknown>) ?? {};
      if (
        run.lastPhaseStarted !== 7 ||
        run.lastPhaseCompleted !== 6 ||
        (phase7.currentV02RunId ?? null) !== expectedCurrentV02RunId ||
        run.aiApproverV02JobId !== expectedCurrentJobId
      ) {
        throw new Error('Phase 7 preview expected identity does not match');
      }
      const attempts = structuredClone((phase7.attempts as Record<string, unknown>[]) ?? []);
      if (attempts.some((attempt) => attempt.v02RunId === preview.v02RunId)) {
        throw new Error('Phase 7 preview run ID is already recorded');
      }
      attempts.push({ ...structuredClone(preview) });
      run.aiApproverV02JobId = null;
      run.phaseData.phase7 = {
        ...phase7,
        attempts,
        currentV02RunId: preview.v02RunId,
        latestProgress: {
          observedAt: preview.previewCreatedAt,
          status: 'preview_created',
          v02RunId: preview.v02RunId
        }
      };
      return touch(run, new Date(preview.previewCreatedAt));
    },
    async recordPhaseSevenJobBound(runId, v02RunId, jobId, observedAt, acceptedStatus) {
      calls.push('bind:7');
      const run = requireRun(runId);
      const phase7 = (run.phaseData.phase7 as Record<string, unknown>) ?? {};
      if (phase7.currentV02RunId !== v02RunId) throw new Error('Phase 7 current run mismatch');
      const attempts = structuredClone((phase7.attempts as Record<string, unknown>[]) ?? []);
      const attempt = attempts.find((entry) => entry.v02RunId === v02RunId);
      if (!attempt) throw new Error('Phase 7 current attempt is missing');
      if (
        (attempt.jobId !== undefined && attempt.jobId !== jobId) ||
        (run.aiApproverV02JobId !== null && run.aiApproverV02JobId !== jobId)
      ) {
        throw new Error('Phase 7 job identity conflicts with current state');
      }
      attempt.jobId = jobId;
      attempt.acceptedObservedAt = observedAt.toISOString();
      attempt.acceptedStatus = acceptedStatus;
      attempt.lastObservedStatus = acceptedStatus;
      run.aiApproverV02JobId = jobId;
      run.phaseData.phase7 = {
        ...phase7,
        attempts,
        latestProgress: {
          observedAt: observedAt.toISOString(),
          status: acceptedStatus,
          v02RunId,
          jobId
        }
      };
      return touch(run, observedAt);
    },
    async recordPhaseSevenProgress(runId, v02RunId, progress) {
      calls.push('progress:7');
      const run = requireRun(runId);
      const phase7 = (run.phaseData.phase7 as Record<string, unknown>) ?? {};
      if (phase7.currentV02RunId !== v02RunId) throw new Error('Phase 7 current run mismatch');
      const attempts = structuredClone((phase7.attempts as Record<string, unknown>[]) ?? []);
      const attempt = attempts.find((entry) => entry.v02RunId === v02RunId);
      if (!attempt) throw new Error('Phase 7 current attempt is missing');
      if (attempt.jobId !== undefined && run.aiApproverV02JobId !== attempt.jobId) {
        throw new Error('Phase 7 current job mirror does not match');
      }
      Object.assign(attempt, {
        ...(progress.status ? { lastObservedStatus: progress.status } : {}),
        ...(progress.queueCreatedAt ? { queueCreatedAt: progress.queueCreatedAt } : {}),
        ...(progress.endingReason ? { endingReason: progress.endingReason } : {}),
        ...(progress.counts ? { counts: structuredClone(progress.counts) } : {}),
        ...(progress.monitoringLimitedAt
          ? { monitoringLimitedAt: progress.monitoringLimitedAt.toISOString() }
          : {}),
        ...(progress.cancellationRequestedAt
          ? { cancellationRequestedAt: progress.cancellationRequestedAt.toISOString() }
          : {}),
        ...(progress.cancellationOutcome
          ? { cancellationOutcome: progress.cancellationOutcome }
          : {}),
        ...(progress.inactiveVerifiedAt
          ? { inactiveVerifiedAt: progress.inactiveVerifiedAt.toISOString() }
          : {})
      });
      run.phaseData.phase7 = {
        ...phase7,
        attempts,
        latestProgress: {
          observedAt: progress.observedAt.toISOString(),
          v02RunId,
          ...(run.aiApproverV02JobId ? { jobId: run.aiApproverV02JobId } : {}),
          ...(progress.status ? { status: progress.status } : {})
        }
      };
      return touch(run, progress.observedAt);
    },
    async recordPhaseSevenZeroWorkCompleted(
      runId,
      completedAt,
      expectedCurrentV02RunId,
      zeroWorkAfterPriorAttempts
    ) {
      calls.push('complete-zero:7');
      const run = requireRun(runId);
      const phase7 = (run.phaseData.phase7 as Record<string, unknown>) ?? {};
      if ((phase7.currentV02RunId ?? null) !== expectedCurrentV02RunId) {
        throw new Error('Phase 7 zero-work expected run does not match');
      }
      const attempts = structuredClone((phase7.attempts as Record<string, unknown>[]) ?? []);
      const startedEarlier = attempts.some((attempt) => attempt.jobId !== undefined);
      if (startedEarlier !== zeroWorkAfterPriorAttempts) {
        throw new Error('Phase 7 zero-work history flag is invalid');
      }
      run.aiApproverV02JobId = null;
      run.lastPhaseCompleted = 7;
      run.runCompleted = true;
      run.runCompletedAt = completedAt;
      run.phaseData.phase7 = {
        ...phase7,
        status: 'completed',
        completedAt: completedAt.toISOString(),
        attempts,
        result: { kind: 'zero_work', zeroWorkAfterPriorAttempts }
      };
      return touch(run, completedAt);
    },
    async recordPhaseSevenCompleted(runId, completedAt, v02RunId, jobId, phaseResult) {
      calls.push('complete:7');
      const run = requireRun(runId);
      const phase7 = (run.phaseData.phase7 as Record<string, unknown>) ?? {};
      if (phase7.currentV02RunId !== v02RunId) throw new Error('Phase 7 current run mismatch');
      const attempts = structuredClone((phase7.attempts as Record<string, unknown>[]) ?? []);
      const attempt = attempts.find((entry) => entry.v02RunId === v02RunId);
      if (
        !attempt ||
        attempt.jobId !== jobId ||
        run.aiApproverV02JobId !== jobId ||
        attempt.monitoringLimitedAt !== undefined ||
        phaseResult.status !== 'completed'
      ) {
        throw new Error('Phase 7 completion identity or result is invalid');
      }
      run.lastPhaseCompleted = 7;
      run.runCompleted = true;
      run.runCompletedAt = completedAt;
      run.phaseData.phase7 = {
        ...phase7,
        status: 'completed',
        completedAt: completedAt.toISOString(),
        attempts,
        result: structuredClone(phaseResult)
      };
      return touch(run, completedAt);
    },
    async recordFailure(runId, failure) {
      calls.push(`failure:${failure.phase ?? 'run'}`);
      const run = requireRun(runId);
      run.lastError = {
        phase: failure.phase,
        category: failure.category,
        message: failure.message,
        failedAt: failure.failedAt.toISOString()
      };
      return touch(run, failure.failedAt);
    },
    async recordRunCompleted(runId, completedAt) {
      calls.push('run-complete');
      const run = requireRun(runId);
      if (run.lastPhaseStarted === 7 || run.lastPhaseCompleted === 6) {
        throw new Error('Phase 7 requires dedicated atomic completion');
      }
      run.runCompleted = true;
      run.runCompletedAt = completedAt;
      return touch(run, completedAt);
    }
  };

  return { persistence, runs, calls };
};
