import { AppError } from '../../src/modules/errors/appError';
import {
  resolveGoogleRssResumePlanFromBody,
  resolveOrchestratorRunId,
} from '../../src/routes/requestGoogleRss';

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

  it('resolves a Google RSS resume plan request body', () => {
    expect(
      resolveGoogleRssResumePlanFromBody({
        googleRssResumePlan: {
          resumeAfterRequestUrl: ' https://news.google.com/rss/search?q=previous ',
          resumeAfterQueryRowIndex: 2,
          resumeAfterQueryRowId: '123',
          sourceOrchestratorRunId: 14,
          continuationRunId: 15,
        },
      })
    ).toEqual({
      resumeAfterRequestUrl: 'https://news.google.com/rss/search?q=previous',
      resumeAfterQueryRowIndex: 2,
      resumeAfterQueryRowId: 123,
      sourceOrchestratorRunId: 14,
      continuationRunId: 15,
    });
  });

  it('treats a missing Google RSS resume plan as absent', () => {
    expect(resolveGoogleRssResumePlanFromBody({})).toBeUndefined();
    expect(resolveGoogleRssResumePlanFromBody({ googleRssResumePlan: null })).toBeUndefined();
  });

  it('rejects invalid Google RSS resume plan fields', () => {
    expect(() =>
      resolveGoogleRssResumePlanFromBody({
        googleRssResumePlan: {
          resumeAfterQueryRowIndex: -1,
        },
      })
    ).toThrow(AppError);
    expect(() =>
      resolveGoogleRssResumePlanFromBody({
        googleRssResumePlan: {
          resumeAfterRequestUrl: '',
        },
      })
    ).toThrow(AppError);
  });
});
