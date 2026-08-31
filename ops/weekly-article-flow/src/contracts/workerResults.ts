export class WorkerResultContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkerResultContractError';
  }
}

type UnknownRecord = Record<string, unknown>;

const record = (value: unknown, label: string): UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WorkerResultContractError(`${label} must be an object`);
  }
  return value as UnknownRecord;
};

const stringValue = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new WorkerResultContractError(`${label} must be a nonempty string`);
  }
  return value;
};

const count = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new WorkerResultContractError(`${label} must be a nonnegative integer`);
  }
  return value;
};

const idArray = (value: unknown, label: string): number[] => {
  if (!Array.isArray(value) || value.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new WorkerResultContractError(`${label} must be an array of positive integers`);
  }
  const ids = value as number[];
  if (new Set(ids).size !== ids.length) {
    throw new WorkerResultContractError(`${label} contains duplicate IDs`);
  }
  return ids;
};

const outcomeArray = (value: unknown, label: string): Array<{ articleId: number; reason: string }> => {
  if (!Array.isArray(value)) {
    throw new WorkerResultContractError(`${label} must be an array`);
  }
  return value.map((item, index) => {
    const parsed = record(item, `${label}[${index}]`);
    const articleId = count(parsed.articleId, `${label}[${index}].articleId`);
    if (articleId === 0) {
      throw new WorkerResultContractError(`${label}[${index}].articleId must be positive`);
    }
    return { articleId, reason: stringValue(parsed.reason, `${label}[${index}].reason`) };
  });
};

const requireSchema = (result: UnknownRecord): void => {
  if (result.schemaVersion !== 1) {
    throw new WorkerResultContractError('unsupported worker result schemaVersion');
  }
  stringValue(result.endingReason, 'endingReason');
  stringValue(result.terminalMessage, 'terminalMessage');
};

const requireAllowed = (value: string, allowed: readonly string[], label: string): void => {
  if (!allowed.includes(value)) {
    throw new WorkerResultContractError(`${label} is not recognized`);
  }
};

const reconcileCount = (result: UnknownRecord, field: string, length: number): void => {
  if (count(result[field], field) !== length) {
    throw new WorkerResultContractError(`${field} does not match its outcome array`);
  }
};

const assertExclusiveTerminalIds = (selected: number[], groups: number[][]): void => {
  const terminal = groups.flat();
  if (new Set(terminal).size !== terminal.length) {
    throw new WorkerResultContractError('article IDs overlap across terminal outcomes');
  }
  const selectedSorted = [...selected].sort((a, b) => a - b);
  const terminalSorted = [...terminal].sort((a, b) => a - b);
  if (selectedSorted.length !== terminalSorted.length || selectedSorted.some((id, index) => id !== terminalSorted[index])) {
    throw new WorkerResultContractError('selected article IDs do not reconcile with terminal outcomes');
  }
};

export interface ValidatedRssResult {
  schemaVersion: 1;
  endingReason: string;
  terminalMessage: string;
  articlesAddedCount: number;
  queryResults: unknown[];
}

export const validateRssResult = (value: unknown): ValidatedRssResult => {
  const result = record(value, 'RSS result');
  requireSchema(result);
  if (!Array.isArray(result.queryResults)) {
    throw new WorkerResultContractError('queryResults must be an array');
  }
  const statuses = result.queryResults.map((item, index) =>
    stringValue(record(item, `queryResults[${index}]`).status, `queryResults[${index}].status`)
  );
  requireAllowed(result.endingReason as string, [
    'queries_exhausted', 'target_articles_collected', 'rate_limited', 'error', 'canceled', 'aborted'
  ], 'endingReason');
  statuses.forEach((status) => requireAllowed(status, ['success', 'skipped', 'failed'], 'query status'));
  reconcileCount(result, 'successfulQueryCount', statuses.filter((status) => status === 'success').length);
  reconcileCount(result, 'skippedQueryCount', statuses.filter((status) => status === 'skipped').length);
  reconcileCount(result, 'failedQueryCount', statuses.filter((status) => status === 'failed').length);
  return {
    schemaVersion: 1,
    endingReason: result.endingReason as string,
    terminalMessage: result.terminalMessage as string,
    articlesAddedCount: count(result.articlesAddedCount, 'articlesAddedCount'),
    queryResults: result.queryResults
  };
};

export interface ValidatedSemanticResult {
  schemaVersion: 1;
  endingReason: string;
  terminalMessage: string;
  selectedArticleIds: number[];
  scoredArticleIds: number[];
  skippedArticles: Array<{ articleId: number; reason: string }>;
  failedArticles: Array<{ articleId: number; reason: string }>;
  unattemptedArticleIds: number[];
}

