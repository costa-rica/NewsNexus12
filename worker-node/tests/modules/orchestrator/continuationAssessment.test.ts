import {
  buildCheapContinuationSignal,
  buildContinuationAssessment,
} from '../../../src/modules/orchestrator/continuationAssessment';
import type {
  OrchestratorRunRow,
  OrchestratorRunStepName,
  OrchestratorRunStepRow,
} from '../../../src/modules/orchestrator/types';

const baseRun = (overrides: Partial<OrchestratorRunRow> = {}): OrchestratorRunRow => ({
  id: 10,
  sourceOrchestratorRunId: null,
  runMode: 'standard',
  continuationPlan: null,
  status: 'failed',
  startedAt: new Date('2026-06-23T00:00:00Z'),
  endedAt: new Date('2026-06-23T01:00:00Z'),
  articleIdMinExclusive: 100,
  articleIdMaxInclusive: null,
  reportFilePath: null,
  failureReason: 'worker restart',
  aiApproverEnabled: true,
  semanticScorerEnabled: true,
  userId: null,
  ...overrides,
});

const step = (
  stepName: OrchestratorRunStepName,
  stepOrder: number,
  status: OrchestratorRunStepRow['status'],
  overrides: Partial<OrchestratorRunStepRow> = {}
): OrchestratorRunStepRow => ({
  id: stepOrder,
  orchestratorRunId: 10,
  stepName,
  stepOrder,
  enabled: true,
  status,
  childJobId: null,
  startedAt: null,
  endedAt: null,
  result: null,
  endingReason: null,
  endingMessage: null,
  ...overrides,
});

const standardSteps = (
  statuses: Partial<Record<OrchestratorRunStepName, OrchestratorRunStepRow['status']>>
): OrchestratorRunStepRow[] => [
  step('delete_articles', 1, statuses.delete_articles ?? 'completed'),
  step('google_rss', 2, statuses.google_rss ?? 'completed'),
  step('state_assigner', 3, statuses.state_assigner ?? 'completed'),
  step('ai_approver', 4, statuses.ai_approver ?? 'completed'),
  step('semantic_scorer', 5, statuses.semantic_scorer ?? 'completed'),
  step('report', 6, statuses.report ?? 'completed'),
];

describe('continuation assessment', () => {
  describe('cheap continuation signal', () => {
    it('allows assessment for failed runs with a lower bound and no active work', () => {
      expect(buildCheapContinuationSignal(baseRun(), null, false)).toEqual({
        canRequestContinuationAssessment: true,
        continuationSignalReasonCode: 'assessment_available',
        continuationSignalWarnings: [],
      });
    });

    it('blocks cheaply when another orchestration run is active', () => {
      expect(buildCheapContinuationSignal(baseRun(), 99, false)).toMatchObject({
        canRequestContinuationAssessment: false,
        continuationSignalReasonCode: 'active_orchestration_run',
      });
    });

    it('blocks cheaply when no Google RSS lower bound exists', () => {
      expect(buildCheapContinuationSignal(baseRun({ articleIdMinExclusive: null }), null, false)).toMatchObject({
        canRequestContinuationAssessment: false,
        continuationSignalReasonCode: 'pre_google_rss',
      });
    });
  });

  describe('full assessment', () => {
    it('returns an eligible Google RSS interruption assessment when only the lower bound exists', () => {
      const assessment = buildContinuationAssessment({
        run: baseRun(),
        steps: standardSteps({ google_rss: 'failed', state_assigner: 'pending' }),
        activeRunId: null,
        hasActiveContinuation: false,
      });

      expect(assessment).toMatchObject({
        eligible: true,
        reasonCode: 'eligible_google_rss_interrupted',
        articleIdMinExclusive: 100,
        articleIdMaxInclusive: null,
        googleRssResumePlan: { status: 'phase_4_deferred', resumeAfter: null },
        blockingReasons: [],
      });
      expect(assessment.inheritedSteps.map((item) => item.stepName)).toEqual(['delete_articles']);
      expect(assessment.runnableSteps.map((item) => item.stepName)[0]).toBe('google_rss');
    });

    it('returns an eligible downstream assessment when both bounds exist and AI approver is incomplete', () => {
      const assessment = buildContinuationAssessment({
        run: baseRun({ status: 'timed_out', articleIdMaxInclusive: 250 }),
        steps: standardSteps({ ai_approver: 'timed_out', semantic_scorer: 'pending', report: 'pending' }),
        activeRunId: null,
        hasActiveContinuation: false,
      });

      expect(assessment).toMatchObject({
        eligible: true,
        reasonCode: 'eligible_downstream_interrupted',
        articleIdMinExclusive: 100,
        articleIdMaxInclusive: 250,
        blockingReasons: [],
      });
      expect(assessment.inheritedSteps.map((item) => item.stepName)).toEqual([
        'delete_articles',
        'google_rss',
        'state_assigner',
      ]);
      expect(assessment.runnableSteps.map((item) => item.stepName)).toEqual([
        'ai_approver',
        'semantic_scorer',
        'report',
      ]);
      expect(assessment.warnings).toHaveLength(1);
    });

    it('returns 200-style blocking data for completed and running source runs', () => {
      const completed = buildContinuationAssessment({
        run: baseRun({ status: 'completed', articleIdMaxInclusive: 250 }),
        steps: standardSteps({}),
        activeRunId: null,
        hasActiveContinuation: false,
      });
      const running = buildContinuationAssessment({
        run: baseRun({ status: 'running' }),
        steps: standardSteps({ google_rss: 'running' }),
        activeRunId: 10,
        hasActiveContinuation: false,
      });

      expect(completed).toMatchObject({
        eligible: false,
        reasonCode: 'source_completed',
      });
      expect(completed.blockingReasons).toHaveLength(1);
      expect(running.eligible).toBe(false);
      expect(running.blockingReasons.length).toBeGreaterThan(0);
    });

    it('recognizes report-only continuation as deferred', () => {
      const assessment = buildContinuationAssessment({
        run: baseRun({ articleIdMaxInclusive: 250 }),
        steps: standardSteps({ report: 'failed' }),
        activeRunId: null,
        hasActiveContinuation: false,
      });

      expect(assessment).toMatchObject({
        eligible: false,
        reasonCode: 'report_only_continuation_deferred',
      });
      expect(assessment.runnableSteps.map((item) => item.stepName)).toEqual(['report']);
    });
  });
});
