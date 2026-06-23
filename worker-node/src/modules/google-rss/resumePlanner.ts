import { Op, WhereOptions } from 'sequelize';
import { NewsApiRequest } from '@newsnexus/db-models';
import {
  buildExpectedGoogleRssQueryRows,
  ExpectedGoogleRssQueryRow,
  readGoogleRssQuerySpreadsheet,
} from './querySpreadsheet';

export type GoogleRssResumeMatchType = 'exact_url' | 'fallback_query_strings';

export interface GoogleRssRequestCandidate {
  id: number;
  orchestratorRunId: number | null;
  url: string | null;
  andString: string | null;
  orString: string | null;
  status: string | null;
  countOfArticlesReceivedFromRequest: number | null;
  countOfArticlesSavedToDbFromRequest: number | null;
  isFromAutomation: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface GoogleRssResumeMarker {
  queryRowId: number;
  queryRowIndex: number;
  requestUrl: string;
  newsApiRequestId: number;
  matchedBy: GoogleRssResumeMatchType;
  requestCreatedAt: string;
}

export interface GoogleRssResumeStartRow {
  queryRowId: number;
  queryRowIndex: number;
  requestUrl: string | null;
}

export interface GoogleRssResumePlanningInput {
  sourceRunId: number;
  sourceStartedAt: Date | null;
  sourceEndedAt: Date | null;
  spreadsheetPath: string;
}

export interface GoogleRssResumePlanningResult {
  status: 'ready' | 'not_applicable';
  reason: string;
  sourceOrchestratorRunId: number;
  rowsTotal: number;
  expectedRequestCount: number;
  matchedRequestCount: number;
  resumeAfter: GoogleRssResumeMarker | null;
  startFrom: GoogleRssResumeStartRow | null;
  replayAllowed: boolean;
}

interface QueryRowMatch {
  expectedRow: ExpectedGoogleRssQueryRow;
  request: GoogleRssRequestCandidate;
  matchedBy: GoogleRssResumeMatchType;
}

const MATCHABLE_REQUEST_STATUSES = new Set(['success', 'error']);

export const buildGoogleRssResumePlan = async (
  input: GoogleRssResumePlanningInput
): Promise<GoogleRssResumePlanningResult> => {
  const rows = await readGoogleRssQuerySpreadsheet(input.spreadsheetPath);
  const expectedRows = buildExpectedGoogleRssQueryRows(rows);
  const requestCandidates = await findGoogleRssRequestCandidates(input);
  return planGoogleRssResumeFromExpectedRows({
    sourceRunId: input.sourceRunId,
    expectedRows,
    requestCandidates,
  });
};

export const planGoogleRssResumeFromExpectedRows = (input: {
  sourceRunId: number;
  expectedRows: ExpectedGoogleRssQueryRow[];
  requestCandidates: GoogleRssRequestCandidate[];
}): GoogleRssResumePlanningResult => {
  const { expectedRows, requestCandidates } = input;
  const latestMatch = findLatestMatchingQueryRow(expectedRows, requestCandidates);
  const expectedRequestCount = expectedRows.filter((row) => row.requestUrl !== null).length;

  if (!latestMatch) {
    return {
      status: 'ready',
      reason: 'No persisted Google RSS request matched the source run; continuation will start from the first spreadsheet row.',
      sourceOrchestratorRunId: input.sourceRunId,
      rowsTotal: expectedRows.length,
      expectedRequestCount,
      matchedRequestCount: 0,
      resumeAfter: null,
      startFrom: toStartRow(expectedRows[0] ?? null),
      replayAllowed: true,
    };
  }

  const nextRow = expectedRows[latestMatch.expectedRow.rowIndex + 1] ?? null;
  return {
    status: 'ready',
    reason: 'Continuation will resume after the latest persisted Google RSS request matched to the source run.',
    sourceOrchestratorRunId: input.sourceRunId,
    rowsTotal: expectedRows.length,
    expectedRequestCount,
    matchedRequestCount: countMatchingQueryRows(expectedRows, requestCandidates),
    resumeAfter: {
      queryRowId: latestMatch.expectedRow.row.id,
      queryRowIndex: latestMatch.expectedRow.rowIndex,
      requestUrl: latestMatch.expectedRow.requestUrl ?? latestMatch.request.url ?? '',
      newsApiRequestId: latestMatch.request.id,
      matchedBy: latestMatch.matchedBy,
      requestCreatedAt: latestMatch.request.createdAt.toISOString(),
    },
    startFrom: toStartRow(nextRow),
    replayAllowed: true,
  };
};

export const findLatestMatchingQueryRow = (
  expectedRows: ExpectedGoogleRssQueryRow[],
  requestCandidates: GoogleRssRequestCandidate[]
): QueryRowMatch | null => {
  const exactMatches = collectExactUrlMatches(expectedRows, requestCandidates);
  if (exactMatches.length > 0) {
    return pickLatestQueryRowMatch(exactMatches);
  }

  const fallbackMatches = collectFallbackMatches(expectedRows, requestCandidates);
  if (fallbackMatches.length > 0) {
    return pickLatestQueryRowMatch(fallbackMatches);
  }

  return null;
};

const findGoogleRssRequestCandidates = async (
  input: GoogleRssResumePlanningInput
): Promise<GoogleRssRequestCandidate[]> => {
  const andConditions: WhereOptions[] = [{ isFromAutomation: true }];

  if (input.sourceStartedAt || input.sourceEndedAt) {
    const createdAtWindow: Record<symbol, Date> = {};
    if (input.sourceStartedAt) {
      createdAtWindow[Op.gte] = input.sourceStartedAt;
    }
    if (input.sourceEndedAt) {
      createdAtWindow[Op.lte] = input.sourceEndedAt;
    }
    andConditions.push({ createdAt: createdAtWindow });
  }

  const where: WhereOptions = {
    [Op.and]: [
      ...andConditions,
      {
        [Op.or]: [
          { orchestratorRunId: input.sourceRunId },
          { orchestratorRunId: null },
        ],
      },
    ],
  };

  const requests = await NewsApiRequest.findAll({
    where,
    order: [
      ['createdAt', 'ASC'],
      ['id', 'ASC'],
    ],
  });

  return requests.map((request) => ({
    id: request.id,
    orchestratorRunId: request.orchestratorRunId,
    url: request.url,
    andString: request.andString,
    orString: request.orString,
    status: request.status,
    countOfArticlesReceivedFromRequest: request.countOfArticlesReceivedFromRequest,
    countOfArticlesSavedToDbFromRequest: request.countOfArticlesSavedToDbFromRequest,
    isFromAutomation: request.isFromAutomation,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  }));
};

const collectExactUrlMatches = (
  expectedRows: ExpectedGoogleRssQueryRow[],
  requestCandidates: GoogleRssRequestCandidate[]
): QueryRowMatch[] => {
  const requestsByUrl = new Map<string, GoogleRssRequestCandidate[]>();
  for (const request of requestCandidates) {
    if (!request.url) {
      continue;
    }
    const existing = requestsByUrl.get(request.url) ?? [];
    existing.push(request);
    requestsByUrl.set(request.url, existing);
  }

  const matches: QueryRowMatch[] = [];
  for (const expectedRow of expectedRows) {
    if (!expectedRow.requestUrl) {
      continue;
    }
    for (const request of requestsByUrl.get(expectedRow.requestUrl) ?? []) {
      matches.push({ expectedRow, request, matchedBy: 'exact_url' });
    }
  }
  return matches;
};

const collectFallbackMatches = (
  expectedRows: ExpectedGoogleRssQueryRow[],
  requestCandidates: GoogleRssRequestCandidate[]
): QueryRowMatch[] => {
  const matches: QueryRowMatch[] = [];
  for (const expectedRow of expectedRows) {
    if (!expectedRow.requestUrl) {
      continue;
    }
    for (const request of requestCandidates) {
      if (isFallbackMatch(expectedRow, request)) {
        matches.push({ expectedRow, request, matchedBy: 'fallback_query_strings' });
      }
    }
  }
  return matches;
};

const isFallbackMatch = (
  expectedRow: ExpectedGoogleRssQueryRow,
  request: GoogleRssRequestCandidate
): boolean => {
  if (!request.isFromAutomation) {
    return false;
  }
  if (!request.status || !MATCHABLE_REQUEST_STATUSES.has(request.status)) {
    return false;
  }
  if (
    request.countOfArticlesReceivedFromRequest === null ||
    request.countOfArticlesSavedToDbFromRequest === null
  ) {
    return false;
  }
  if (request.countOfArticlesReceivedFromRequest < 0 || request.countOfArticlesSavedToDbFromRequest < 0) {
    return false;
  }
  return request.andString === expectedRow.andString && request.orString === expectedRow.orString;
};

const pickLatestQueryRowMatch = (matches: QueryRowMatch[]): QueryRowMatch =>
  [...matches].sort((a, b) => {
    if (a.expectedRow.rowIndex !== b.expectedRow.rowIndex) {
      return b.expectedRow.rowIndex - a.expectedRow.rowIndex;
    }
    if (a.request.createdAt.getTime() !== b.request.createdAt.getTime()) {
      return b.request.createdAt.getTime() - a.request.createdAt.getTime();
    }
    return b.request.id - a.request.id;
  })[0];

const countMatchingQueryRows = (
  expectedRows: ExpectedGoogleRssQueryRow[],
  requestCandidates: GoogleRssRequestCandidate[]
): number => {
  const matchedRowIndexes = new Set<number>();
  for (const match of [
    ...collectExactUrlMatches(expectedRows, requestCandidates),
    ...collectFallbackMatches(expectedRows, requestCandidates),
  ]) {
    matchedRowIndexes.add(match.expectedRow.rowIndex);
  }
  return matchedRowIndexes.size;
};

const toStartRow = (row: ExpectedGoogleRssQueryRow | null): GoogleRssResumeStartRow | null => {
  if (!row) {
    return null;
  }
  return {
    queryRowId: row.row.id,
    queryRowIndex: row.rowIndex,
    requestUrl: row.requestUrl,
  };
};
