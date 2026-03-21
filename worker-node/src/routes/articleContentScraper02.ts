import { Router } from 'express';
import { QueueJobHandler } from '../modules/queue/queueEngine';
import { createArticleContentScraper02JobHandler } from '../modules/jobs/articleContentScraper02Job';
import { globalQueueEngine } from '../modules/queue/globalQueue';
import { GlobalQueueEngine } from '../modules/queue/queueEngine';
import logger from '../modules/logger';
import {
  ArticleAutomationTargetingInput,
  validateArticleAutomationTargetingInput
} from '../modules/articleTargeting';

export const ARTICLE_CONTENT_SCRAPER_02_ENDPOINT = '/article-content-scraper-02/start-job';

interface ArticleContentScraper02RouteDependencies {
  queueEngine: GlobalQueueEngine;
  buildJobHandler: (input: ArticleAutomationTargetingInput) => QueueJobHandler;
}

export const createArticleContentScraper02Router = (
  dependencies: ArticleContentScraper02RouteDependencies = {
    queueEngine: globalQueueEngine,
    buildJobHandler: createArticleContentScraper02JobHandler
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

      logger.info('Received ArticleContents02 scraper start request', {
        endpointName: ARTICLE_CONTENT_SCRAPER_02_ENDPOINT,
        targetArticleThresholdDaysOld: body.targetArticleThresholdDaysOld,
        targetArticleStateReviewCount: body.targetArticleStateReviewCount,
        includeArticlesThatMightHaveBeenStateAssigned
      });

      const enqueueResult = await queueEngine.enqueueJob({
        endpointName: ARTICLE_CONTENT_SCRAPER_02_ENDPOINT,
        run: buildJobHandler(scraperInput)
      });

      logger.info('Queued ArticleContents02 scraper job', {
        endpointName: ARTICLE_CONTENT_SCRAPER_02_ENDPOINT,
        jobId: enqueueResult.jobId,
        status: enqueueResult.status
      });

      return res.status(202).json({
        jobId: enqueueResult.jobId,
        status: enqueueResult.status,
        endpointName: ARTICLE_CONTENT_SCRAPER_02_ENDPOINT
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
};

export default createArticleContentScraper02Router();
