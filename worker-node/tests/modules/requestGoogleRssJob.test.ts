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
  buildRssHeaderSummary,
  createRequestGoogleRssJobHandler,
  createRssSeedResult,
  DEFAULT_REQUEST_GOOGLE_RSS_REPEAT_WINDOW_HOURS,
  GoogleRssJobResult,
  mapRssItems
} from '../../src/modules/jobs/requestGoogleRssJob';
import logger from '../../src/modules/logger';

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

});

describe('requestGoogleRss terminal path results', () => {
  let tempDir: string;
  let spreadsheetPath: string;
  let fetchSpy: jest.SpyInstance;
  let originalDelay: string | undefined;
  let originalRetryDelay: string | undefined;

  beforeEach(async () => {
    originalDelay = process.env.MILISECONDS_IN_BETWEEN_REQUESTS;
    process.env.MILISECONDS_IN_BETWEEN_REQUESTS = '500';
    originalRetryDelay = process.env.MINUTES_IN_BETWEEN_REQUESTS_RETRY;
    process.env.MINUTES_IN_BETWEEN_REQUESTS_RETRY = '0.001';
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
    if (originalRetryDelay === undefined) {
      delete process.env.MINUTES_IN_BETWEEN_REQUESTS_RETRY;
    } else {
      process.env.MINUTES_IN_BETWEEN_REQUESTS_RETRY = originalRetryDelay;
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
    fetchSpy.mockImplementation(async () => new Response('', { status: 503 }));

    const updateResult = jest.fn(() => Promise.resolve());
    const handler = createRequestGoogleRssJobHandler({ spreadsheetPath, doNotRepeatRequestsWithinHours: 0 });

    await handler(makeQueueContext({ updateResult }));

    expect(updateResult).toHaveBeenCalledWith(
      expect.objectContaining<Partial<GoogleRssJobResult>>({ endingReason: 'rate_limited' })
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
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
    fetchSpy.mockImplementation(async () => new Response('unavailable', { status: 503 }));

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
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('retries one HTTP 503 and saves the recovered response once', async () => {
    spreadsheetPath = await createTestSpreadsheet(tempDir, [[100, 'retry recovers', '', '', '', '30d']]);
    const requestUrl = makeGoogleRssUrl('"retry recovers" when:30d');
    const articleUrl = 'https://example.com/rss-retry-recovers';
    fetchSpy
      .mockImplementationOnce(async () => new Response('unavailable', { status: 503 }))
      .mockImplementationOnce(
        async () => new Response(makeRssXml('Retry Recovers', articleUrl), { status: 200 })
      );

    const updateResult = jest.fn(() => Promise.resolve());
    const handler = createRequestGoogleRssJobHandler({ spreadsheetPath, doNotRepeatRequestsWithinHours: 0 });

    await handler(makeQueueContext({ updateResult }));

    const result = getLatestResult(updateResult);
    expect(result.endingReason).toBe('queries_exhausted');
    expect(result.queryResults[0]).toMatchObject({ status: 'success', saved_articles: 1, note: null });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    await expect(NewsApiRequest.count({ where: { url: requestUrl } })).resolves.toBe(1);
    await expect(countArticlesByUrls([articleUrl])).resolves.toBe(1);
  });

  it('gives each row its own HTTP 503 retry', async () => {
    spreadsheetPath = await createTestSpreadsheet(tempDir, [
      [101, 'first retry row', '', '', '', '30d'],
      [102, 'second retry row', '', '', '', '30d']
    ]);
    const articleUrls = ['https://example.com/rss-retry-row-1', 'https://example.com/rss-retry-row-2'];
    fetchSpy
      .mockImplementationOnce(async () => new Response('unavailable', { status: 503 }))
      .mockImplementationOnce(
        async () => new Response(makeRssXml('Retry Row 1', articleUrls[0]), { status: 200 })
      )
      .mockImplementationOnce(async () => new Response('unavailable', { status: 503 }))
      .mockImplementationOnce(
        async () => new Response(makeRssXml('Retry Row 2', articleUrls[1]), { status: 200 })
      );

    const updateResult = jest.fn(() => Promise.resolve());
    const handler = createRequestGoogleRssJobHandler({ spreadsheetPath, doNotRepeatRequestsWithinHours: 0 });

    await handler(makeQueueContext({ updateResult }));

    const result = getLatestResult(updateResult);
    expect(result.endingReason).toBe('queries_exhausted');
    expect(result.queryResults[0]).toMatchObject({ status: 'success', saved_articles: 1 });
    expect(result.queryResults[1]).toMatchObject({ status: 'success', saved_articles: 1 });
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    await expectArticlesExist(articleUrls);
  });

  it('handles a non-503 retry failure as an RSS fetch error without logging recovery', async () => {
    spreadsheetPath = await createTestSpreadsheet(tempDir, [
      [103, 'retry fails differently', '', '', '', '30d'],
      [104, 'after retry failure', '', '', '', '30d']
    ]);
    const articleUrl = 'https://example.com/rss-after-retry-failure';
    fetchSpy
      .mockImplementationOnce(async () => new Response('unavailable', { status: 503 }))
      .mockImplementationOnce(async () => new Response('server error', { status: 500 }))
      .mockImplementationOnce(
        async () => new Response(makeRssXml('After Retry Failure', articleUrl), { status: 200 })
      );
    const infoSpy = jest.spyOn(logger, 'info');

    const updateResult = jest.fn(() => Promise.resolve());
    const handler = createRequestGoogleRssJobHandler({ spreadsheetPath, doNotRepeatRequestsWithinHours: 0 });

    await handler(makeQueueContext({ updateResult }));

    const result = getLatestResult(updateResult);
    expect(result.endingReason).toBe('queries_exhausted');
    expect(result.queryResults[0]).toMatchObject({
      status: 'failed',
      saved_articles: 0,
      note: 'rss_fetch_error: RSS request failed with status 500'
    });
    expect(result.queryResults[1]).toMatchObject({ status: 'success', saved_articles: 1 });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(infoSpy).not.toHaveBeenCalledWith(
      'RSS request recovered after HTTP 503 retry',
      expect.anything()
    );
  });

  it('stops without another fetch when canceled during the HTTP 503 retry wait', async () => {
    process.env.MINUTES_IN_BETWEEN_REQUESTS_RETRY = '0.01';
    spreadsheetPath = await createTestSpreadsheet(tempDir, [
      [105, 'cancel retry wait', '', '', '', '30d'],
      [106, 'after canceled retry', '', '', '', '30d']
    ]);
    fetchSpy.mockImplementation(async () => new Response('unavailable', { status: 503 }));
    const controller = new AbortController();
    const updateResult = jest.fn(() => Promise.resolve());
    const handler = createRequestGoogleRssJobHandler({ spreadsheetPath, doNotRepeatRequestsWithinHours: 0 });
    const abortTimer = setTimeout(() => controller.abort(), 100);

    await handler(makeQueueContext({ signal: controller.signal, updateResult }));
    clearTimeout(abortTimer);

    const result = getLatestResult(updateResult);
    expect(result.endingReason).toBe('canceled');
    expect(result.queryResults[0]).toMatchObject({ status: 'skipped', saved_articles: 0, note: 'canceled' });
    expect(result.queryResults[1]).toMatchObject({ status: 'skipped', note: 'not_reached' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  const make503Response = (body: BodyInit | null, headers?: HeadersInit): Response =>
    new Response(body, { status: 503, statusText: 'Service Unavailable', headers });

  const runSingle503Row = async (rowId: number, makeResponse: () => Response): Promise<jest.SpyInstance> => {
    spreadsheetPath = await createTestSpreadsheet(tempDir, [[rowId, `diagnostic row ${rowId}`, '', '', '', '30d']]);
    fetchSpy.mockImplementation(async () => makeResponse());
    const errorSpy = jest.spyOn(logger, 'error');
    const handler = createRequestGoogleRssJobHandler({ spreadsheetPath, doNotRepeatRequestsWithinHours: 0 });

    await handler(makeQueueContext({ jobId: `job-${rowId}` }));
    return errorSpy;
  };

  const findLogMeta = (
    spy: jest.SpyInstance,
    message: string,
    attempt: number
  ): Record<string, unknown> | undefined =>
    spy.mock.calls.find(
      ([loggedMessage, meta]) => loggedMessage === message && (meta as Record<string, unknown>)?.attempt === attempt
    )?.[1] as Record<string, unknown> | undefined;

  it('logs a header summary before the full 503 response on each attempt', async () => {
    const errorSpy = await runSingle503Row(200, () => {
      const headers = new Headers({ 'Retry-After': '3600', 'X-Goog-Trace': 'abc' });
      headers.append('Set-Cookie', 'NID=one; Path=/');
      headers.append('Set-Cookie', 'GOOGLE_ABUSE_EXEMPTION=two; Path=/');
      return make503Response('<html>blocked</html>', headers);
    });

    for (const attempt of [1, 2]) {
      const summaryIndex = errorSpy.mock.calls.findIndex(
        ([message, meta]) => message === 'RSS 503 header summary' && meta?.attempt === attempt
      );
      const fullIndex = errorSpy.mock.calls.findIndex(
        ([message, meta]) => message === 'RSS 503 full response' && meta?.attempt === attempt
      );
      expect(summaryIndex).toBeGreaterThanOrEqual(0);
      expect(fullIndex).toBeGreaterThan(summaryIndex);

      const summary = errorSpy.mock.calls[summaryIndex][1];
      const full = errorSpy.mock.calls[fullIndex][1];
      expect(summary).toMatchObject({ queryId: 200, jobId: 'job-200', status: 503 });
      expect(full).toMatchObject({ queryId: 200, jobId: 'job-200', capturedAt: summary.capturedAt });
      expect(summary.headerSummary).toMatchObject({
        'retry-after': '3600',
        setCookieNames: ['NID', 'GOOGLE_ABUSE_EXEMPTION'],
        googlePrefixedHeaders: { 'x-goog-trace': 'abc' }
      });
      expect(full.responseHeaders['set-cookie']).toEqual([
        'NID=one; Path=/',
        'GOOGLE_ABUSE_EXEMPTION=two; Path=/'
      ]);
      expect(full).toMatchObject({ body: '<html>blocked</html>', bodyTruncated: false });
    }
    expect(findLogMeta(errorSpy, 'RSS 503 header summary', 1)?.outcome).toBe('retry_scheduled_in_0.001_minutes');
    expect(findLogMeta(errorSpy, 'RSS 503 header summary', 2)?.outcome).toBe('retry_exhausted');
  });

  it('keeps a 503 body of exactly 1 MB without truncation', async () => {
    const errorSpy = await runSingle503Row(201, () => make503Response('a'.repeat(1_048_576)));

    const full = findLogMeta(errorSpy, 'RSS 503 full response', 1);
    expect(full).toMatchObject({ bodyByteLength: 1_048_576, bodyTruncated: false });
    expect((full?.body as string).length).toBe(1_048_576);
  });

  it('truncates a 503 body larger than 1 MB', async () => {
    const errorSpy = await runSingle503Row(202, () => make503Response('b'.repeat(1_048_577)));

    const full = findLogMeta(errorSpy, 'RSS 503 full response', 1);
    expect(full).toMatchObject({ bodyByteLength: 1_048_576, bodyTruncated: true });
    expect((full?.body as string).length).toBe(1_048_576);
  });

  it('keeps status, headers, and the partial body when the 503 body read fails', async () => {
    const errorSpy = await runSingle503Row(203, () => {
      let sentChunk = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!sentChunk) {
            sentChunk = true;
            controller.enqueue(new TextEncoder().encode('partial'));
            return;
          }
          controller.error(new Error('stream broke'));
        }
      });
      return make503Response(body, { 'Retry-After': '60' });
    });

    const summary = findLogMeta(errorSpy, 'RSS 503 header summary', 1);
    const full = findLogMeta(errorSpy, 'RSS 503 full response', 1);
    expect(summary?.headerSummary).toMatchObject({ 'retry-after': '60' });
    expect(full).toMatchObject({
      status: 503,
      body: 'partial',
      bodyTruncated: false,
      bodyReadError: 'stream broke'
    });
    expect(full?.responseHeaders).toMatchObject({ 'retry-after': '60' });
  });

  it('logs the final URL and redirect flag of a 503', async () => {
    const errorSpy = await runSingle503Row(204, () => {
      const response = make503Response('sorry');
      Object.defineProperty(response, 'url', { value: 'https://www.google.com/sorry/index' });
      Object.defineProperty(response, 'redirected', { value: true });
      return response;
    });

    const full = findLogMeta(errorSpy, 'RSS 503 full response', 1);
    expect(full).toMatchObject({
      requestUrl: makeGoogleRssUrl('"diagnostic row 204" when:30d'),
      finalUrl: 'https://www.google.com/sorry/index',
      redirected: true
    });
  });

  it('logs recovery status and headers without a body', async () => {
    spreadsheetPath = await createTestSpreadsheet(tempDir, [[205, 'diagnostic recovery', '', '', '', '30d']]);
    fetchSpy
      .mockImplementationOnce(async () => make503Response('unavailable'))
      .mockImplementationOnce(
        async () =>
          new Response(makeRssXml('Diagnostic Recovery', 'https://example.com/rss-diagnostic-recovery'), {
            status: 200,
            headers: { 'X-Test': 'recovered' }
          })
      );
    const infoSpy: jest.SpyInstance = jest.spyOn(logger, 'info');
    const handler = createRequestGoogleRssJobHandler({ spreadsheetPath, doNotRepeatRequestsWithinHours: 0 });

    await handler(makeQueueContext());

    const recovery = infoSpy.mock.calls.find(
      ([message]) => message === 'RSS request recovered after HTTP 503 retry'
    )?.[1] as Record<string, unknown> | undefined;
    expect(recovery).toMatchObject({ attempt: 2, status: 200 });
    expect(recovery?.responseHeaders).toMatchObject({ 'x-test': 'recovered' });
    expect(recovery?.headerSummary).toBeDefined();
    expect(recovery).not.toHaveProperty('body');
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

describe('buildRssHeaderSummary', () => {
  it('returns present header values and null for absent ones', () => {
    const summary = buildRssHeaderSummary(new Headers({ 'retry-after': '120', server: 'GSE' }));

    expect(summary['retry-after']).toBe('120');
    expect(summary.server).toBe('GSE');
    expect(summary['x-ratelimit-remaining']).toBeNull();
    expect(summary.location).toBeNull();
  });

  it('finds mixed-case header names', () => {
    const summary = buildRssHeaderSummary(new Headers({ 'RateLimit-Remaining': '0', 'Content-Type': 'text/html' }));

    expect(summary['ratelimit-remaining']).toBe('0');
    expect(summary['content-type']).toBe('text/html');
  });

  it('lists one name per Set-Cookie header', () => {
    const headers = new Headers();
    headers.append('Set-Cookie', 'NID=one; Path=/');
    headers.append('Set-Cookie', 'AEC=two; Secure');

    expect(buildRssHeaderSummary(headers).setCookieNames).toEqual(['NID', 'AEC']);
    expect(buildRssHeaderSummary(new Headers()).setCookieNames).toEqual([]);
  });

  it('collects x-goog and x-google headers only', () => {
    const summary = buildRssHeaderSummary(
      new Headers({ 'X-Goog-Request': 'a', 'x-google-backends': 'b', 'x-other': 'c' })
    );

    expect(summary.googlePrefixedHeaders).toEqual({ 'x-goog-request': 'a', 'x-google-backends': 'b' });
  });
});