export const validateSemanticResult = (value: unknown): ValidatedSemanticResult => {
  const result = record(value, 'semantic result');
  requireSchema(result);
  const selectedArticleIds = idArray(result.selectedArticleIds, 'selectedArticleIds');
  const scoredArticleIds = idArray(result.scoredArticleIds, 'scoredArticleIds');
  const skippedArticles = outcomeArray(result.skippedArticles, 'skippedArticles');
  const failedArticles = outcomeArray(result.failedArticles, 'failedArticles');
  const unattemptedArticleIds = idArray(result.unattemptedArticleIds, 'unattemptedArticleIds');
  requireAllowed(result.endingReason as string, ['completed', 'canceled', 'error'], 'endingReason');
  skippedArticles.forEach(({ reason }) => requireAllowed(reason, ['no_usable_text', 'no_score_result'], 'semantic skip reason'));
  failedArticles.forEach(({ reason }) => requireAllowed(reason, ['timeout', 'scoring_error', 'persistence_error'], 'semantic failure reason'));
  assertExclusiveTerminalIds(selectedArticleIds, [
    scoredArticleIds,
    skippedArticles.map(({ articleId }) => articleId),
    failedArticles.map(({ articleId }) => articleId),
    unattemptedArticleIds
  ]);
  reconcileCount(result, 'selectedCount', selectedArticleIds.length);
  reconcileCount(result, 'successfulCount', scoredArticleIds.length);
  reconcileCount(result, 'skippedCount', skippedArticles.length);
  reconcileCount(result, 'failedCount', failedArticles.length);
  reconcileCount(result, 'unattemptedCount', unattemptedArticleIds.length);
  reconcileCount(result, 'attemptedCount', scoredArticleIds.length + skippedArticles.length + failedArticles.length);
  return {
    schemaVersion: 1,
    endingReason: result.endingReason as string,
    terminalMessage: result.terminalMessage as string,
    selectedArticleIds,
    scoredArticleIds,
    skippedArticles,
    failedArticles,
    unattemptedArticleIds
  };
};

export interface ValidatedStateResult extends Omit<ValidatedSemanticResult, 'scoredArticleIds'> {
  attemptedArticleIds: number[];
  successfulArticleIds: number[];
  maximumConsecutiveFailures: number;
  circuitBreakerTripped: boolean;
}

export const validateStateResult = (value: unknown): ValidatedStateResult => {
  const result = record(value, 'state result');
  requireSchema(result);
  const selectedArticleIds = idArray(result.selectedArticleIds, 'selectedArticleIds');
  const attemptedArticleIds = idArray(result.attemptedArticleIds, 'attemptedArticleIds');
  const successfulArticleIds = idArray(result.successfulArticleIds, 'successfulArticleIds');
  const skippedArticles = outcomeArray(result.skippedArticles, 'skippedArticles');
  const failedArticles = outcomeArray(result.failedArticles, 'failedArticles');
  const unattemptedArticleIds = idArray(result.unattemptedArticleIds, 'unattemptedArticleIds');
  requireAllowed(result.endingReason as string, ['completed', 'canceled', 'circuit_breaker', 'error'], 'endingReason');
  skippedArticles.forEach(({ reason }) => requireAllowed(reason, ['no_usable_content', 'operator_canceled'], 'state skip reason'));
  failedArticles.forEach(({ reason }) => requireAllowed(reason, ['timeout', 'analysis_error', 'persistence_error'], 'state failure reason'));
  assertExclusiveTerminalIds(selectedArticleIds, [
    successfulArticleIds,
    skippedArticles.map(({ articleId }) => articleId),
    failedArticles.map(({ articleId }) => articleId),
    unattemptedArticleIds
  ]);
  const selectedSet = new Set(selectedArticleIds);
  if (attemptedArticleIds.some((id) => !selectedSet.has(id))) {
    throw new WorkerResultContractError('attemptedArticleIds contains an unselected ID');
  }
  reconcileCount(result, 'selectedCount', selectedArticleIds.length);
  reconcileCount(result, 'attemptedCount', attemptedArticleIds.length);
  reconcileCount(result, 'successfulCount', successfulArticleIds.length);
  reconcileCount(result, 'skippedCount', skippedArticles.length);
  reconcileCount(result, 'failedCount', failedArticles.length);
  reconcileCount(result, 'unattemptedCount', unattemptedArticleIds.length);
  const maximumConsecutiveFailures = count(result.maximumConsecutiveFailures, 'maximumConsecutiveFailures');
  if (typeof result.circuitBreakerTripped !== 'boolean') {
    throw new WorkerResultContractError('circuitBreakerTripped must be boolean');
  }
  if (result.circuitBreakerTripped && maximumConsecutiveFailures < 5) {
    throw new WorkerResultContractError('tripped circuit breaker requires five consecutive failures');
  }
  return {
    schemaVersion: 1,
    endingReason: result.endingReason as string,
    terminalMessage: result.terminalMessage as string,
    selectedArticleIds,
    attemptedArticleIds,
    successfulArticleIds,
    skippedArticles,
    failedArticles,
    unattemptedArticleIds,
    maximumConsecutiveFailures,
    circuitBreakerTripped: result.circuitBreakerTripped
  };
};
