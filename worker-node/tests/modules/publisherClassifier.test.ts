import { classifyPublisherPage } from '../../src/modules/article-content-02/publisherClassifier';

describe('publisher classifier', () => {
  it('flags blocked publisher pages based on strong challenge content', () => {
    const result = classifyPublisherPage({
      finalUrl: 'https://publisher.example/story',
      html: `
        <html>
          <body>
            Access to this page has been denied.
            Before we continue...
            Reference ID: 123
          </body>
        </html>
      `
    });

    expect(result).toEqual({
      isBlocked: true,
      failureType: 'blocked_publisher',
      details: 'Matched blocked publisher pattern: access to this page has been denied'
    });
  });

  it('allows usable publisher pages', () => {
    const result = classifyPublisherPage({
      finalUrl: 'https://publisher.example/story',
      html: '<html><body><article><p>Normal publisher content.</p></article></body></html>'
    });

    expect(result).toEqual({
      isBlocked: false,
      failureType: null,
      details: 'Publisher response body looks usable'
    });
  });
});
