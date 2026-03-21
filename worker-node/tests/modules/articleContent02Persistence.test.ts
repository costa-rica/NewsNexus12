import {
  getArticleContent02SkipDecision,
  persistArticleContent02Result
} from '../../src/modules/article-content-02/persistence';
import { ArticleContent02WorkflowResult } from '../../src/modules/article-content-02/types';

const baseWorkflowResult: ArticleContent02WorkflowResult = {
  articleId: 101,
  googleRssUrl: 'https://news.google.com/rss/articles/abc',
  googleFinalUrl: 'https://news.google.com/articles/abc',
  publisherUrl: 'https://publisher.example/story',
  publisherFinalUrl: 'https://publisher.example/story',
  title: 'Publisher headline',
  content: 'x'.repeat(220),
  status: 'success',
  failureType: null,
  details: 'Direct HTTP returned usable publisher HTML',
  extractionSource: 'canonical',
  bodySource: 'direct-http',
  googleStatusCode: 200,
  publisherStatusCode: 200
};

describe('article content 02 persistence', () => {
  it('skips articles that already have any canonical row', async () => {
    const decision = await getArticleContent02SkipDecision(101, {
      getCanonicalRow: jest.fn().mockResolvedValue({
        id: 10,
        articleId: 101,
        status: 'fail',
        content: null
      } as never),
      toStoredRow: jest.fn().mockReturnValue({
        id: 10,
        articleId: 101,
        status: 'fail',
        content: null
      } as never)
    });

    expect(decision).toEqual({
      shouldSkip: true,
      reason: 'Canonical ArticleContents02 row already exists for this article',
      existingRow: {
        id: 10,
        articleId: 101,
        status: 'fail',
        content: null
      }
    });
  });

  it('creates a new row when no canonical row exists', async () => {
    const createRow = jest.fn().mockResolvedValue({
      id: 11,
      articleId: 101
    });
    const toStoredRow = jest.fn().mockReturnValue({
      id: 11,
      articleId: 101,
      status: 'success'
    });

    const result = await persistArticleContent02Result(baseWorkflowResult, {
      getCanonicalRow: jest.fn().mockResolvedValue(null),
      createRow,
      updateRow: jest.fn(),
      toStoredRow
    });

    expect(createRow).toHaveBeenCalledWith({
      articleId: 101,
      url: 'https://publisher.example/story',
      googleRssUrl: 'https://news.google.com/rss/articles/abc',
      googleFinalUrl: 'https://news.google.com/articles/abc',
      publisherFinalUrl: 'https://publisher.example/story',
      title: 'Publisher headline',
      content: 'x'.repeat(220),
      status: 'success',
      failureType: null,
      details: 'Direct HTTP returned usable publisher HTML',
      extractionSource: 'canonical',
      bodySource: 'direct-http',
      googleStatusCode: 200,
      publisherStatusCode: 200
    });
    expect(result).toEqual({
      persisted: true,
      action: 'created',
      reason: 'Created new ArticleContents02 row from workflow result',
      row: {
        id: 11,
        articleId: 101,
        status: 'success'
      }
    });
  });

  it('updates an existing non-success canonical row', async () => {
    const existingRow = {
      id: 12,
      articleId: 101,
      status: 'fail',
      content: null
    };
    const updatedRow = {
      id: 12,
      articleId: 101,
      status: 'success'
    };

    const result = await persistArticleContent02Result(baseWorkflowResult, {
      getCanonicalRow: jest.fn().mockResolvedValue(existingRow as never),
      createRow: jest.fn(),
      updateRow: jest.fn().mockResolvedValue(updatedRow),
      toStoredRow: jest.fn().mockReturnValue({
        id: 12,
        articleId: 101,
        status: 'success'
      } as never)
    });

    expect(result).toEqual({
      persisted: true,
      action: 'updated',
      reason: 'Updated existing ArticleContents02 row with the latest workflow result',
      row: {
        id: 12,
        articleId: 101,
        status: 'success'
      }
    });
  });

  it('persists failed results when they include useful diagnostics', async () => {
    const failedResult: ArticleContent02WorkflowResult = {
      ...baseWorkflowResult,
      status: 'fail',
      failureType: 'blocked_google',
      title: null,
      content: null,
      bodySource: 'google-page',
      details: 'Matched blocked pattern: consent.google.com',
      publisherUrl: null,
      publisherFinalUrl: null,
      publisherStatusCode: null
    };

    const createRow = jest.fn().mockResolvedValue({
      id: 13,
      articleId: 101
    });

    const result = await persistArticleContent02Result(failedResult, {
      getCanonicalRow: jest.fn().mockResolvedValue(null),
      createRow,
      updateRow: jest.fn(),
      toStoredRow: jest.fn().mockReturnValue({
        id: 13,
        articleId: 101,
        status: 'fail',
        failureType: 'blocked_google'
      } as never)
    });

    expect(createRow).toHaveBeenCalled();
    expect(result).toEqual({
      persisted: true,
      action: 'created',
      reason: 'Created new ArticleContents02 row from workflow result',
      row: {
        id: 13,
        articleId: 101,
        status: 'fail',
        failureType: 'blocked_google'
      }
    });
  });

  it('skips persistence when a failed result has no useful diagnostics', async () => {
    const result = await persistArticleContent02Result(
      {
        ...baseWorkflowResult,
        status: 'fail',
        failureType: null,
        details: '',
        googleFinalUrl: null,
        publisherUrl: null,
        publisherFinalUrl: null,
        title: null,
        content: null,
        googleStatusCode: null,
        publisherStatusCode: null,
        bodySource: 'none',
        extractionSource: 'none'
      },
      {
        getCanonicalRow: jest.fn(),
        createRow: jest.fn(),
        updateRow: jest.fn(),
        toStoredRow: jest.fn()
      }
    );

    expect(result).toEqual({
      persisted: false,
      action: 'skipped',
      reason: 'Skipped persistence because the result did not include enough diagnostic information',
      row: null
    });
  });
});
