import {
  scrapeArticleContent,
  scrapeArticleContentWithCheerio
} from '../../src/modules/article-content/scraper';

describe('article content Cheerio scraper', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns normalized content above the minimum threshold on success', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => `
        <html>
          <body>
            <article>
              <p>Paragraph one with enough text to matter and give us a real article body.</p>
              <p>Paragraph two adds more detail so the combined text easily passes the usable threshold.</p>
              <p>Paragraph three closes out the article with additional context and reporting detail.</p>
            </article>
          </body>
        </html>
      `
    }) as typeof fetch;

    const result = await scrapeArticleContentWithCheerio('https://example.com/story');

    expect(result.success).toBe(true);
    expect(result).toMatchObject({
      success: true,
      method: 'cheerio'
    });
    expect(result.success && result.content).toContain('Paragraph one');
    expect(result.success && result.contentLength).toBeGreaterThanOrEqual(200);
  });

  it('treats short content as a failed scrape', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><body><article><p>Too short.</p></article></body></html>'
    }) as typeof fetch;

    const result = await scrapeArticleContentWithCheerio('https://example.com/short-story');

    expect(result).toEqual({
      success: false,
      method: 'cheerio',
      failureType: 'short_content',
      error: 'Content too short (10 chars, minimum 200)',
      scrapeStatusCheerio: false,
      scrapeStatusPuppeteer: null
    });
  });

  it('treats network failures as scrape failures with stable error handling', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('socket hang up')) as typeof fetch;

    const result = await scrapeArticleContentWithCheerio('https://example.com/broken');

    expect(result).toEqual({
      success: false,
      method: 'cheerio',
      failureType: 'network_error',
      error: 'socket hang up',
      scrapeStatusCheerio: false,
      scrapeStatusPuppeteer: null
    });
  });

  it('falls back to Puppeteer when Cheerio returns short content', async () => {
    const result = await scrapeArticleContent('https://example.com/fallback', undefined, {
      scrapeWithCheerio: jest.fn().mockResolvedValue({
        success: false,
        method: 'cheerio',
        failureType: 'short_content',
        error: 'Content too short (75 chars, minimum 200)',
        scrapeStatusCheerio: false,
        scrapeStatusPuppeteer: null
      }),
      scrapeWithPuppeteer: jest.fn().mockResolvedValue({
        success: true,
        method: 'puppeteer',
        content: 'P'.repeat(260),
        contentLength: 260,
        scrapeStatusCheerio: false,
        scrapeStatusPuppeteer: true
      })
    });

    expect(result).toEqual({
      success: true,
      method: 'puppeteer',
      content: 'P'.repeat(260),
      contentLength: 260,
      scrapeStatusCheerio: false,
      scrapeStatusPuppeteer: true
    });
  });

  it('returns Puppeteer failure details when both scrape layers fail', async () => {
    const result = await scrapeArticleContent('https://example.com/double-fail', undefined, {
      scrapeWithCheerio: jest.fn().mockResolvedValue({
        success: false,
        method: 'cheerio',
        failureType: 'http_error',
        error: 'HTTP 403 while fetching article',
        scrapeStatusCheerio: false,
        scrapeStatusPuppeteer: null
      }),
      scrapeWithPuppeteer: jest.fn().mockResolvedValue({
        success: false,
        method: 'puppeteer',
        failureType: 'browser_error',
        error: 'Navigation timeout exceeded',
        scrapeStatusCheerio: false,
        scrapeStatusPuppeteer: false
      })
    });

    expect(result).toEqual({
      success: false,
      method: 'puppeteer',
      failureType: 'browser_error',
      error: 'Navigation timeout exceeded',
      scrapeStatusCheerio: false,
      scrapeStatusPuppeteer: false
    });
  });
});
