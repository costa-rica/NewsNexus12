import { createArticleContentScraper02Router } from '../../src/routes/articleContentScraper02';

const getStartJobHandler = () => {
  const router = createArticleContentScraper02Router({
    queueEngine: {
      enqueueJob: jest.fn()
    } as never,
    buildJobHandler: jest.fn(() => async () => undefined)
  });

  const layer = (router.stack as any[]).find(
    (entry) => entry.route?.path === '/start-job' && entry.route?.stack?.[0]
  );

  if (!layer) {
    throw new Error('Could not locate /start-job POST handler');
  }

  return layer.route.stack[0].handle as any;
};

describe('articleContentScraper02 routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes validation errors to next for invalid request bodies', async () => {
    const queueEngine = {
      enqueueJob: jest.fn()
    };
    const buildJobHandler = jest.fn(() => async () => undefined);

    const router = createArticleContentScraper02Router({
      queueEngine: queueEngine as never,
      buildJobHandler
    });
    const layer = (router.stack as any[]).find(
      (entry) => entry.route?.path === '/start-job' && entry.route?.stack?.[0]
    );
    const handler = layer?.route?.stack?.[0]?.handle as any;

    const next = jest.fn();

    await handler(
      {
        body: {
          targetArticleThresholdDaysOld: 0
        }
      } as any,
      {
        status: jest.fn()
      } as any,
      next
    );

    expect(queueEngine.enqueueJob).not.toHaveBeenCalled();
    expect(buildJobHandler).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 400,
        code: 'VALIDATION_ERROR'
      })
    );
  });

  it('enqueues the ArticleContents02 scraper job and returns 202', async () => {
    const enqueueJob = jest.fn().mockResolvedValue({
      jobId: 'job-1',
      status: 'queued'
    });
    const buildJobHandler = jest.fn(() => async () => undefined);
    const router = createArticleContentScraper02Router({
      queueEngine: {
        enqueueJob
      } as never,
      buildJobHandler
    });
    const layer = (router.stack as any[]).find(
      (entry) => entry.route?.path === '/start-job' && entry.route?.stack?.[0]
    );
    const handler = layer?.route?.stack?.[0]?.handle as any;
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });

    await handler(
      {
        body: {
          targetArticleThresholdDaysOld: 180,
          targetArticleStateReviewCount: 100,
          includeArticlesThatMightHaveBeenStateAssigned: true
        }
      } as any,
      { status } as any,
      jest.fn()
    );

    expect(buildJobHandler).toHaveBeenCalledWith({
      targetArticleThresholdDaysOld: 180,
      targetArticleStateReviewCount: 100,
      includeArticlesThatMightHaveBeenStateAssigned: true
    });
    expect(enqueueJob).toHaveBeenCalledWith({
      endpointName: '/article-content-scraper-02/start-job',
      run: expect.any(Function)
    });
    expect(status).toHaveBeenCalledWith(202);
    expect(json).toHaveBeenCalledWith({
      jobId: 'job-1',
      status: 'queued',
      endpointName: '/article-content-scraper-02/start-job'
    });
  });

  it('uses the start-job handler exported by the router', async () => {
    const handler = getStartJobHandler();

    await expect(
      handler(
        {
          body: {
            targetArticleThresholdDaysOld: 180,
            targetArticleStateReviewCount: 100
          }
        } as any,
        {
          status: () => ({
            json: () => undefined
          })
        } as any,
        jest.fn()
      )
    ).resolves.toBeUndefined();
  });
});
