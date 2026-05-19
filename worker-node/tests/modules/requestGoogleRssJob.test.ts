import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createRequestGoogleRssJobHandler,
  createRssSeedResult,
  DEFAULT_REQUEST_GOOGLE_RSS_REPEAT_WINDOW_HOURS,
  GoogleRssJobResult,
  mapRssItems
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
  `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Google News</title>
    <item>
      <title>${title}</title>
      <link>${link}</link>
      <pubDate>Wed, 29 Apr 2026 12:00:00 GMT</pubDate>
      <source>Example News</source>
      <content:encoded><![CDATA[${content}]]></content:encoded>
    </item>
  </channel>
</rss>`;

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

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rss-terminal-'));
    spreadsheetPath = await createTestSpreadsheet(tempDir);
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(async () => {
    fetchSpy.mockRestore();
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

  it('includes one seeded query result for every spreadsheet row', async () => {
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
            status: 'skipped',
            saved_articles: 0,
            note: 'not_reached'
          },
          {
            id: 2,
            and_keywords: 'recall',
            and_exact_phrases: '"product safety"',
            or_keywords: 'warning',
            or_exact_phrases: '',
            time_range: '90d',
            status: 'skipped',
            saved_articles: 0,
            note: 'not_reached'
          }
        ]
      })
    );
  });
});
