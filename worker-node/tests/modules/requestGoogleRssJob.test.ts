import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createRequestGoogleRssJobHandler,
  createRssSeedResult,
  DEFAULT_REQUEST_GOOGLE_RSS_REPEAT_WINDOW_HOURS,
  mapRssItems
} from '../../src/modules/jobs/requestGoogleRssJob';

describe('requestGoogleRss job handler', () => {
  it('fails when spreadsheet file is missing', async () => {
    const handler = createRequestGoogleRssJobHandler({
      spreadsheetPath: '/path/that/does/not/exist.xlsx',
      doNotRepeatRequestsWithinHours: DEFAULT_REQUEST_GOOGLE_RSS_REPEAT_WINDOW_HOURS
    });

    await expect(
      handler({
        jobId: 'job-1',
        endpointName: '/request-google-rss/start-job',
        signal: new AbortController().signal,
        registerCancelableProcess: () => undefined,
        updateResult: () => Promise.resolve()
      })
    ).rejects.toThrow('Spreadsheet file not found');
  });

  it('passes spreadsheet path to legacy workflow dependency', async () => {
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

    await handler({
      jobId: 'job-2',
      endpointName: '/request-google-rss/start-job',
      signal: new AbortController().signal,
      registerCancelableProcess: () => undefined,
        updateResult: () => Promise.resolve()
    });

    expect(runLegacyWorkflow).toHaveBeenCalledWith({
      jobId: 'job-2',
      spreadsheetPath,
      doNotRepeatRequestsWithinHours: 24,
      signal: expect.any(Object)
    });

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
