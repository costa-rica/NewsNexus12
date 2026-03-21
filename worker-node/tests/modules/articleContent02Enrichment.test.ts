import { enrichArticleContent02 } from '../../src/modules/article-content-02/enrichment';

describe('article content 02 enrichment', () => {
  const createSession = () => ({
    context: {
      newPage: jest.fn()
    },
    close: jest.fn().mockResolvedValue(undefined)
  });

  it('skips articles that already have any canonical row', async () => {
    const session = createSession();

    const summary = await enrichArticleContent02(
      {
        articles: [
          {
            id: 1,
            title: 'Story',
            description: 'desc',
            url: 'https://news.google.com/rss/articles/skip',
            publishedDate: '2026-03-21'
          }
        ],
        signal: new AbortController().signal
      },
      {
        createNavigationSession: jest.fn().mockResolvedValue(session),
        getSkipDecision: jest.fn().mockResolvedValue({
          shouldSkip: true,
          reason: 'already have canonical row',
          existingRow: { id: 11 }
        }),
        persistResult: jest.fn()
      }
    );

    expect(summary).toEqual({
      articlesConsidered: 1,
      articlesSkipped: 1,
      successfulScrapes: 0,
      failedScrapes: 0,
      createdRows: 0,
      updatedRows: 0
    });
    expect(session.close).toHaveBeenCalled();
  });

  it('persists a successful Google-to-publisher scrape result', async () => {
    const session = createSession();
    const persistResult = jest.fn().mockResolvedValue({
      persisted: true,
      action: 'created',
      reason: 'created',
      row: { id: 20 }
    });

    const summary = await enrichArticleContent02(
      {
        articles: [
          {
            id: 2,
            title: 'Story',
            description: 'desc',
            url: 'https://news.google.com/rss/articles/success',
            publishedDate: '2026-03-21'
          }
        ],
        signal: new AbortController().signal
      },
      {
        createNavigationSession: jest.fn().mockResolvedValue(session),
        getSkipDecision: jest.fn().mockResolvedValue({
          shouldSkip: false,
          reason: 'process',
          existingRow: null
        }),
        navigateGoogleUrl: jest.fn().mockResolvedValue({
          finalUrl: 'https://publisher.example/story',
          statusCode: 200,
          html: '<html><head><link rel="canonical" href="https://publisher.example/story" /></head></html>'
        }),
        classifyGooglePage: jest.fn().mockReturnValue({
          isBlocked: false,
          failureType: null,
          details: 'No blocked-page patterns detected'
        }),
        extractPublisherUrlFromFinalUrl: jest.fn().mockReturnValue({
          publisherUrl: 'https://publisher.example/story',
          extractionSource: 'final-url',
          failureType: null,
          details: 'Publisher URL extracted from final browser URL'
        }),
        extractPublisherUrl: jest.fn().mockReturnValue({
          publisherUrl: null,
          extractionSource: 'none',
          failureType: 'no_publisher_url_found',
          details: 'unused'
        }),
        fetchPublisherPage: jest.fn().mockResolvedValue({
          title: 'Publisher headline',
          content: 'x'.repeat(220),
          finalUrl: 'https://publisher.example/story',
          statusCode: 200,
          bodySource: 'direct-http',
          details: 'Direct HTTP returned usable publisher HTML',
          failureType: null
        }),
        persistResult
      }
    );

    expect(summary).toEqual({
      articlesConsidered: 1,
      articlesSkipped: 0,
      successfulScrapes: 1,
      failedScrapes: 0,
      createdRows: 1,
      updatedRows: 0
    });
    expect(persistResult).toHaveBeenCalledWith({
      articleId: 2,
      googleRssUrl: 'https://news.google.com/rss/articles/success',
      googleFinalUrl: 'https://publisher.example/story',
      publisherUrl: 'https://publisher.example/story',
      publisherFinalUrl: 'https://publisher.example/story',
      title: 'Publisher headline',
      content: 'x'.repeat(220),
      status: 'success',
      failureType: null,
      details: 'Direct HTTP returned usable publisher HTML',
      extractionSource: 'final-url',
      bodySource: 'direct-http',
      googleStatusCode: 200,
      publisherStatusCode: 200
    });
  });

  it('persists blocked Google outcomes as failed workflow results', async () => {
    const session = createSession();
    const persistResult = jest.fn().mockResolvedValue({
      persisted: true,
      action: 'created',
      reason: 'created',
      row: { id: 21 }
    });

    const summary = await enrichArticleContent02(
      {
        articles: [
          {
            id: 3,
            title: 'Story',
            description: 'desc',
            url: 'https://news.google.com/rss/articles/blocked-google',
            publishedDate: '2026-03-21'
          }
        ],
        signal: new AbortController().signal
      },
      {
        createNavigationSession: jest.fn().mockResolvedValue(session),
        getSkipDecision: jest.fn().mockResolvedValue({
          shouldSkip: false,
          reason: 'process',
          existingRow: null
        }),
        navigateGoogleUrl: jest.fn().mockResolvedValue({
          finalUrl: 'https://consent.google.com/page',
          statusCode: 200,
          html: '<html>blocked</html>'
        }),
        classifyGooglePage: jest.fn().mockReturnValue({
          isBlocked: true,
          failureType: 'blocked_google',
          details: 'Matched blocked pattern: consent.google.com'
        }),
        persistResult
      }
    );

    expect(summary.failedScrapes).toBe(1);
    expect(persistResult).toHaveBeenCalledWith(
      expect.objectContaining({
        articleId: 3,
        status: 'fail',
        failureType: 'blocked_google',
        bodySource: 'google-page'
      })
    );
  });

  it('persists no-publisher-url outcomes when extraction fails', async () => {
    const session = createSession();
    const persistResult = jest.fn().mockResolvedValue({
      persisted: true,
      action: 'updated',
      reason: 'updated',
      row: { id: 22 }
    });

    const summary = await enrichArticleContent02(
      {
        articles: [
          {
            id: 4,
            title: 'Story',
            description: 'desc',
            url: 'https://news.google.com/rss/articles/no-publisher',
            publishedDate: '2026-03-21'
          }
        ],
        signal: new AbortController().signal
      },
      {
        createNavigationSession: jest.fn().mockResolvedValue(session),
        getSkipDecision: jest.fn().mockResolvedValue({
          shouldSkip: false,
          reason: 'process',
          existingRow: null
        }),
        navigateGoogleUrl: jest.fn().mockResolvedValue({
          finalUrl: 'https://news.google.com/articles/no-publisher',
          statusCode: 200,
          html: '<html><body>no metadata</body></html>'
        }),
        classifyGooglePage: jest.fn().mockReturnValue({
          isBlocked: false,
          failureType: null,
          details: 'No blocked-page patterns detected'
        }),
        extractPublisherUrlFromFinalUrl: jest.fn().mockReturnValue({
          publisherUrl: null,
          extractionSource: 'none',
          failureType: 'no_publisher_url_found',
          details: 'Final browser URL was missing or remained Google-owned'
        }),
        extractPublisherUrl: jest.fn().mockReturnValue({
          publisherUrl: null,
          extractionSource: 'none',
          failureType: 'no_publisher_url_found',
          details: 'No non-Google publisher URL found in Google page metadata'
        }),
        persistResult
      }
    );

    expect(summary).toEqual({
      articlesConsidered: 1,
      articlesSkipped: 0,
      successfulScrapes: 0,
      failedScrapes: 1,
      createdRows: 0,
      updatedRows: 1
    });
  });

  it('persists blocked publisher outcomes from the fetch step', async () => {
    const session = createSession();
    const persistResult = jest.fn().mockResolvedValue({
      persisted: true,
      action: 'created',
      reason: 'created',
      row: { id: 23 }
    });

    const summary = await enrichArticleContent02(
      {
        articles: [
          {
            id: 5,
            title: 'Story',
            description: 'desc',
            url: 'https://news.google.com/rss/articles/blocked-publisher',
            publishedDate: '2026-03-21'
          }
        ],
        signal: new AbortController().signal
      },
      {
        createNavigationSession: jest.fn().mockResolvedValue(session),
        getSkipDecision: jest.fn().mockResolvedValue({
          shouldSkip: false,
          reason: 'process',
          existingRow: null
        }),
        navigateGoogleUrl: jest.fn().mockResolvedValue({
          finalUrl: 'https://publisher.example/story',
          statusCode: 200,
          html: '<html></html>'
        }),
        classifyGooglePage: jest.fn().mockReturnValue({
          isBlocked: false,
          failureType: null,
          details: 'No blocked-page patterns detected'
        }),
        extractPublisherUrlFromFinalUrl: jest.fn().mockReturnValue({
          publisherUrl: 'https://publisher.example/story',
          extractionSource: 'final-url',
          failureType: null,
          details: 'Publisher URL extracted from final browser URL'
        }),
        extractPublisherUrl: jest.fn().mockReturnValue({
          publisherUrl: null,
          extractionSource: 'none',
          failureType: 'no_publisher_url_found',
          details: 'unused'
        }),
        fetchPublisherPage: jest.fn().mockResolvedValue({
          title: null,
          content: null,
          finalUrl: 'https://publisher.example/story',
          statusCode: 403,
          bodySource: 'direct-http',
          details: 'Matched blocked publisher pattern: access to this page has been denied',
          failureType: 'blocked_publisher'
        }),
        persistResult
      }
    );

    expect(summary.failedScrapes).toBe(1);
    expect(persistResult).toHaveBeenCalledWith(
      expect.objectContaining({
        articleId: 5,
        status: 'fail',
        failureType: 'blocked_publisher',
        bodySource: 'direct-http'
      })
    );
  });
});
