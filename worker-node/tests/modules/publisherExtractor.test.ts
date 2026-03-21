import {
  extractPublisherUrl,
  extractPublisherUrlFromFinalUrl
} from '../../src/modules/article-content-02/publisherExtractor';

describe('publisher extractor', () => {
  it('prefers a non-Google final browser URL', () => {
    const result = extractPublisherUrlFromFinalUrl('https://publisher.example/story');

    expect(result).toEqual({
      publisherUrl: 'https://publisher.example/story',
      extractionSource: 'final-url',
      failureType: null,
      details: 'Publisher URL extracted from final browser URL'
    });
  });

  it('rejects Google-owned final browser URLs', () => {
    const result = extractPublisherUrlFromFinalUrl('https://news.google.com/articles/abc');

    expect(result).toEqual({
      publisherUrl: null,
      extractionSource: 'none',
      failureType: 'no_publisher_url_found',
      details: 'Final browser URL was missing or remained Google-owned'
    });
  });

  it('extracts canonical publisher URLs from HTML metadata', () => {
    const result = extractPublisherUrl({
      html: `
        <html>
          <head>
            <link rel="canonical" href="https://publisher.example/canonical-story" />
          </head>
        </html>
      `,
      baseUrl: 'https://news.google.com/articles/abc'
    });

    expect(result).toEqual({
      publisherUrl: 'https://publisher.example/canonical-story',
      extractionSource: 'canonical',
      failureType: null,
      details: 'Publisher URL extracted from canonical'
    });
  });

  it('falls back to JSON-LD extraction when needed', () => {
    const result = extractPublisherUrl({
      html: `
        <html>
          <head>
            <script type="application/ld+json">
              {"@context":"https://schema.org","url":"https://publisher.example/jsonld-story"}
            </script>
          </head>
        </html>
      `,
      baseUrl: 'https://news.google.com/articles/abc'
    });

    expect(result).toEqual({
      publisherUrl: 'https://publisher.example/jsonld-story',
      extractionSource: 'json-ld',
      failureType: null,
      details: 'Publisher URL extracted from json-ld'
    });
  });

  it('uses non-Google fallback links when metadata is missing', () => {
    const result = extractPublisherUrl({
      html: `
        <html>
          <body>
            <a href="https://news.google.com/something">bad</a>
            <a href="https://publisher.example/fallback-story">good</a>
          </body>
        </html>
      `,
      baseUrl: 'https://news.google.com/articles/abc'
    });

    expect(result).toEqual({
      publisherUrl: 'https://publisher.example/fallback-story',
      extractionSource: 'fallback-link',
      failureType: null,
      details: 'Publisher URL extracted from fallback-link'
    });
  });

  it('returns a no-publisher result when every candidate stays Google-owned', () => {
    const result = extractPublisherUrl({
      html: `
        <html>
          <head>
            <link rel="canonical" href="https://news.google.com/articles/abc" />
          </head>
        </html>
      `,
      baseUrl: 'https://news.google.com/articles/abc'
    });

    expect(result).toEqual({
      publisherUrl: null,
      extractionSource: 'none',
      failureType: 'no_publisher_url_found',
      details: 'No non-Google publisher URL found in Google page metadata'
    });
  });
});
