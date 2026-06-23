import type {
  OrchestratorRunMode,
  OrchestratorRunRow,
  OrchestratorRunStatus,
  OrchestratorRunStepName,
  OrchestratorRunStepRow,
} from './types';
import { STEP_DEFAULTS } from './types';
import {
  getRunWithSteps,
  hasActiveContinuationForSource,
} from './repository';
import { getActiveOrchestratorRunId } from './activeRunGuard';
import {
  buildGoogleRssResumePlan,
  GoogleRssResumePlanningResult,
} from '../google-rss/resumePlanner';

const TERMINAL_SUCCESS_STATUSES = new Set<OrchestratorRunStatus>([
  'completed',
  'completed_no_new_articles',
]);

const FAILURE_STATUSES = new Set<OrchestratorRunStatus>([
  'failed',
  'canceled',
  'timed_out',
]);

const STEP_ORDER = STEP_DEFAULTS.map((step) => step.stepName);

export type ContinuationSignalReasonCode =
  | 'assessment_available'
  | 'active_orchestration_run'
  | 'already_active_continuation'
  | 'source_is_continuation'
  | 'source_running'
  | 'source_completed'
  | 'completed_no_new_articles'
  | 'pre_google_rss'
  | 'unsupported_run_status';

export interface CheapContinuationSignal {
  canRequestContinuationAssessment: boolean;
  continuationSignalReasonCode: ContinuationSignalReasonCode;
  continuationSignalWarnings: string[];
}

export type ContinuationAssessmentReasonCode =
  | 'eligible_google_rss_interrupted'
  | 'eligible_downstream_interrupted'
  | 'active_orchestration_run'
  | 'already_active_continuation'
  | 'source_is_continuation'
  | 'source_running'
  | 'source_completed'
  | 'completed_no_new_articles'
  | 'pre_google_rss'
  | 'report_only_continuation_deferred'
  | 'unrecognized_failure_shape';

export interface ContinuationAssessmentStep {
  stepName: OrchestratorRunStepName;
  stepOrder: number;
  sourceStepId: number | null;
  sourceStatus: string | null;
  sourceChildJobId: string | null;
}

export interface GoogleRssResumePlan {
  status: 'ready' | 'phase_4_deferred' | 'not_applicable' | 'unavailable';
  reason: string;
  resumeAfter: GoogleRssResumePlanningResult['resumeAfter'] | null;
  startFrom?: GoogleRssResumePlanningResult['startFrom'];
  sourceOrchestratorRunId?: number;
  rowsTotal?: number;
  expectedRequestCount?: number;
  matchedRequestCount?: number;
  replayAllowed?: boolean;
}

export interface ContinuationRetryPolicy {
  aiApprover: {
    mode: 'gatekeeper';
    retryTransientFailures: boolean;
    retryInvalidResponses: boolean;
  };
  semanticScorer: {
    rerunAllowed: boolean;
  };
}

export interface ContinuationAssessment {
  eligible: boolean;
  reasonCode: ContinuationAssessmentReasonCode;
  sourceRunId: number;
  sourceStatus: OrchestratorRunStatus;
  runMode: OrchestratorRunMode;
  articleIdMinExclusive: number | null;
  articleIdMaxInclusive: number | null;
  plannedArticleIdMaxInclusive: number | null;
  inheritedSteps: ContinuationAssessmentStep[];
  runnableSteps: ContinuationAssessmentStep[];
  googleRssResumePlan: GoogleRssResumePlan;
  retryPolicy: ContinuationRetryPolicy;
  warnings: string[];
  blockingReasons: string[];
}

export interface ContinuationAssessmentLookup {
  found: boolean;
  assessment?: ContinuationAssessment;
}

export interface ContinuationAssessmentInput {
  run: OrchestratorRunRow;
  steps: OrchestratorRunStepRow[];
  activeRunId: number | null;
  hasActiveContinuation: boolean;
}

