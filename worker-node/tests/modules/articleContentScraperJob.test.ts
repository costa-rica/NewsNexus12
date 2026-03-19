import {
  createArticleContentScraperJobHandler,
  runArticleContentScraperWorkflow
} from '../../src/modules/jobs/articleContentScraperJob';

describe('article content scraper job handler', () => {
  it('passes expected arguments into the underlying scraper workflow dependency', async () => {
    const selectArticles = jest.fn().mockResolvedValue([]);
    const enrichContent = jest.fn().mockResolvedValue({
      articlesConsidered: 0,
      articlesSkipped: 0,
      successfulScrapes: 0,
      failedScrapes: 0,
      updatedRows: 0,
      createdRows: 0
    });

    const handler = createArticleContentScraperJobHandler(
      {
        targetArticleThresholdDaysOld: 15,
        targetArticleStateReviewCount: 25,
        includeArticlesThatMightHaveBeenStateAssigned: true
      },
      {
        ensureDb: jest.fn().mockResolvedValue(undefined),
        selectArticles,
        enrichContent
      }
    );

    await handler({
      jobId: 'job-1',
      endpointName: '/article-content-scraper/start-job',
      signal: new AbortController().signal,
      registerCancelableProcess: () => undefined
    });

    expect(selectArticles).toHaveBeenCalledWith({
      targetArticleThresholdDaysOld: 15,
      targetArticleStateReviewCount: 25,
      includeArticlesThatMightHaveBeenStateAssigned: true
    });
    expect(enrichContent).toHaveBeenCalledWith({
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
        url: 'https://example.com/a',
        publishedDate: '2026-03-16'
      }
    ]);
    const enrichContent = jest.fn().mockResolvedValue({
      articlesConsidered: 1,
      articlesSkipped: 0,
      successfulScrapes: 1,
      failedScrapes: 0,
      updatedRows: 0,
      createdRows: 1
    });

    await expect(
      runArticleContentScraperWorkflow(
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
          enrichContent
        }
      )
    ).resolves.toBeUndefined();
  });
});
