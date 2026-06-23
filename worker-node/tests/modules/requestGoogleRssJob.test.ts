import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  Article,
  NewsApiRequest,
  NewsArticleAggregatorSource,
  initModels
} from '@newsnexus/db-models';
import {
  createRequestGoogleRssJobHandler,
  createRssSeedResult,
  DEFAULT_REQUEST_GOOGLE_RSS_REPEAT_WINDOW_HOURS,
  GoogleRssJobResult,
  mapRssItems,
  shouldSkipRowForResumePlan
} from '../../src/modules/jobs/requestGoogleRssJob';

const makeQueueContext = (overrides: Partial<{
  jobId: string;
  updateResult: jest.Mock;
  signal: AbortSignal;
}> = {}) => ({
  jobId: overrides.jobId ?? 'job-1',
  endpointName: '/request-google-rss/start-job',
  signal: overrides.signal ?? new AbortController().signal,
  registerCancelableProcess: () => undefined,
  updateResult: overrides.updateResult ?? jest.fn(() => Promise.resolve())
});

type TestQueryRow = [number, string, string, string, string, string];

const RECENT_RSS_PUB_DATE = new Date().toUTCString();

const createTestSpreadsheet = async (
  dir: string,
  rows: TestQueryRow[] = [[1, 'test news', '', '', '', '30d']]
): Promise<string> => {
  const filePath = path.join(dir, 'queries.xlsx');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Queries');
  sheet.addRow(['id', 'and_keywords', 'and_exact_phrases', 'or_keywords', 'or_exact_phrases', 'time_range']);
  for (const row of rows) {
    sheet.addRow(row);
  }
  await workbook.xlsx.writeFile(filePath);
  return filePath;
};

const makeRssXml = (title = 'Test Article', link = 'https://example.com/article', content = 'x'.repeat(300)): string =>
  makeRssXmlFromItems([{ title, link, content }]);

const makeRssXmlFromItems = (
  items: Array<{ title: string; link: string; content?: string }>
): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Google News</title>
    ${items
      .map(
        (item) => `<item>
      <title>${item.title}</title>
      <link>${item.link}</link>
      <pubDate>${RECENT_RSS_PUB_DATE}</pubDate>
      <source>Example News</source>
      <content:encoded><![CDATA[${item.content ?? 'x'.repeat(300)}]]></content:encoded>
    </item>`
      )
      .join('\n')}
  </channel>
</rss>`;

const makeGoogleRssUrl = (query: string): string => {
  const params = new URLSearchParams({ q: query });
  params.set('hl', process.env.GOOGLE_RSS_HL || 'en-US');
  params.set('gl', process.env.GOOGLE_RSS_GL || 'US');
  params.set('ceid', process.env.GOOGLE_RSS_CEID || 'US:en');
  return `https://news.google.com/rss/search?${params.toString()}`;
};

const getLatestResult = (updateResult: jest.Mock): GoogleRssJobResult => {
  const calls = updateResult.mock.calls;
  return calls[calls.length - 1][0] as GoogleRssJobResult;
};

const createArticles = async (urls: string[]): Promise<void> => {
  for (const url of urls) {
    await Article.create({
      publicationName: 'Existing News',
      title: `Existing ${url}`,
      description: 'Already saved',
      url,
      publishedDate: '2026-04-29'
    });
  }
};

const countArticlesByUrls = async (urls: string[]): Promise<number> => {
  let count = 0;
  for (const url of urls) {
    count += await Article.count({ where: { url } });
  }
  return count;
};

const expectArticlesExist = async (urls: string[]): Promise<void> => {
  for (const url of urls) {
    await expect(Article.findOne({ where: { url } })).resolves.toBeTruthy();
  }
};

const createAggregatorSourceId = async (): Promise<number> => {
  const source = await NewsArticleAggregatorSource.create({
    nameOfOrg: `Test Source ${Date.now()}-${Math.random()}`,
    isRss: true,
    isApi: false
  });
  return source.id;
};

beforeAll(() => {
  initModels();
});

const makeEmptyRssXml = (): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Google News</title>
  </channel>
