export type WeeklyFlowPhase = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type JsonRecord = Record<string, unknown>;

export const GOOGLE_NEWS_RSS_SOURCE_NAME = 'Google News RSS';

export class WeeklyFlowPersistenceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'WeeklyFlowPersistenceError';
  }
}

const usersTableSqlPattern =
  /(?:\bfrom|\bjoin|\bupdate|\binto|\breferences|\btable|\brelation)\s+(?:["'`]?public["'`]?\.)?["'`]?users["'`]?(?!\w)/i;

const ownPropertyEntries = (value: object): Array<[string, unknown]> =>
  Object.getOwnPropertyNames(value).map((property) => {
    try {
      return [property, (value as Record<string, unknown>)[property]];
    } catch (error: unknown) {
      return [
        property,
        `[property read failed: ${error instanceof Error ? error.message : String(error)}]`
      ];
    }
  });

const referencesUsersTable = (
  value: unknown,
  seen: Set<object> = new Set(),
  key?: string
): boolean => {
  if (typeof value === 'string') {
    if (
      (key === 'table' || key === 'tableName' || key === 'relation') &&
      /^(?:public\.)?users$/i.test(value)
    ) {
      return true;
    }
    return usersTableSqlPattern.test(value) || /relation\s+["'`]users["'`]/i.test(value);
  }
  if (typeof value !== 'object' || value === null || seen.has(value)) return false;
  seen.add(value);
  if (value instanceof Error) {
    if (referencesUsersTable(value.message, seen, 'message')) return true;
    if (referencesUsersTable(value.stack, seen, 'stack')) return true;
  }
  return ownPropertyEntries(value).some(([entryKey, entryValue]) =>
    referencesUsersTable(entryValue, seen, entryKey)
  );
};

const serializeDiagnosticValue = (
  value: unknown,
  seen: Set<object> = new Set()
): unknown => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (value === undefined) return undefined;
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((item) => serializeDiagnosticValue(item, seen));
  }
  const serialized: Record<string, unknown> = {};
  if (value instanceof Error) {
    serialized.name = value.name;
    serialized.message = value.message;
    if (value.stack !== undefined) serialized.stack = value.stack;
  }
  for (const [entryKey, entryValue] of ownPropertyEntries(value)) {
    serialized[entryKey] = serializeDiagnosticValue(entryValue, seen);
  }
  return serialized;
};

export const persistenceErrorDiagnostics = (
  error: unknown
): Record<string, unknown> => {
  if (!(error instanceof WeeklyFlowPersistenceError) || error.cause === undefined) return {};
  if (referencesUsersTable(error.cause)) {
    return {
      databaseErrorSuppressed: true,
      databaseErrorSuppressionReason: 'Error references the Users table'
    };
  }
  return { databaseError: serializeDiagnosticValue(error.cause) };
};

