import { Router } from 'express';
import { QueueJobHandler } from '../modules/queue/queueEngine';
import { createArticleContentScraperJobHandler } from '../modules/jobs/articleContentScraperJob';
import { globalQueueEngine } from '../modules/queue/globalQueue';
import { GlobalQueueEngine } from '../modules/queue/queueEngine';
import logger from '../modules/logger';
import {
  ArticleAutomationTargetingInput,
  validateArticleAutomationTargetingInput
} from '../modules/articleTargeting';
import { ARTICLE_CONTENT_SCRAPER_ENDPOINT } from '../modules/article-content/config';

interface ArticleContentScraperRouteDependencies {
  queueEngine: GlobalQueueEngine;
  buildJobHandler: (input: ArticleAutomationTargetingInput) => QueueJobHandler;
}

export const createArticleContentScraperRouter = (
  dependencies: ArticleContentScraperRouteDependencies = {
    queueEngine: globalQueueEngine,
    buildJobHandler: createArticleContentScraperJobHandler
  }
): Router => {
  const router = Router();
  const { queueEngine, buildJobHandler } = dependencies;

  router.post('/start-job', async (req, res, next) => {
    try {
      const body = validateArticleAutomationTargetingInput(req.body);
      const includeArticlesThatMightHaveBeenStateAssigned =
        req.body?.includeArticlesThatMightHaveBeenStateAssigned === true;
      const scraperInput: ArticleAutomationTargetingInput = {
        ...body,
        includeArticlesThatMightHaveBeenStateAssigned
      };

      logger.info('Received article content scraper start request', {
        endpointName: ARTICLE_CONTENT_SCRAPER_ENDPOINT,
        targetArticleThresholdDaysOld: body.targetArticleThresholdDaysOld,
        targetArticleStateReviewCount: body.targetArticleStateReviewCount,
        includeArticlesThatMightHaveBeenStateAssigned
      });

      const enqueueResult = await queueEngine.enqueueJob({
        endpointName: ARTICLE_CONTENT_SCRAPER_ENDPOINT,
        run: buildJobHandler(scraperInput)
      });

      logger.info('Queued article content scraper job', {
        endpointName: ARTICLE_CONTENT_SCRAPER_ENDPOINT,
        jobId: enqueueResult.jobId,
        status: enqueueResult.status
      });

      return res.status(202).json({
        jobId: enqueueResult.jobId,
        status: enqueueResult.status,
        endpointName: ARTICLE_CONTENT_SCRAPER_ENDPOINT
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
};

export default createArticleContentScraperRouter();
