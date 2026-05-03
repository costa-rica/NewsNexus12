jest.mock('@newsnexus/db-models', () => ({
  sequelize: {
    query: jest.fn(),
  },
}));

import {
  buildStepRequestBody,
  calculateArticlesAddedCount,
} from '../../src/modules/orchestrator/coordinator';
import type { OrchestratorConfig, StepConfig } from '../../src/modules/orchestrator/types';

const weeklyConfig: OrchestratorConfig = {
  mode: 'weekly',
  aiApproverEnabled: true,
  semanticScorerEnabled: true,
};

const abbreviatedConfig: OrchestratorConfig = {
  mode: 'abbreviated_test',
  aiApproverEnabled: true,
  semanticScorerEnabled: true,
  testConfig: {
    deleteTrimCount: 100,
    targetArticlesAddedCount: 10,
    downstreamArticleCount: 10,
  },
};

const stateAssignerStep: StepConfig = {
  stepName: 'state_assigner',
  stepOrder: 3,
  enabled: true,
  timeoutSeconds: 1,
  worker: 'node',
  endpointName: '/state-assigner/start-job',
};

const aiApproverStep: StepConfig = {
  stepName: 'ai_approver',
  stepOrder: 4,
  enabled: true,
  timeoutSeconds: 1,
  worker: 'python',
  endpointName: '/ai-approver/start-job',
};

describe('orchestrator coordinator request bodies', () => {
  it('calculates articles added from captured article id bounds', () => {
    expect(calculateArticlesAddedCount(1000, 1250)).toBe(250);
    expect(calculateArticlesAddedCount(1000, 1000)).toBe(0);
  });

  it('returns null when article id bounds cannot produce a valid count', () => {
    expect(calculateArticlesAddedCount(null, 1250)).toBeNull();
    expect(calculateArticlesAddedCount(1250, 1000)).toBeNull();
  });

  it('uses the weekly articles-added count for state assigner review count', () => {
    const body = buildStepRequestBody(stateAssignerStep, weeklyConfig, 1000, 1250, 250);

    expect(body).toMatchObject({
      targetArticleThresholdDaysOld: 180,
      targetArticleStateReviewCount: 250,
      articleIdMinExclusive: 1000,
      articleIdMaxInclusive: 1250,
    });
  });

  it('uses the weekly articles-added count for AI approver limit', () => {
    const body = buildStepRequestBody(aiApproverStep, weeklyConfig, 1000, 1250, 250);

    expect(body).toEqual({
      limit: 250,
      articleIdMinExclusive: 1000,
      articleIdMaxInclusive: 1250,
    });
  });

  it('keeps abbreviated test downstream limits fixed', () => {
    expect(
      buildStepRequestBody(stateAssignerStep, abbreviatedConfig, 1000, 1250, 250)
    ).toMatchObject({
      targetArticleStateReviewCount: 10,
    });
    expect(buildStepRequestBody(aiApproverStep, abbreviatedConfig, 1000, 1250, 250)).toMatchObject({
      limit: 10,
    });
  });

  it('falls back conservatively when weekly articles-added count is missing', () => {
    expect(buildStepRequestBody(stateAssignerStep, weeklyConfig, 1000, 1250, null)).toMatchObject({
      targetArticleStateReviewCount: 100,
    });
    expect(buildStepRequestBody(aiApproverStep, weeklyConfig, 1000, 1250, null)).toMatchObject({
      limit: 100,
    });
  });
});