export interface WeeklyFlowRunRecord {
  id: number;
  runStartedAt: Date;
  runCompleted: boolean;
  runCompletedAt: Date | null;
  lastPhaseStarted: WeeklyFlowPhase | null;
  lastPhaseCompleted: WeeklyFlowPhase | null;
  phaseData: JsonRecord;
  lastError: JsonRecord | null;
  backupPath: string | null;
  backupByteSize: string | null;
  backupSha256: string | null;
  backupManifestVersion: number | null;
  newsApiRequestIdHighWaterMark: number | null;
  articleIdHighWaterMark: number | null;
  firstRssRequestId: number | null;
  firstRssArticleId: number | null;
  rssArticlesAddedCount: number | null;
  articleCount: number | null;
  rssJobId: string | null;
  semanticScorerJobId: string | null;
  stateAssignerJobId: string | null;
  aiApproverV02JobId: string | null;
  targetArticleThresholdDaysOld: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PhaseCompletionFields {
  backupPath?: string;
  backupByteSize?: string;
  backupSha256?: string;
  backupManifestVersion?: number;
  firstRssRequestId?: number;
  firstRssArticleId?: number;
  rssArticlesAddedCount?: number;
  articleCount?: number;
  rssJobId?: string;
  semanticScorerJobId?: string;
  stateAssignerJobId?: string;
  aiApproverV02JobId?: string;
  targetArticleThresholdDaysOld?: number;
}

export interface PhaseFourHighWaterMarks {
  newsApiRequestIdHighWaterMark: number;
  articleIdHighWaterMark: number;
}

export interface PhaseFourDatabaseResult {
  firstRssRequestId: number | null;
  firstRssArticleId: number | null;
  articleCount: number;
}

export interface PhaseFourProgress {
  observedAt: Date;
  rssJobId?: string;
  status?: string;
  rssArticlesAddedCount?: number;
  details?: JsonRecord;
}

export interface PhaseFourCompletionFields {
  firstRssRequestId: number | null;
  firstRssArticleId: number | null;
  rssArticlesAddedCount: number | null;
  rssJobId: string | null;
}

export interface PhaseFiveMonitoringLimit {
  jobId: string;
  jobCreatedAt: string;
  reachedAt: Date;
  cancellationRequestedAt?: Date;
  cancellationOutcome?: string;
  verification?: JsonRecord;
}

export interface PhaseFiveProgress {
  observedAt: Date;
  semanticScorerJobId?: string;
  status?: string;
  jobCreatedAt?: string;
  startedAt?: string;
  endedAt?: string;
  failureReason?: string;
  monitoringLimit?: PhaseFiveMonitoringLimit;
}

export interface PhaseFiveCompletionFields {
  semanticScorerJobId: string;
  jobCreatedAt: string;
}

export interface PhaseSixInputs {
  targetArticleThresholdDaysOld: number;
  targetArticleStateReviewCount: number;
}

export interface PhaseSixMonitoringLimit {
  jobId: string;
  jobCreatedAt: string;
  reachedAt: Date;
  cancellationRequestedAt?: Date;
  cancellationOutcome?: string;
  verification?: JsonRecord;
}

export interface PhaseSixProgress {
  observedAt: Date;
  stateAssignerJobId?: string;
  status?: string;
  jobCreatedAt?: string;
  startedAt?: string;
  endedAt?: string;
  failureReason?: string;
  selectedCount?: number;
  monitoringLimit?: PhaseSixMonitoringLimit;
  incompatibleContractRecovery?: PhaseSixIncompatibleRecoveryV06;
}

export type PhaseSixContinuationReason =
  | 'saved_job_failed'
  | 'saved_job_canceled'
  | 'saved_job_unavailable'
  | 'monitoring_limited'
  | 'incompatible_contract';

export interface PhaseSixCompletionFields {
  stateAssignerJobId: string;
  jobCreatedAt: string;
}

export interface PhaseFourNonzeroCompletionFields extends PhaseFourCompletionFields {
  articleCount: number;
}

export interface PhaseFourDataStore {
  readHighWaterMarks(): Promise<PhaseFourHighWaterMarks>;
  readPostMarkResult(marks: PhaseFourHighWaterMarks): Promise<PhaseFourDatabaseResult>;
}

export interface WeeklyFlowFailure {
  phase: WeeklyFlowPhase | null;
  category: string;
  message: string;
  failedAt: Date;
}

export interface WeeklyFlowPersistence {
  getLatestRun(): Promise<WeeklyFlowRunRecord | null>;
  getRunById(runId: number): Promise<WeeklyFlowRunRecord | null>;
  createRun(runStartedAt: Date): Promise<WeeklyFlowRunRecord>;
  recordPhaseStarted(
    runId: number,
    phase: WeeklyFlowPhase,
    startedAt: Date
  ): Promise<WeeklyFlowRunRecord>;
  recordPhaseFourStarted(
    runId: number,
    startedAt: Date
  ): Promise<WeeklyFlowRunRecord>;
  recordPhaseFourProgress(
    runId: number,
    progress: PhaseFourProgress
  ): Promise<WeeklyFlowRunRecord>;
  readPhaseFourDatabaseResult(runId: number): Promise<PhaseFourDatabaseResult>;
  recordPhaseCompleted(
    runId: number,
    phase: WeeklyFlowPhase,
    completedAt: Date,
    phaseResult: JsonRecord,
    fields?: PhaseCompletionFields
  ): Promise<WeeklyFlowRunRecord>;
  recordPhaseFourCompleted(
    runId: number,
    completedAt: Date,
    phaseResult: JsonRecord,
    fields: PhaseFourNonzeroCompletionFields
  ): Promise<WeeklyFlowRunRecord>;
  recordPhaseFourZeroWorkCompletion(
    runId: number,
    completedAt: Date,
    phaseResult: JsonRecord,
    fields: PhaseFourCompletionFields
  ): Promise<WeeklyFlowRunRecord>;
  recordPhaseFiveStarted(runId: number, startedAt: Date): Promise<WeeklyFlowRunRecord>;
  recordPhaseFiveProgress(runId: number, progress: PhaseFiveProgress): Promise<WeeklyFlowRunRecord>;
  recordPhaseFiveCompleted(
    runId: number,
    completedAt: Date,
    phaseResult: JsonRecord,
    fields: PhaseFiveCompletionFields
  ): Promise<WeeklyFlowRunRecord>;
  recordPhaseSixStarted(
    runId: number,
    startedAt: Date,
    targetArticleThresholdDaysOld: number
  ): Promise<WeeklyFlowRunRecord>;
  recordPhaseSixProgress(runId: number, progress: PhaseSixProgress): Promise<WeeklyFlowRunRecord>;
  recordPhaseSixContinuationJobStarted(
    runId: number,
    expectedPriorJobId: string,
    continuationJobId: string,
    continuationStartedAt: Date,
    reason: PhaseSixContinuationReason
  ): Promise<WeeklyFlowRunRecord>;
  recordPhaseSixCompleted(
    runId: number,
    completedAt: Date,
    phaseResult: JsonRecord,
    fields: PhaseSixCompletionFields
  ): Promise<WeeklyFlowRunRecord>;
  recordFailure(runId: number, failure: WeeklyFlowFailure): Promise<WeeklyFlowRunRecord>;
  recordRunCompleted(runId: number, completedAt: Date): Promise<WeeklyFlowRunRecord>;
}

export const isWeeklyFlowPhase = (value: number): value is WeeklyFlowPhase =>
  Number.isInteger(value) && value >= 1 && value <= 7;
import type { PhaseSixIncompatibleRecoveryV06 } from './phaseSixRecoveryState';