export const buildCheapContinuationSignal = (
  run: OrchestratorRunRow,
  activeRunId: number | null,
  hasActiveContinuation: boolean
): CheapContinuationSignal => {
  const warnings: string[] = [];

  if (activeRunId !== null) {
    return {
      canRequestContinuationAssessment: false,
      continuationSignalReasonCode: 'active_orchestration_run',
      continuationSignalWarnings: warnings,
    };
  }

  if (hasActiveContinuation) {
    return {
      canRequestContinuationAssessment: false,
      continuationSignalReasonCode: 'already_active_continuation',
      continuationSignalWarnings: warnings,
    };
  }

  if (run.runMode === 'continuation') {
    return {
      canRequestContinuationAssessment: false,
      continuationSignalReasonCode: 'source_is_continuation',
      continuationSignalWarnings: warnings,
    };
  }

  if (run.status === 'running') {
    return {
      canRequestContinuationAssessment: false,
      continuationSignalReasonCode: 'source_running',
      continuationSignalWarnings: warnings,
    };
  }

  if (run.status === 'completed_no_new_articles') {
    return {
      canRequestContinuationAssessment: false,
      continuationSignalReasonCode: 'completed_no_new_articles',
      continuationSignalWarnings: warnings,
    };
  }

  if (run.status === 'completed') {
    return {
      canRequestContinuationAssessment: false,
      continuationSignalReasonCode: 'source_completed',
      continuationSignalWarnings: warnings,
    };
  }

  if (run.articleIdMinExclusive === null) {
    return {
      canRequestContinuationAssessment: false,
      continuationSignalReasonCode: 'pre_google_rss',
      continuationSignalWarnings: warnings,
    };
  }

  if (FAILURE_STATUSES.has(run.status)) {
    if (run.articleIdMaxInclusive !== null) {
      warnings.push('Full assessment must verify the downstream continuation point.');
    }

    return {
      canRequestContinuationAssessment: true,
      continuationSignalReasonCode: 'assessment_available',
      continuationSignalWarnings: warnings,
    };
  }

  return {
    canRequestContinuationAssessment: false,
    continuationSignalReasonCode: 'unsupported_run_status',
    continuationSignalWarnings: warnings,
  };
};

export const buildContinuationAssessment = ({
  run,
  steps,
  activeRunId,
  hasActiveContinuation,
}: ContinuationAssessmentInput): ContinuationAssessment => {
  const inheritedSteps: ContinuationAssessmentStep[] = [];
  const runnableSteps: ContinuationAssessmentStep[] = [];
  const warnings: string[] = [];
  const blockingReasons: string[] = [];
  let reasonCode: ContinuationAssessmentReasonCode = 'unrecognized_failure_shape';
  let eligible = false;
  let googleRssResumePlan: GoogleRssResumePlan = {
    status: 'not_applicable',
    reason: 'Google RSS does not need resume planning for this assessment shape.',
    resumeAfter: null,
  };

  const block = (code: ContinuationAssessmentReasonCode, reason: string): void => {
    reasonCode = code;
    blockingReasons.push(reason);
  };

  if (activeRunId !== null) {
    block('active_orchestration_run', `Orchestrator run ${activeRunId} is already active.`);
  }

  if (hasActiveContinuation) {
    block('already_active_continuation', 'The source run already has an active continuation.');
  }

  if (run.runMode === 'continuation') {
    block('source_is_continuation', 'Continuation runs cannot be used as continuation sources.');
  }

  if (run.status === 'running') {
    block('source_running', 'The source run is still running.');
  } else if (run.status === 'completed_no_new_articles') {
    block('completed_no_new_articles', 'The source run completed without new articles.');
  } else if (run.status === 'completed') {
    block('source_completed', 'The source run completed successfully.');
  } else if (run.articleIdMinExclusive === null) {
    block('pre_google_rss', 'The source run did not reach Google RSS, so no continuation is needed.');
  } else if (!FAILURE_STATUSES.has(run.status)) {
    block('unrecognized_failure_shape', `Run status ${run.status} is not a recognized continuation source status.`);
  }

  if (blockingReasons.length === 0) {
    if (run.articleIdMaxInclusive === null) {
      eligible = true;
      reasonCode = 'eligible_google_rss_interrupted';
      googleRssResumePlan = {
        status: 'phase_4_deferred',
        reason: 'Google RSS resume matching is deferred to Phase 4; exact resume details are intentionally not populated here.',
        resumeAfter: null,
      };
      const googleRssIndex = STEP_ORDER.indexOf('google_rss');
      addStepsByOrder(steps, inheritedSteps, STEP_ORDER.slice(0, googleRssIndex));
      addStepsByOrder(steps, runnableSteps, STEP_ORDER.slice(googleRssIndex));
    } else {
      const firstRunnable = findFirstIncompleteEnabledStep(steps);
      if (!firstRunnable) {
        block('unrecognized_failure_shape', 'No incomplete enabled downstream step was found.');
      } else if (firstRunnable.stepName === 'report') {
        block('report_only_continuation_deferred', 'Report-only continuation is recognized but deferred in this implementation.');
        addStepsBefore(steps, inheritedSteps, firstRunnable.stepName);
        runnableSteps.push(toAssessmentStep(firstRunnable));
      } else {
        eligible = true;
        reasonCode = 'eligible_downstream_interrupted';
        warnings.push('Continuation upper bound will be captured when the continuation starts and may include later unrelated ingestion.');
        addStepsBefore(steps, inheritedSteps, firstRunnable.stepName);
        addStepsFrom(steps, runnableSteps, firstRunnable.stepName);
      }
    }
  }

  return {
    eligible,
    reasonCode,
    sourceRunId: run.id,
    sourceStatus: run.status,
    runMode: run.runMode,
    articleIdMinExclusive: run.articleIdMinExclusive,
    articleIdMaxInclusive: run.articleIdMaxInclusive,
    plannedArticleIdMaxInclusive: null,
    inheritedSteps,
    runnableSteps,
    googleRssResumePlan,
    retryPolicy: {
      aiApprover: {
        mode: 'gatekeeper',
        retryTransientFailures: true,
        retryInvalidResponses: false,
      },
      semanticScorer: {
        rerunAllowed: true,
      },
    },
    warnings,
    blockingReasons,
  };
};

