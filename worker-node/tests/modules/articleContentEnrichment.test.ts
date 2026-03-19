const mockArticleContent = {
  create: jest.fn(),
  findAll: jest.fn()
};

jest.mock('@newsnexus/db-models', () => ({
  ArticleContent: mockArticleContent
}));

import { enrichArticleContent } from '../../src/modules/article-content/enrichment';

describe('article content enrichment service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a new ArticleContents row after a successful scrape when none exists', async () => {
    mockArticleContent.findAll.mockResolvedValue([]);

    const summary = await enrichArticleContent(
      {
        articles: [
          {
            id: 10,
            title: 'Article 10',
            description: 'desc',
            url: 'https://example.com/10',
            publishedDate: '2026-03-16'
          }
        ],
        signal: new AbortController().signal
      },
      {
        scrapeArticleContent: jest.fn().mockResolvedValue({
          success: true,
          method: 'cheerio',
          content: 'A'.repeat(220),
          contentLength: 220,
          scrapeStatusCheerio: true,
          scrapeStatusPuppeteer: null
        })
      }
    );

    expect(mockArticleContent.create).toHaveBeenCalledWith({
      articleId: 10,
      content: 'A'.repeat(220),
      scrapeStatusCheerio: true,
      scrapeStatusPuppeteer: null
    });
    expect(summary).toEqual({
      articlesConsidered: 1,
      articlesSkipped: 0,
      successfulScrapes: 1,
      failedScrapes: 0,
      updatedRows: 0,
      createdRows: 1
    });
  });

  it('updates the selected existing row instead of creating a duplicate', async () => {
    const update = jest.fn();
    mockArticleContent.findAll.mockResolvedValue([
      {
        id: 20,
        articleId: 11,
        content: 'short',
        scrapeStatusCheerio: null,
        scrapeStatusPuppeteer: null,
        update
      }
    ]);

    const summary = await enrichArticleContent(
      {
        articles: [
          {
            id: 11,
            title: 'Article 11',
            description: 'desc',
            url: 'https://example.com/11',
            publishedDate: '2026-03-16'
          }
        ],
        signal: new AbortController().signal
      },
      {
        scrapeArticleContent: jest.fn().mockResolvedValue({
          success: true,
          method: 'cheerio',
          content: 'B'.repeat(240),
          contentLength: 240,
          scrapeStatusCheerio: true,
          scrapeStatusPuppeteer: null
        })
      }
    );

    expect(update).toHaveBeenCalledWith({
      content: 'B'.repeat(240),
      scrapeStatusCheerio: true,
      scrapeStatusPuppeteer: null
    });
    expect(mockArticleContent.create).not.toHaveBeenCalled();
    expect(summary.updatedRows).toBe(1);
  });

  it('uses deterministic row selection when duplicate rows already exist', async () => {
    const firstUpdate = jest.fn();
    const secondUpdate = jest.fn();
    mockArticleContent.findAll.mockResolvedValue([
      {
        id: 5,
        articleId: 12,
        content: '',
        scrapeStatusCheerio: null,
        scrapeStatusPuppeteer: null,
        update: firstUpdate
      },
      {
        id: 8,
        articleId: 12,
        content: '',
        scrapeStatusCheerio: null,
        scrapeStatusPuppeteer: null,
        update: secondUpdate
      }
    ]);

    await enrichArticleContent(
      {
        articles: [
          {
            id: 12,
            title: 'Article 12',
            description: 'desc',
            url: 'https://example.com/12',
            publishedDate: '2026-03-16'
          }
        ],
        signal: new AbortController().signal
      },
      {
        scrapeArticleContent: jest.fn().mockResolvedValue({
          success: false,
          method: 'cheerio',
          failureType: 'network_error',
          error: 'timeout',
          scrapeStatusCheerio: false,
          scrapeStatusPuppeteer: null
        })
      }
    );

    expect(firstUpdate).toHaveBeenCalledWith({
      scrapeStatusCheerio: false,
      scrapeStatusPuppeteer: null
    });
    expect(secondUpdate).not.toHaveBeenCalled();
  });

  it('skips an article with no URL and counts it correctly', async () => {
    const summary = await enrichArticleContent(
      {
        articles: [
          {
            id: 13,
            title: 'Article 13',
            description: 'desc',
            url: null,
            publishedDate: '2026-03-16'
          }
        ],
        signal: new AbortController().signal
      },
      {
        scrapeArticleContent: jest.fn()
      }
    );

    expect(mockArticleContent.create).not.toHaveBeenCalled();
    expect(summary).toEqual({
      articlesConsidered: 1,
      articlesSkipped: 1,
      successfulScrapes: 0,
      failedScrapes: 0,
      updatedRows: 0,
      createdRows: 0
    });
  });

  it('marks scrapeStatusCheerio as failed and reports failure without false success', async () => {
    const update = jest.fn();
    mockArticleContent.findAll.mockResolvedValue([
      {
        id: 21,
        articleId: 14,
        content: '',
        scrapeStatusCheerio: null,
        scrapeStatusPuppeteer: null,
        update
      }
    ]);

    const summary = await enrichArticleContent(
      {
        articles: [
          {
            id: 14,
            title: 'Article 14',
            description: 'desc',
            url: 'https://example.com/14',
            publishedDate: '2026-03-16'
          }
        ],
        signal: new AbortController().signal
      },
      {
        scrapeArticleContent: jest.fn().mockResolvedValue({
          success: false,
          method: 'cheerio',
          failureType: 'http_error',
          error: 'HTTP 403 while fetching article',
          scrapeStatusCheerio: false,
          scrapeStatusPuppeteer: null
        })
      }
    );

    expect(update).toHaveBeenCalledWith({
      scrapeStatusCheerio: false,
      scrapeStatusPuppeteer: null
    });
    expect(summary).toEqual({
      articlesConsidered: 1,
      articlesSkipped: 0,
      successfulScrapes: 0,
      failedScrapes: 1,
      updatedRows: 1,
      createdRows: 0
    });
  });

  it('persists Puppeteer success after Cheerio falls back on short content', async () => {
    const update = jest.fn();
    mockArticleContent.findAll.mockResolvedValue([
      {
        id: 22,
        articleId: 15,
        content: 'short',
        scrapeStatusCheerio: null,
        scrapeStatusPuppeteer: null,
        update
      }
    ]);

    const summary = await enrichArticleContent(
      {
        articles: [
          {
            id: 15,
            title: 'Article 15',
            description: 'desc',
            url: 'https://example.com/15',
            publishedDate: '2026-03-16'
          }
        ],
        signal: new AbortController().signal
      },
      {
        scrapeArticleContent: jest.fn().mockResolvedValue({
          success: true,
          method: 'puppeteer',
          content: 'C'.repeat(260),
          contentLength: 260,
          scrapeStatusCheerio: false,
          scrapeStatusPuppeteer: true
        })
      }
    );

    expect(update).toHaveBeenCalledWith({
      content: 'C'.repeat(260),
      scrapeStatusCheerio: false,
      scrapeStatusPuppeteer: true
    });
    expect(summary.successfulScrapes).toBe(1);
  });
});
