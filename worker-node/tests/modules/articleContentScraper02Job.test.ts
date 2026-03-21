import {
  createArticleContentScraper02JobHandler,
  runArticleContentScraper02Workflow
} from '../../src/modules/jobs/articleContentScraper02Job';

describe('article content scraper 02 job handler', () => {
  it('passes expected arguments into the underlying ArticleContents02 workflow dependency', async () => {
    const selectArticles = jest.fn().mockResolvedValue([]);
    const enrichContent02 = jest.fn().mockResolvedValue({
      articlesConsidered: 0,
      articlesSkipped: 0,
      successfulScrapes: 0,
      failedScrapes: 0,
      createdRows: 0,
      updatedRows: 0
    });

    const handler = createArticleContentScraper02JobHandler(
      {
        targetArticleThresholdDaysOld: 15,
        targetArticleStateReviewCount: 25,
        includeArticlesThatMightHaveBeenStateAssigned: true
      },
      {
        ensureDb: jest.fn().mockResolvedValue(undefined),
        selectArticles,
        enrichContent02
      }
    );

    await handler({
      jobId: 'job-1',
      endpointName: '/article-content-scraper-02/start-job',
      signal: new AbortController().signal,
      registerCancelableProcess: () => undefined
    });

    expect(selectArticles).toHaveBeenCalledWith({
      targetArticleThresholdDaysOld: 15,
      targetArticleStateReviewCount: 25,
      includeArticlesThatMightHaveBeenStateAssigned: true
    });
    expect(enrichContent02).toHaveBeenCalledWith({
      articles: [],
      signal: expect.any(Object)
    });
  });

  it('completes successfully in the happy path', async () => {
    const selectArticles = jest.fn().mockResolvedValue([
      {
        id: 101,
        title: 'A',
        description: 'desc',
        url: 'https://news.google.com/rss/articles/a',
        publishedDate: '2026-03-16'
      }
    ]);
    const enrichContent02 = jest.fn().mockResolvedValue({
      articlesConsidered: 1,
      articlesSkipped: 0,
      successfulScrapes: 1,
      failedScrapes: 0,
      createdRows: 1,
      updatedRows: 0
    });

    await expect(
      runArticleContentScraper02Workflow(
        {
          jobId: 'job-9',
          signal: new AbortController().signal,
          targetArticleThresholdDaysOld: 30,
          targetArticleStateReviewCount: 50,
          includeArticlesThatMightHaveBeenStateAssigned: false
        },
        {
          ensureDb: jest.fn().mockResolvedValue(undefined),
          selectArticles,
          enrichContent02
        }
      )
    ).resolves.toBeUndefined();
  });
});
