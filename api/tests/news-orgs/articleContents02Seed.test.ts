const mockFindAll = jest.fn();
const mockCreate = jest.fn();

jest.mock('@newsnexus/db-models', () => ({
  ArticleContents02: {
    findAll: (...args: unknown[]) => mockFindAll(...args),
    create: (...args: unknown[]) => mockCreate(...args)
  }
}));

import { upsertArticleContents02Seed } from '../../src/modules/newsOrgs/articleContents02Seed';

describe('articleContents02Seed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('creates a success row for usable aggregator content', async () => {
    mockFindAll.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const result = await upsertArticleContents02Seed({
      articleId: 44,
      discoveryUrl: 'https://example.com/article',
      resolvedUrl: 'https://example.com/article',
      title: 'Example',
      content: 'A'.repeat(220),
      bodySource: 'aggregator-feed',
      extractionSource: 'final-url',
      successDetails: 'Seeded from aggregator content',
      shortDetails: 'Aggregator content too short'
    });

    expect(result).toBe('success');
    expect(mockCreate).toHaveBeenCalledWith({
      articleId: 44,
      url: 'https://example.com/article',
      googleRssUrl: 'https://example.com/article',
      googleFinalUrl: null,
      publisherFinalUrl: null,
      title: 'Example',
      content: 'A'.repeat(220),
      status: 'success',
      failureType: null,
      details: 'Seeded from aggregator content',
      extractionSource: 'final-url',
      bodySource: 'aggregator-feed',
      googleStatusCode: null,
      publisherStatusCode: null
    });
  });

  test('updates an existing non-success row when aggregator content is short', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    mockFindAll.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 5,
        status: 'fail',
        content: null,
        update
      }
    ]);

    const result = await upsertArticleContents02Seed({
      articleId: 55,
      discoveryUrl: 'https://example.com/article',
      resolvedUrl: 'https://example.com/article',
      title: 'Example',
      content: 'too short',
      bodySource: 'aggregator-feed',
      extractionSource: 'final-url',
      successDetails: 'Seeded from aggregator content',
      shortDetails: 'Aggregator content too short'
    });

    expect(result).toBe('needs-scrape');
    expect(update).toHaveBeenCalledWith({
      url: 'https://example.com/article',
      googleRssUrl: 'https://example.com/article',
      googleFinalUrl: null,
      publisherFinalUrl: null,
      title: 'Example',
      content: 'too short',
      status: 'fail',
      failureType: 'short_content',
      details: 'Aggregator content too short',
      extractionSource: 'final-url',
      bodySource: 'aggregator-feed',
      googleStatusCode: null,
      publisherStatusCode: null
    });
  });

  test('does not create a row when feed content is missing', async () => {
    mockFindAll.mockResolvedValueOnce([]);

    const result = await upsertArticleContents02Seed({
      articleId: 66,
      discoveryUrl: 'https://example.com/article',
      title: 'Example',
      content: null,
      bodySource: 'rss-feed',
      successDetails: 'Seeded from Google RSS item content',
      shortDetails: 'RSS item content too short'
    });

    expect(result).toBe('needs-scrape');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('does not touch an existing row when feed content is missing', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    mockFindAll.mockResolvedValueOnce([
      {
        id: 7,
        status: 'fail',
        content: null,
        update
      }
    ]);

    const result = await upsertArticleContents02Seed({
      articleId: 77,
      discoveryUrl: 'https://example.com/article',
      title: 'Example',
      content: '   ',
      bodySource: 'rss-feed',
      successDetails: 'Seeded from Google RSS item content',
      shortDetails: 'RSS item content too short'
    });

    expect(result).toBe('needs-scrape');
    expect(update).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