export const assessContinuationForRun = async (
  sourceRunId: number
): Promise<ContinuationAssessmentLookup> => {
  const data = await getRunWithSteps(sourceRunId);
  if (!data) {
    return { found: false };
  }

  const [activeRunId, activeContinuation] = await Promise.all([
    getActiveOrchestratorRunId(),
    hasActiveContinuationForSource(sourceRunId),
  ]);

  const assessment = buildContinuationAssessment({
    run: data.run,
    steps: data.steps,
    activeRunId,
    hasActiveContinuation: activeContinuation,
  });

  if (assessment.eligible && assessment.reasonCode === 'eligible_google_rss_interrupted') {
    assessment.googleRssResumePlan = await resolveGoogleRssResumePlan(data.run);
  }

  return {
    found: true,
    assessment,
  };
};

const resolveGoogleRssResumePlan = async (
  run: OrchestratorRunRow
): Promise<GoogleRssResumePlan> => {
  const spreadsheetPath = process.env.PATH_AND_FILENAME_FOR_QUERY_SPREADSHEET_AUTOMATED?.trim();
  if (!spreadsheetPath) {
    return {
      status: 'unavailable',
      reason: 'PATH_AND_FILENAME_FOR_QUERY_SPREADSHEET_AUTOMATED is not configured, so Google RSS resume planning could not read the weekly query spreadsheet.',
      resumeAfter: null,
    };
  }

  const plan = await buildGoogleRssResumePlan({
    sourceRunId: run.id,
    sourceStartedAt: run.startedAt,
    sourceEndedAt: run.endedAt,
    spreadsheetPath,
  });

  return {
    status: plan.status,
    reason: plan.reason,
    resumeAfter: plan.resumeAfter,
    startFrom: plan.startFrom,
    sourceOrchestratorRunId: plan.sourceOrchestratorRunId,
    rowsTotal: plan.rowsTotal,
    expectedRequestCount: plan.expectedRequestCount,
    matchedRequestCount: plan.matchedRequestCount,
    replayAllowed: plan.replayAllowed,
  };
};

const isIncompleteStep = (step: OrchestratorRunStepRow): boolean => {
  return step.enabled && !['completed', 'skipped'].includes(step.status);
};

const findFirstIncompleteEnabledStep = (
  steps: OrchestratorRunStepRow[]
): OrchestratorRunStepRow | null => {
  const sorted = [...steps].sort((a, b) => a.stepOrder - b.stepOrder);
  return sorted.find(isIncompleteStep) ?? null;
};

const addStepsBefore = (
  sourceSteps: OrchestratorRunStepRow[],
  target: ContinuationAssessmentStep[],
  stepName: OrchestratorRunStepName
): void => {
  const index = STEP_ORDER.indexOf(stepName);
  addStepsByOrder(sourceSteps, target, STEP_ORDER.slice(0, index));
};

const addStepsFrom = (
  sourceSteps: OrchestratorRunStepRow[],
  target: ContinuationAssessmentStep[],
  stepName: OrchestratorRunStepName
): void => {
  const index = STEP_ORDER.indexOf(stepName);
  addStepsByOrder(sourceSteps, target, STEP_ORDER.slice(index));
};

const addStepsByOrder = (
  sourceSteps: OrchestratorRunStepRow[],
  target: ContinuationAssessmentStep[],
  stepNames: OrchestratorRunStepName[]
): void => {
  const byName = new Map(sourceSteps.map((step) => [step.stepName, step]));
  stepNames.forEach((stepName, index) => {
    const sourceStep = byName.get(stepName);
    target.push(
      sourceStep
        ? toAssessmentStep(sourceStep)
        : {
            stepName,
            stepOrder: STEP_ORDER.indexOf(stepName) >= 0 ? STEP_ORDER.indexOf(stepName) + 1 : index + 1,
            sourceStepId: null,
            sourceStatus: null,
            sourceChildJobId: null,
          }
    );
  });
};

const toAssessmentStep = (step: OrchestratorRunStepRow): ContinuationAssessmentStep => ({
  stepName: step.stepName,
  stepOrder: step.stepOrder,
  sourceStepId: step.id,
  sourceStatus: step.status,
  sourceChildJobId: step.childJobId,
});
