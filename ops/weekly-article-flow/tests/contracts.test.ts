import {
  validateRssResult,
  validateSemanticResult,
  validateStateResult
} from '../src/contracts';

describe('worker result contracts', () => {
  it('accepts reconciled RSS, semantic, and state results', () => {
    expect(validateRssResult({
      schemaVersion: 1,
      endingReason: 'queries_exhausted',
      terminalMessage: 'done',
      articlesAddedCount: 2,
      successfulQueryCount: 1,
      skippedQueryCount: 1,
      failedQueryCount: 0,
      queryResults: [{ status: 'success' }, { status: 'skipped' }]
    }).articlesAddedCount).toBe(2);

    expect(validateSemanticResult({
      schemaVersion: 1,
      endingReason: 'completed',
      terminalMessage: 'done',
      selectedArticleIds: [1, 2, 3, 4],
      scoredArticleIds: [1],
      skippedArticles: [{ articleId: 2, reason: 'no_usable_text' }],
      failedArticles: [{ articleId: 3, reason: 'timeout' }],
      unattemptedArticleIds: [4],
      selectedCount: 4,
      attemptedCount: 3,
      successfulCount: 1,
      skippedCount: 1,
      failedCount: 1,
      unattemptedCount: 1
    }).selectedArticleIds).toEqual([1, 2, 3, 4]);

    expect(validateStateResult({
      schemaVersion: 1,
      endingReason: 'circuit_breaker',
      terminalMessage: 'breaker',
      selectedArticleIds: [1, 2],
      attemptedArticleIds: [1],
      successfulArticleIds: [],
      skippedArticles: [],
      failedArticles: [{ articleId: 1, reason: 'timeout' }],
      unattemptedArticleIds: [2],
      selectedCount: 2,
      attemptedCount: 1,
      successfulCount: 0,
      skippedCount: 0,
      failedCount: 1,
      unattemptedCount: 1,
      maximumConsecutiveFailures: 5,
      circuitBreakerTripped: true
    }).circuitBreakerTripped).toBe(true);
  });

  it.each([
    ['unknown schema', { schemaVersion: 2, endingReason: 'completed', terminalMessage: 'done' }],
    ['duplicate outcomes', {
      schemaVersion: 1,
      endingReason: 'completed',
      terminalMessage: 'done',
      selectedArticleIds: [1],
      scoredArticleIds: [1],
      skippedArticles: [{ articleId: 1, reason: 'skip' }],
      failedArticles: [],
      unattemptedArticleIds: [],
      selectedCount: 1,
      attemptedCount: 2,
      successfulCount: 1,
      skippedCount: 1,
      failedCount: 0,
      unattemptedCount: 0
    }],
    ['missing terminal outcome', {
      schemaVersion: 1,
      endingReason: 'completed',
      terminalMessage: 'done',
      selectedArticleIds: [1, 2],
      scoredArticleIds: [1],
      skippedArticles: [],
      failedArticles: [],
      unattemptedArticleIds: [],
      selectedCount: 2,
      attemptedCount: 1,
      successfulCount: 1,
      skippedCount: 0,
      failedCount: 0,
      unattemptedCount: 0
    }]
  ])('rejects semantic result with %s', (_label, result) => {
    expect(() => validateSemanticResult(result)).toThrow();
  });

  it('rejects inconsistent RSS counts and invalid breaker evidence', () => {
    expect(() => validateRssResult({
      schemaVersion: 1,
      endingReason: 'queries_exhausted',
      terminalMessage: 'done',
      articlesAddedCount: 0,
      successfulQueryCount: 2,
      skippedQueryCount: 0,
      failedQueryCount: 0,
      queryResults: [{ status: 'success' }]
    })).toThrow('successfulQueryCount');

    expect(() => validateStateResult({
      schemaVersion: 1,
      endingReason: 'circuit_breaker',
      terminalMessage: 'done',
      selectedArticleIds: [],
      attemptedArticleIds: [],
      successfulArticleIds: [],
      skippedArticles: [],
      failedArticles: [],
      unattemptedArticleIds: [],
      selectedCount: 0,
      attemptedCount: 0,
      successfulCount: 0,
      skippedCount: 0,
      failedCount: 0,
      unattemptedCount: 0,
      maximumConsecutiveFailures: 4,
      circuitBreakerTripped: true
    })).toThrow('five consecutive');
  });
});
