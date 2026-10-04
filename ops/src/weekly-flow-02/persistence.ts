export type WeeklyFlowPhase = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type JsonRecord = Record<string, unknown>;

export class WeeklyFlowPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WeeklyFlowPersistenceError';
  }
}

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
  recordPhaseCompleted(
    runId: number,
    phase: WeeklyFlowPhase,
    completedAt: Date,
    phaseResult: JsonRecord,
    fields?: PhaseCompletionFields
  ): Promise<WeeklyFlowRunRecord>;
  recordFailure(runId: number, failure: WeeklyFlowFailure): Promise<WeeklyFlowRunRecord>;
  recordRunCompleted(runId: number, completedAt: Date): Promise<WeeklyFlowRunRecord>;
}

export const isWeeklyFlowPhase = (value: number): value is WeeklyFlowPhase =>
  Number.isInteger(value) && value >= 1 && value <= 7;