</rss>`;

describe('requestGoogleRss job handler', () => {
  it('fails when spreadsheet file is missing', async () => {
    const handler = createRequestGoogleRssJobHandler({
      spreadsheetPath: '/path/that/does/not/exist.xlsx',
      doNotRepeatRequestsWithinHours: DEFAULT_REQUEST_GOOGLE_RSS_REPEAT_WINDOW_HOURS
    });

    await expect(
      handler(makeQueueContext())
    ).rejects.toThrow('Spreadsheet file not found');
  });

  it('passes spreadsheet path and updateResult to legacy workflow dependency', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'request-google-rss-job-'));
    const spreadsheetPath = path.join(tempDir, 'queries.xlsx');
    await fs.writeFile(spreadsheetPath, 'mock spreadsheet data', 'utf8');

    const runLegacyWorkflow = jest.fn(async () => undefined);
    const handler = createRequestGoogleRssJobHandler(
      {
        spreadsheetPath,
        doNotRepeatRequestsWithinHours: 24
      },
      { runLegacyWorkflow }
    );

    const updateResult = jest.fn(() => Promise.resolve());
    await handler(makeQueueContext({ jobId: 'job-2', updateResult }));

    expect(runLegacyWorkflow).toHaveBeenCalledWith({
      jobId: 'job-2',
      spreadsheetPath,
      doNotRepeatRequestsWithinHours: 24,
      signal: expect.any(Object),
      updateResult: expect.any(Function)
    });

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('passes targetArticlesAddedCount to legacy workflow dependency', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'request-google-rss-job-'));
    const spreadsheetPath = path.join(tempDir, 'queries.xlsx');
    await fs.writeFile(spreadsheetPath, 'mock spreadsheet data', 'utf8');

    const runLegacyWorkflow = jest.fn(async () => undefined);
    const handler = createRequestGoogleRssJobHandler(
      {
        spreadsheetPath,
        doNotRepeatRequestsWithinHours: 0,
        targetArticlesAddedCount: 10
      },
      { runLegacyWorkflow }
    );

    await handler(makeQueueContext({ jobId: 'job-target' }));

    expect(runLegacyWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-target',
        spreadsheetPath,
        doNotRepeatRequestsWithinHours: 0,
        targetArticlesAddedCount: 10
      })
    );

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('passes orchestratorRunId to legacy workflow dependency', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'request-google-rss-job-'));
    const spreadsheetPath = path.join(tempDir, 'queries.xlsx');
    await fs.writeFile(spreadsheetPath, 'mock spreadsheet data', 'utf8');

    const runLegacyWorkflow = jest.fn(async () => undefined);
    const handler = createRequestGoogleRssJobHandler(
      {
        spreadsheetPath,
        doNotRepeatRequestsWithinHours: 0,
        orchestratorRunId: 42
      },
      { runLegacyWorkflow }
    );

    await handler(makeQueueContext({ jobId: 'job-run-linked' }));

    expect(runLegacyWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-run-linked',
        orchestratorRunId: 42
      })
    );

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('passes resumePlan to legacy workflow dependency', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'request-google-rss-job-'));
    const spreadsheetPath = path.join(tempDir, 'queries.xlsx');
    await fs.writeFile(spreadsheetPath, 'mock spreadsheet data', 'utf8');

    const runLegacyWorkflow = jest.fn(async () => undefined);
    const resumePlan = {
      resumeAfterRequestUrl: 'https://news.google.com/rss/search?q=previous',
      resumeAfterQueryRowIndex: 1,
      resumeAfterQueryRowId: 101,
      sourceOrchestratorRunId: 14,
      continuationRunId: 15
    };
    const handler = createRequestGoogleRssJobHandler(
      {
        spreadsheetPath,
        doNotRepeatRequestsWithinHours: 0,
        resumePlan
      },
      { runLegacyWorkflow }
    );

    await handler(makeQueueContext({ jobId: 'job-resume-plan' }));

    expect(runLegacyWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-resume-plan',
        resumePlan
      })
    );

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('maps RSS item content from content:encoded', () => {
    const items = mapRssItems([
      {
        title: ['Example article'],
        description: ['<a href="https://example.com">Summary text</a>'],
        link: ['https://news.google.com/rss/articles/abc'],
        pubDate: ['Fri, 21 Mar 2026 12:00:00 GMT'],
        source: [{ _: 'Example Source' }],
        'content:encoded': ['<p>Full article body</p>']
      }
    ]);

    expect(items).toEqual([
      {
        title: 'Example article',
        description: 'Summary text',
        link: 'https://news.google.com/rss/articles/abc',
        pubDate: 'Fri, 21 Mar 2026 12:00:00 GMT',
        source: 'Example Source',
        content: 'Full article body'
      }
    ]);
  });

  it('creates a successful ArticleContents02 seed result when RSS content is usable', () => {
    const result = createRssSeedResult(42, 'https://news.google.com/rss/articles/abc', {
      title: 'Example article',
      content: 'A'.repeat(240)
    });

    expect(result).toMatchObject({
      articleId: 42,
      googleRssUrl: 'https://news.google.com/rss/articles/abc',
      status: 'success',
      failureType: null,
      details: 'Seeded from Google RSS item content',
      extractionSource: 'none',
      bodySource: 'rss-feed',
      content: 'A'.repeat(240)
    });
  });

  it('creates a temporary failed seed result when RSS content is too short', () => {
    const result = createRssSeedResult(42, 'https://news.google.com/rss/articles/abc', {
      title: 'Example article',
      content: 'short content'
    });

    expect(result).toMatchObject({
      articleId: 42,
      status: 'fail',
      failureType: 'short_content',
      details: 'RSS item content too short; triggering Google-to-publisher scrape',
      bodySource: 'rss-feed',
      content: 'short content'
    });
  });

  it('creates a temporary failed seed result when RSS content is missing', () => {
    const result = createRssSeedResult(42, 'https://news.google.com/rss/articles/abc', {
      title: 'Example article'
    });

    expect(result).toMatchObject({
      articleId: 42,
      status: 'fail',
      failureType: null,
      details: 'RSS item content missing; triggering Google-to-publisher scrape',
      bodySource: 'none',
      content: null
    });
  });

  it('identifies rows through the resume marker as skippable', () => {
    const row = {
      id: 110,
      and_keywords: 'already persisted',
      and_exact_phrases: '',
      or_keywords: '',
      or_exact_phrases: '',
      time_range: '30d'
    };

    expect(
      shouldSkipRowForResumePlan(row, 0, makeGoogleRssUrl('"already persisted" when:30d'), {
        resumeAfterQueryRowIndex: 0,
        resumeAfterQueryRowId: 110,
        resumeAfterRequestUrl: makeGoogleRssUrl('"already persisted" when:30d'),
        sourceOrchestratorRunId: 14,
        continuationRunId: 15
      })
    ).toBe(true);
    expect(
      shouldSkipRowForResumePlan({ ...row, id: 111 }, 1, makeGoogleRssUrl('"next query" when:30d'), {
        resumeAfterQueryRowIndex: 0,
        resumeAfterQueryRowId: 110
      })
    ).toBe(false);
  });
});

describe('requestGoogleRss terminal path results', () => {
  let tempDir: string;
  let spreadsheetPath: string;
  let fetchSpy: jest.SpyInstance;
  let originalDelay: string | undefined;

  beforeEach(async () => {
    originalDelay = process.env.MILISECONDS_IN_BETWEEN_REQUESTS;
    process.env.MILISECONDS_IN_BETWEEN_REQUESTS = '500';
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rss-terminal-'));
    spreadsheetPath = await createTestSpreadsheet(tempDir);
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(async () => {
    fetchSpy.mockRestore();
    jest.restoreAllMocks();
    if (originalDelay === undefined) {
      delete process.env.MILISECONDS_IN_BETWEEN_REQUESTS;
    } else {
      process.env.MILISECONDS_IN_BETWEEN_REQUESTS = originalDelay;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('writes endingReason=queries_exhausted when all rows are processed', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => makeRssXml()
    } as Response);

    const updateResult = jest.fn(() => Promise.resolve());
    const handler = createRequestGoogleRssJobHandler({ spreadsheetPath, doNotRepeatRequestsWithinHours: 0 });

    await handler(makeQueueContext({ updateResult }));

    expect(updateResult).toHaveBeenCalledWith(
      expect.objectContaining<Partial<GoogleRssJobResult>>({ endingReason: 'queries_exhausted' })
    );
  });

  it('writes endingReason=rate_limited on HTTP 503 response', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => ''
    } as Response);

    const updateResult = jest.fn(() => Promise.resolve());
    const handler = createRequestGoogleRssJobHandler({ spreadsheetPath, doNotRepeatRequestsWithinHours: 0 });

    await handler(makeQueueContext({ updateResult }));

    expect(updateResult).toHaveBeenCalledWith(
      expect.objectContaining<Partial<GoogleRssJobResult>>({ endingReason: 'rate_limited' })
    );
  });

  it('writes endingReason=error when spreadsheet is unreadable', async () => {
    // Write a file that ExcelJS cannot parse as a valid xlsx
    const badSpreadsheet = path.join(tempDir, 'bad.xlsx');
    await fs.writeFile(badSpreadsheet, 'not an xlsx file', 'utf8');

    const updateResult = jest.fn(() => Promise.resolve());
    const handler = createRequestGoogleRssJobHandler({
      spreadsheetPath: badSpreadsheet,
      doNotRepeatRequestsWithinHours: 0
    });

    await handler(makeQueueContext({ updateResult }));

    expect(updateResult).toHaveBeenCalledWith(
      expect.objectContaining<Partial<GoogleRssJobResult>>({ endingReason: 'error' })
    );
  });

  it('writes endingReason=canceled when signal is pre-aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const updateResult = jest.fn(() => Promise.resolve());
    const handler = createRequestGoogleRssJobHandler({ spreadsheetPath, doNotRepeatRequestsWithinHours: 0 });

    await handler(makeQueueContext({ signal: controller.signal, updateResult }));

    expect(updateResult).toHaveBeenCalledWith(
      expect.objectContaining<Partial<GoogleRssJobResult>>({ endingReason: 'canceled' })
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('includes articlesAddedCount in every result', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => ''
    } as Response);

    const updateResult = jest.fn(() => Promise.resolve());
    const handler = createRequestGoogleRssJobHandler({ spreadsheetPath, doNotRepeatRequestsWithinHours: 0 });

    await handler(makeQueueContext({ updateResult }));

    expect(updateResult).toHaveBeenCalledWith(
      expect.objectContaining({ articlesAddedCount: expect.any(Number) })
    );
  });

  it('includes one query result for every spreadsheet row', async () => {
    spreadsheetPath = await createTestSpreadsheet(tempDir, [
      [1, 'cpsc', '', '', '', '30d'],
      [2, 'recall', '"product safety"', 'warning', '', '90d']
    ]);
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => makeEmptyRssXml()
    } as Response);

    const updateResult = jest.fn(() => Promise.resolve());
    const handler = createRequestGoogleRssJobHandler({ spreadsheetPath, doNotRepeatRequestsWithinHours: 0 });

    await handler(makeQueueContext({ updateResult }));

    expect(updateResult).toHaveBeenCalledWith(
      expect.objectContaining<Partial<GoogleRssJobResult>>({
        queryResults: [
          {
            id: 1,
            and_keywords: 'cpsc',
            and_exact_phrases: '',
            or_keywords: '',
            or_exact_phrases: '',
            time_range: '30d',
            status: 'success',
            saved_articles: 0,
            note: null
          },
          {
            id: 2,
            and_keywords: 'recall',
            and_exact_phrases: '"product safety"',
            or_keywords: 'warning',
            or_exact_phrases: '',
            time_range: '90d',
            status: 'success',
            saved_articles: 0,
            note: null
          }
        ]
      })
    );
  });

  it('records blank keyword rows as empty_query and continues', async () => {
    spreadsheetPath = await createTestSpreadsheet(tempDir, [
      [10, '', '', '', '', '180d'],
      [11, 'cpsc', '', '', '', '30d']
    ]);
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => makeEmptyRssXml()
    } as Response);

    const updateResult = jest.fn(() => Promise.resolve());
    const handler = createRequestGoogleRssJobHandler({ spreadsheetPath, doNotRepeatRequestsWithinHours: 0 });

    await handler(makeQueueContext({ updateResult }));

    const result = getLatestResult(updateResult);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.queryResults[0]).toMatchObject({
      status: 'skipped',
      saved_articles: 0,
      note: 'empty_query'
    });
    expect(result.queryResults[1]).toMatchObject({
      status: 'success',
      saved_articles: 0,
      note: null
    });
  });

  it('records repeat-window rows as skipped without creating another request', async () => {
    spreadsheetPath = await createTestSpreadsheet(tempDir, [
      [20, 'repeatable query', '', '', '', '30d']
    ]);
    const requestUrl = makeGoogleRssUrl('"repeatable query" when:30d');
    await NewsApiRequest.create({
      newsArticleAggregatorSourceId: await createAggregatorSourceId(),
      status: 'success',
      url: requestUrl,
      isFromAutomation: true
    });
    const countBefore = await NewsApiRequest.count({ where: { url: requestUrl } });

    const updateResult = jest.fn(() => Promise.resolve());
    const handler = createRequestGoogleRssJobHandler({
      spreadsheetPath,
      doNotRepeatRequestsWithinHours: 72
    });

    await handler(makeQueueContext({ updateResult }));

    const result = getLatestResult(updateResult);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.queryResults[0]).toMatchObject({
      status: 'skipped',
      saved_articles: 0,
      note: 'repeat_window'
    });
    await expect(NewsApiRequest.count({ where: { url: requestUrl } })).resolves.toBe(countBefore);
  });

  it('records successful requests with saved article counts and keeps the time range in the URL', async () => {
    const urls = [
      'https://example.com/rss-success-1',
      'https://example.com/rss-success-2',
      'https://example.com/rss-success-3'
    ];
    spreadsheetPath = await createTestSpreadsheet(tempDir, [
      [30, 'success query', '', '', '', '180d']
    ]);
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        makeRssXmlFromItems(urls.map((url, index) => ({ title: `Success ${index}`, link: url })))
    } as Response);

    const updateResult = jest.fn(() => Promise.resolve());
    const handler = createRequestGoogleRssJobHandler({ spreadsheetPath, doNotRepeatRequestsWithinHours: 0 });

    await handler(makeQueueContext({ updateResult }));

    const result = getLatestResult(updateResult);
    const fetchedUrl = decodeURIComponent(String(fetchSpy.mock.calls[0][0]));
    expect(fetchedUrl).toContain('when:180d');
    expect(result.queryResults[0]).toMatchObject({
      status: 'success',
      saved_articles: 3,
      note: null
    });
    await expectArticlesExist(urls);
    await expect(NewsApiRequest.count({ where: { url: String(fetchSpy.mock.calls[0][0]) } })).resolves.toBe(1);
  });

  it('records successful requests with zero saves when all articles already exist', async () => {
    const urls = [
      'https://example.com/rss-existing-1',
      'https://example.com/rss-existing-2',
      'https://example.com/rss-existing-3'
    ];
    await createArticles(urls);
    const articleCountBefore = await countArticlesByUrls(urls);
    spreadsheetPath = await createTestSpreadsheet(tempDir, [
      [40, 'existing query', '', '', '', '30d']
    ]);
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        makeRssXmlFromItems(urls.map((url, index) => ({ title: `Existing ${index}`, link: url })))
    } as Response);

    const updateResult = jest.fn(() => Promise.resolve());
    const handler = createRequestGoogleRssJobHandler({ spreadsheetPath, doNotRepeatRequestsWithinHours: 0 });

    await handler(makeQueueContext({ updateResult }));

    const result = getLatestResult(updateResult);
    expect(result.queryResults[0]).toMatchObject({
      status: 'success',
      saved_articles: 0,
      note: null
    });
    await expect(countArticlesByUrls(urls)).resolves.toBe(articleCountBefore);
    await expect(NewsApiRequest.count({ where: { url: String(fetchSpy.mock.calls[0][0]) } })).resolves.toBe(1);
  });

  it('persists non-503 RSS errors and continues after the normal delay path', async () => {
    spreadsheetPath = await createTestSpreadsheet(tempDir, [
      [50, 'server error query', '', '', '', '30d'],
      [51, 'after error query', '', '', '', '30d']
    ]);
    const errorUrl = makeGoogleRssUrl('"server error query" when:30d');
    fetchSpy
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'server error'
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => makeEmptyRssXml()
      } as Response);

    const updateResult = jest.fn(() => Promise.resolve());
    const handler = createRequestGoogleRssJobHandler({ spreadsheetPath, doNotRepeatRequestsWithinHours: 0 });

    await handler(makeQueueContext({ updateResult }));

    const result = getLatestResult(updateResult);
    const errorRequest = await NewsApiRequest.findOne({ where: { url: errorUrl } });
    expect(errorRequest).toMatchObject({
      status: 'error',
      countOfArticlesSavedToDbFromRequest: 0
    });
    expect(result.queryResults[0]).toMatchObject({
      status: 'failed',
      saved_articles: 0,
      note: 'rss_fetch_error: RSS request failed with status 500'
    });
    expect(result.queryResults[1]).toMatchObject({
      status: 'success',
      saved_articles: 0,
      note: null
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('records HTTP 503 as rate_limited and leaves later rows not_reached', async () => {
    spreadsheetPath = await createTestSpreadsheet(tempDir, [
      [60, 'rate limited query', '', '', '', '30d'],
      [61, 'tail query', '', '', '', '30d']
    ]);
    const rateLimitedUrl = makeGoogleRssUrl('rate limited query when:30d');
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'unavailable'
    } as Response);

    const updateResult = jest.fn(() => Promise.resolve());
    const handler = createRequestGoogleRssJobHandler({ spreadsheetPath, doNotRepeatRequestsWithinHours: 0 });

    await handler(makeQueueContext({ updateResult }));

    const result = getLatestResult(updateResult);
    expect(result.endingReason).toBe('rate_limited');
    expect(result.queryResults[0]).toMatchObject({
      status: 'failed',
      saved_articles: 0,
      note: 'rate_limited'
    });
    expect(result.queryResults[1]).toMatchObject({
      status: 'skipped',
      saved_articles: 0,
      note: 'not_reached'
    });
    await expect(NewsApiRequest.count({ where: { url: rateLimitedUrl } })).resolves.toBe(0);
  });

  it('keeps the successful row outcome when the target is reached', async () => {
    const urls = [
      'https://example.com/rss-target-1',
      'https://example.com/rss-target-2',
      'https://example.com/rss-target-3'
    ];
    spreadsheetPath = await createTestSpreadsheet(tempDir, [
      [70, 'target query', '', '', '', '30d'],
      [71, 'after target query', '', '', '', '30d']
    ]);
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        makeRssXmlFromItems(urls.map((url, index) => ({ title: `Target ${index}`, link: url })))
    } as Response);

    const updateResult = jest.fn(() => Promise.resolve());
    const handler = createRequestGoogleRssJobHandler({
      spreadsheetPath,
      doNotRepeatRequestsWithinHours: 0,
      targetArticlesAddedCount: 3
    });

    await handler(makeQueueContext({ updateResult }));

    const result = getLatestResult(updateResult);
    expect(result.endingReason).toBe('target_articles_collected');
    expect(result.queryResults[0]).toMatchObject({
      status: 'success',
      saved_articles: 3,
      note: null
    });
    expect(result.queryResults[1]).toMatchObject({
      status: 'skipped',
      saved_articles: 0,
      note: 'not_reached'
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the successful row outcome when canceled during the post-request delay', async () => {
    spreadsheetPath = await createTestSpreadsheet(tempDir, [
      [80, 'cancel after success', '', '', '', '30d'],
      [81, 'after cancel', '', '', '', '30d']
    ]);
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => makeRssXml('Cancel Success', 'https://example.com/rss-cancel-after-success')
    } as Response);
    const controller = new AbortController();
    const updateResult = jest.fn(() => Promise.resolve());
    const handler = createRequestGoogleRssJobHandler({ spreadsheetPath, doNotRepeatRequestsWithinHours: 0 });
    const abortTimer = setTimeout(() => controller.abort(), 100);

    await handler(makeQueueContext({ signal: controller.signal, updateResult }));
    clearTimeout(abortTimer);

    const result = getLatestResult(updateResult);
    expect(result.endingReason).toBe('canceled');
    expect(result.queryResults[0]).toMatchObject({
      status: 'success',
      saved_articles: 1,
      note: null
    });
    expect(result.queryResults[1]).toMatchObject({
      status: 'skipped',
      saved_articles: 0,
      note: 'not_reached'
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('records the active row as canceled when the signal is pre-aborted', async () => {
    spreadsheetPath = await createTestSpreadsheet(tempDir, [
      [90, 'pre canceled', '', '', '', '30d'],
      [91, 'after pre canceled', '', '', '', '30d']
    ]);
    const controller = new AbortController();
    controller.abort();

    const updateResult = jest.fn(() => Promise.resolve());
    const handler = createRequestGoogleRssJobHandler({ spreadsheetPath, doNotRepeatRequestsWithinHours: 0 });

    await handler(makeQueueContext({ signal: controller.signal, updateResult }));

    const result = getLatestResult(updateResult);
    expect(result.queryResults[0]).toMatchObject({
      status: 'skipped',
      saved_articles: 0,
      note: 'canceled'
    });
    expect(result.queryResults[1]).toMatchObject({
      status: 'skipped',
      saved_articles: 0,
      note: 'not_reached'
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('records the active row as failed when an article create throws mid-row', async () => {
    spreadsheetPath = await createTestSpreadsheet(tempDir, [
      [100, '', '', '', '', '30d'],
      [101, 'exception query', '', '', '', '30d'],
      [102, 'after exception', '', '', '', '30d']
    ]);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => makeRssXml('Exception Article', 'https://example.com/rss-exception')
    } as Response);
    jest.spyOn(Article, 'create').mockRejectedValueOnce(new Error('article create failed'));

    const updateResult = jest.fn(() => Promise.resolve());
    const handler = createRequestGoogleRssJobHandler({ spreadsheetPath, doNotRepeatRequestsWithinHours: 0 });

    await handler(makeQueueContext({ updateResult }));

    const result = getLatestResult(updateResult);
    expect(result.endingReason).toBe('error');
    expect(result.queryResults[0]).toMatchObject({
      status: 'skipped',
      saved_articles: 0,
      note: 'empty_query'
    });
    expect(result.queryResults[1]).toMatchObject({
      status: 'failed',
      saved_articles: 0,
      note: 'error: article create failed'
    });
    expect(result.queryResults[2]).toMatchObject({
      status: 'skipped',
      saved_articles: 0,
      note: 'not_reached'
    });
  });

  it('preserves duplicate spreadsheet ids as separate query results', async () => {
    spreadsheetPath = await createTestSpreadsheet(tempDir, [
      [110, 'duplicate one', '', '', '', '30d'],
      [110, 'duplicate two', '', '', '', '30d']
    ]);
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => makeEmptyRssXml()
    } as Response);

    const updateResult = jest.fn(() => Promise.resolve());
    const handler = createRequestGoogleRssJobHandler({ spreadsheetPath, doNotRepeatRequestsWithinHours: 0 });

    await handler(makeQueueContext({ updateResult }));

    const result = getLatestResult(updateResult);
    expect(result.queryResults).toHaveLength(2);
    expect(result.queryResults[0]).toMatchObject({
      id: 110,
      and_keywords: 'duplicate one',
      status: 'success'
    });
    expect(result.queryResults[1]).toMatchObject({
      id: 110,
      and_keywords: 'duplicate two',
      status: 'success'
    });
  });
});
