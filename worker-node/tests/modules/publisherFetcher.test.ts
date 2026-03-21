import { fetchPublisherPage } from '../../src/modules/article-content-02/publisherFetcher';

describe('publisher fetcher', () => {
  it('returns direct HTTP publisher content when the HTML is usable', async () => {
    const result = await fetchPublisherPage(
      {
        publisherUrl: 'https://publisher.example/direct',
        browserContext: {
          newPage: jest.fn()
        } as never
      },
      {
        fetchImpl: jest.fn().mockResolvedValue({
          status: 200,
          url: 'https://publisher.example/direct',
          text: async () => `
            <html>
              <head><meta property="og:title" content="Direct headline" /></head>
              <body>
                <article>
                  <p>${'A'.repeat(120)}</p>
                  <p>${'B'.repeat(120)}</p>
                  <p>${'E'.repeat(220)}</p>
                </article>
              </body>
            </html>
          `
        }) as never
      }
    );

    expect(result).toMatchObject({
      title: 'Direct headline',
      bodySource: 'direct-http',
      details: 'Direct HTTP returned usable publisher HTML',
      failureType: null
    });
    expect(result.content).toContain('AAA');
  });

  it('falls back to Playwright when direct HTTP looks incomplete', async () => {
    const page = {
      goto: jest.fn().mockResolvedValue({
        status: () => 200
      }),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      content: jest.fn().mockResolvedValue(`
        <html>
          <head><meta property="og:title" content="Fallback headline" /></head>
          <body>
            <article>
              <p>${'C'.repeat(120)}</p>
              <p>${'D'.repeat(120)}</p>
              <p>${'F'.repeat(220)}</p>
            </article>
          </body>
        </html>
      `),
      url: jest.fn().mockReturnValue('https://publisher.example/fallback'),
      close: jest.fn().mockResolvedValue(undefined)
    };

    const result = await fetchPublisherPage(
      {
        publisherUrl: 'https://publisher.example/fallback',
        browserContext: {
          newPage: jest.fn().mockResolvedValue(page)
        } as never
      },
      {
        fetchImpl: jest.fn().mockResolvedValue({
          status: 200,
          url: 'https://publisher.example/fallback',
          text: async () => '<html><body>Please enable JavaScript</body></html>'
        }) as never
      }
    );

    expect(result).toMatchObject({
      title: 'Fallback headline',
      bodySource: 'playwright-publisher',
      details: 'Playwright fallback returned publisher HTML',
      failureType: null
    });
    expect(page.goto).toHaveBeenCalled();
  });

  it('returns blocked publisher details when direct HTTP hits an anti-bot page', async () => {
    const result = await fetchPublisherPage(
      {
        publisherUrl: 'https://publisher.example/blocked',
        browserContext: {
          newPage: jest.fn()
        } as never
      },
      {
        fetchImpl: jest.fn().mockResolvedValue({
          status: 403,
          url: 'https://publisher.example/blocked',
          text: async () => `
            <html>
              <body>
                Access to this page has been denied.
                Before we continue...
                Reference ID: 999
              </body>
            </html>
          `
        }) as never
      }
    );

    expect(result).toMatchObject({
      bodySource: 'direct-http',
      failureType: 'blocked_publisher'
    });
    expect(result.details).toContain('Matched blocked publisher pattern');
  });

  it('returns publisher_fetch_error after exhausting retries on thrown errors', async () => {
    const result = await fetchPublisherPage(
      {
        publisherUrl: 'https://publisher.example/error',
        browserContext: {
          newPage: jest.fn()
        } as never
      },
      {
        fetchImpl: jest.fn().mockRejectedValue(new Error('socket hang up')) as never
      }
    );

    expect(result).toEqual({
      title: null,
      content: null,
      finalUrl: 'https://publisher.example/error',
      statusCode: null,
      bodySource: 'none',
      details: 'socket hang up',
      failureType: 'publisher_fetch_error'
    });
  });
});
