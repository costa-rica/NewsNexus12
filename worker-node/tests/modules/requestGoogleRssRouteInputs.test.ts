import { AppError } from '../../src/modules/errors/appError';
import { resolveOrchestratorRunId } from '../../src/routes/requestGoogleRss';

describe('requestGoogleRss route inputs', () => {
  it('resolves a positive orchestrator run id header', () => {
    expect(resolveOrchestratorRunId('42')).toBe(42);
    expect(resolveOrchestratorRunId(['43'])).toBe(43);
  });

  it('treats missing orchestrator run id header as absent', () => {
    expect(resolveOrchestratorRunId(undefined)).toBeUndefined();
    expect(resolveOrchestratorRunId('')).toBeUndefined();
  });

  it('rejects invalid orchestrator run id headers', () => {
    expect(() => resolveOrchestratorRunId('abc')).toThrow(AppError);
    expect(() => resolveOrchestratorRunId('0')).toThrow(AppError);
    expect(() => resolveOrchestratorRunId('-1')).toThrow(AppError);
  });
});
