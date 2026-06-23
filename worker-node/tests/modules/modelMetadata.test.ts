import {
  NewsApiRequest,
  OrchestratorRun,
  initModels
} from '@newsnexus/db-models';
import type { DataType } from 'sequelize';

const getTypeKey = (type: DataType): string | undefined => {
  return (type as { key?: string; constructor?: { name?: string } }).key
    ?? (type as { key?: string; constructor?: { name?: string } }).constructor?.name;
};

describe('db model continuation metadata', () => {
  beforeAll(() => {
    initModels();
  });

  it('initializes orchestrator continuation attributes', () => {
    expect(OrchestratorRun.rawAttributes.sourceOrchestratorRunId).toMatchObject({
      allowNull: true
    });
    expect(OrchestratorRun.rawAttributes.runMode).toMatchObject({
      allowNull: false,
      defaultValue: 'standard'
    });
    expect(OrchestratorRun.rawAttributes.continuationPlan).toMatchObject({
      allowNull: true
    });
    expect(getTypeKey(OrchestratorRun.rawAttributes.continuationPlan.type)).toBe('JSONB');
  });

  it('initializes request run linkage attributes', () => {
    expect(NewsApiRequest.rawAttributes.orchestratorRunId).toMatchObject({
      allowNull: true
    });
  });

  it('registers continuation self-reference associations', () => {
    expect(OrchestratorRun.associations.sourceRun).toMatchObject({
      as: 'sourceRun'
    });
    expect(OrchestratorRun.associations.continuationRuns).toMatchObject({
      as: 'continuationRuns'
    });
    expect(OrchestratorRun.associations.newsApiRequests).toMatchObject({
      as: 'newsApiRequests'
    });
    expect(NewsApiRequest.associations.orchestratorRun).toMatchObject({
      as: 'orchestratorRun'
    });
  });
});
