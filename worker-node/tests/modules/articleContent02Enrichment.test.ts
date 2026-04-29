import {
  enrichArticleContent02,
  processArticleContent02Candidate
} from '../../src/modules/article-content-02/enrichment';

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

  it('recycles Chromium after the configured article attempt count', async () => {
    const sessions = [createSession(), createSession()];
    const createNavigationSession = jest
      .fn()
      .mockResolvedValueOnce(sessions[0])
      .mockResolvedValueOnce(sessions[1]);
    const articles = Array.from({ length: 26 }, (_, index) => ({
      id: index + 100,
      title: `Story ${index + 1}`,
      description: 'desc',
      url: `https://news.google.com/rss/articles/attempt-${index + 1}`,
      publishedDate: '2026-03-21'
    }));

    const summary = await enrichArticleContent02(
      {
        articles,
        signal: new AbortController().signal
      },
      {
        createNavigationSession,
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
        persistResult: jest.fn().mockResolvedValue({
          persisted: true,
          action: 'updated',
          reason: 'updated',
          row: { id: 22 }
        })
      }
    );

    expect(summary.failedScrapes).toBe(26);
    expect(createNavigationSession).toHaveBeenCalledTimes(2);
    expect(sessions[0].close).toHaveBeenCalledTimes(1);
    expect(sessions[1].close).toHaveBeenCalledTimes(1);
  });

  it('recycles Chromium after consecutive navigation errors', async () => {
    const sessions = [createSession(), createSession()];
    const createNavigationSession = jest
      .fn()
      .mockResolvedValueOnce(sessions[0])
      .mockResolvedValueOnce(sessions[1]);
    const articles = Array.from({ length: 4 }, (_, index) => ({
      id: index + 200,
      title: `Story ${index + 1}`,
      description: 'desc',
      url: `https://news.google.com/rss/articles/nav-error-${index + 1}`,
      publishedDate: '2026-03-21'
    }));

    const summary = await enrichArticleContent02(
      {
        articles,
        signal: new AbortController().signal
      },
      {
        createNavigationSession,
        getSkipDecision: jest.fn().mockResolvedValue({
          shouldSkip: false,
          reason: 'process',
          existingRow: null
        }),
        navigateGoogleUrl: jest.fn().mockRejectedValue(new Error('navigation failed')),
        persistResult: jest.fn().mockResolvedValue({
          persisted: true,
          action: 'updated',
          reason: 'updated',
          row: { id: 22 }
        })
      }
    );

    expect(summary.failedScrapes).toBe(4);
    expect(createNavigationSession).toHaveBeenCalledTimes(2);
    expect(sessions[0].close).toHaveBeenCalledTimes(1);
    expect(sessions[1].close).toHaveBeenCalledTimes(1);
  });

  it('persists a failed result when the full article workflow times out', async () => {
    jest.useFakeTimers();

    try {
      const persistResult = jest.fn().mockResolvedValue({
        persisted: true,
        action: 'created',
        reason: 'created',
        row: { id: 30 }
      });
      const navigationState: { signal?: AbortSignal } = {};

      const resultPromise = processArticleContent02Candidate(
        {
          article: {
            id: 30,
            title: 'Slow story',
            description: 'desc',
            url: 'https://news.google.com/rss/articles/slow',
            publishedDate: '2026-03-21'
          },
          signal: new AbortController().signal,
          navigationSession: createSession() as never,
          bypassExistingRowSkip: true
        },
        {
          navigateGoogleUrl: jest.fn((_context, _url, signal) => {
            navigationState.signal = signal;
            return new Promise<never>(() => undefined);
          }) as never,
          persistResult
        }
      );

      await jest.advanceTimersByTimeAsync(90_000);
      const result = await resultPromise;

      expect(navigationState.signal?.aborted).toBe(true);
      expect(result.workflowResult).toMatchObject({
        articleId: 30,
        status: 'fail',
        failureType: 'navigation_error',
        details: 'Article content 02 scrape timed out after 90000ms'
      });
      expect(persistResult).toHaveBeenCalledWith(
        expect.objectContaining({
          articleId: 30,
          status: 'fail',
          failureType: 'navigation_error',
          details: 'Article content 02 scrape timed out after 90000ms'
        })
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
