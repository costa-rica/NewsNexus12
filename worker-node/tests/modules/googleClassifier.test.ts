import { classifyGooglePage } from '../../src/modules/article-content-02/googleClassifier';

describe('google classifier', () => {
  it('flags consent pages as blocked Google responses', () => {
    const result = classifyGooglePage({
      finalUrl: 'https://consent.google.com/some/path',
      html: '<html><body>Before you continue to Google</body></html>'
    });

    expect(result).toEqual({
      isBlocked: true,
      failureType: 'blocked_google',
      details: 'Matched blocked pattern: consent.google.com'
    });
  });

  it('flags Google shell pages without usable publisher metadata', () => {
    const result = classifyGooglePage({
      finalUrl: 'https://news.google.com/articles/abc',
      html: '<html><body>Google News stories for you and more updates</body></html>'
    });

    expect(result).toEqual({
      isBlocked: true,
      failureType: 'blocked_google',
      details: 'Returned Google shell content without usable publisher metadata'
    });
  });

  it('allows pages that do not match blocked patterns', () => {
    const result = classifyGooglePage({
      finalUrl: 'https://news.google.com/articles/abc',
      html: '<html><head><meta property="og:url" content="https://publisher.example/story"></head></html>'
    });

    expect(result).toEqual({
      isBlocked: false,
      failureType: null,
      details: 'No blocked-page patterns detected'
    });
  });
});
