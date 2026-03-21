import { parseArticleFields } from '../../src/modules/article-content-02/articleParser';

describe('article parser', () => {
  it('extracts title and paragraph content from publisher HTML', () => {
    const result = parseArticleFields(`
      <html>
        <head>
          <meta property="og:title" content="Parsed headline" />
        </head>
        <body>
          <article>
            <p>This is the first paragraph with enough content to be meaningful in the parsed article.</p>
            <p>This is the second paragraph with enough content to remain in the normalized output.</p>
          </article>
        </body>
      </html>
    `);

    expect(result.title).toBe('Parsed headline');
    expect(result.content).toContain('This is the first paragraph');
    expect(result.content).toContain('This is the second paragraph');
  });
});
