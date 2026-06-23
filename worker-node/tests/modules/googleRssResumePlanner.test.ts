import {
  buildExpectedGoogleRssQueryRows,
  GoogleRssQueryRow,
} from '../../src/modules/google-rss/querySpreadsheet';
import {
  GoogleRssRequestCandidate,
  planGoogleRssResumeFromExpectedRows,
} from '../../src/modules/google-rss/resumePlanner';

const rows: GoogleRssQueryRow[] = [
  {
    id: 100,
    and_keywords: 'first query',
    and_exact_phrases: '',
    or_keywords: '',
    or_exact_phrases: '',
    time_range: '30d',
  },
  {
    id: 101,
    and_keywords: 'second query',
    and_exact_phrases: '',
    or_keywords: '',
    or_exact_phrases: '',
    time_range: '30d',
  },
  {
    id: 102,
    and_keywords: 'third query',
    and_exact_phrases: '',
    or_keywords: '',
    or_exact_phrases: '',
    time_range: '30d',
  },
];

const makeRequest = (
  overrides: Partial<GoogleRssRequestCandidate>
): GoogleRssRequestCandidate => ({
  id: overrides.id ?? 1,
  orchestratorRunId: overrides.orchestratorRunId ?? null,
  url: overrides.url ?? null,
  andString: overrides.andString ?? null,
  orString: overrides.orString ?? null,
  status: overrides.status ?? 'success',
  countOfArticlesReceivedFromRequest: overrides.countOfArticlesReceivedFromRequest ?? 0,
  countOfArticlesSavedToDbFromRequest: overrides.countOfArticlesSavedToDbFromRequest ?? 0,
  isFromAutomation: overrides.isFromAutomation ?? true,
  createdAt: overrides.createdAt ?? new Date('2026-06-23T00:00:00Z'),
  updatedAt: overrides.updatedAt ?? new Date('2026-06-23T00:00:00Z'),
});

describe('Google RSS resume planner', () => {
  beforeEach(() => {
    process.env.LIMIT_ARTICLE_AGE_IN_DAYS = '180';
  });

  it('uses the last exact URL match as the resume marker', () => {
    const expectedRows = buildExpectedGoogleRssQueryRows(rows);
    const plan = planGoogleRssResumeFromExpectedRows({
      sourceRunId: 14,
      expectedRows,
      requestCandidates: [
        makeRequest({ id: 1, url: expectedRows[0].requestUrl }),
        makeRequest({ id: 2, url: expectedRows[2].requestUrl }),
      ],
    });

    expect(plan.resumeAfter).toMatchObject({
      queryRowId: 102,
      queryRowIndex: 2,
      newsApiRequestId: 2,
      matchedBy: 'exact_url',
    });
    expect(plan.startFrom).toBeNull();
  });

  it('plans from the first query row when no persisted match exists', () => {
    const expectedRows = buildExpectedGoogleRssQueryRows(rows);
    const plan = planGoogleRssResumeFromExpectedRows({
      sourceRunId: 14,
      expectedRows,
      requestCandidates: [],
    });

    expect(plan).toMatchObject({
      resumeAfter: null,
      matchedRequestCount: 0,
      startFrom: {
        queryRowId: 100,
        queryRowIndex: 0,
      },
      replayAllowed: true,
    });
  });

  it('uses fallback query-string matching without requiring notString', () => {
    const expectedRows = buildExpectedGoogleRssQueryRows(rows);
    const plan = planGoogleRssResumeFromExpectedRows({
      sourceRunId: 14,
      expectedRows,
      requestCandidates: [
        makeRequest({
          id: 7,
          url: 'https://legacy.example/request-with-different-url',
          andString: expectedRows[1].andString,
          orString: expectedRows[1].orString,
          status: 'success',
          countOfArticlesReceivedFromRequest: 5,
          countOfArticlesSavedToDbFromRequest: 2,
        }),
      ],
    });

    expect(plan.resumeAfter).toMatchObject({
      queryRowId: 101,
      queryRowIndex: 1,
      newsApiRequestId: 7,
      matchedBy: 'fallback_query_strings',
    });
    expect(plan.startFrom).toMatchObject({
      queryRowId: 102,
      queryRowIndex: 2,
    });
  });
});
