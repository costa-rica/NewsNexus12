import { QueueExecutionContext } from '../queue/queueEngine';
import ensureDbReady from '../db/ensureDbReady';
import {
  ArticleAutomationTargetingInput,
  selectTargetArticles
} from '../articleTargeting';
import { enrichArticleContent02 } from '../article-content-02/enrichment';
import logger from '../logger';

export interface ArticleContentScraper02JobDependencies {
  ensureDb?: typeof ensureDbReady;
  selectArticles?: typeof selectTargetArticles;
  enrichContent02?: typeof enrichArticleContent02;
}

export const runArticleContentScraper02Workflow = async (
  input: ArticleAutomationTargetingInput & { signal: AbortSignal; jobId: string },
  dependencies: ArticleContentScraper02JobDependencies = {}
): Promise<void> => {
  const ensureDb = dependencies.ensureDb ?? ensureDbReady;
  await ensureDb();

  const selectArticles = dependencies.selectArticles ?? selectTargetArticles;
  const enrichContent02 = dependencies.enrichContent02 ?? enrichArticleContent02;

  const articles = await selectArticles({
    targetArticleThresholdDaysOld: input.targetArticleThresholdDaysOld,
    targetArticleStateReviewCount: input.targetArticleStateReviewCount,
    includeArticlesThatMightHaveBeenStateAssigned:
      input.includeArticlesThatMightHaveBeenStateAssigned
  });

  logger.info('Starting ArticleContents02 scraper workflow', {
    jobId: input.jobId,
    candidateArticles: articles.length,
    targetArticleThresholdDaysOld: input.targetArticleThresholdDaysOld,
    targetArticleStateReviewCount: input.targetArticleStateReviewCount,
    includeArticlesThatMightHaveBeenStateAssigned:
      input.includeArticlesThatMightHaveBeenStateAssigned === true
  });

  const summary = await enrichContent02({
    articles,
    signal: input.signal
  });

  logger.info('Completed ArticleContents02 scraper workflow', {
    jobId: input.jobId,
    ...summary
  });
};

export const createArticleContentScraper02JobHandler = (
  input: ArticleAutomationTargetingInput,
  dependencies: ArticleContentScraper02JobDependencies = {}
) => {
  return async (queueContext: QueueExecutionContext): Promise<void> => {
    await runArticleContentScraper02Workflow(
      {
        jobId: queueContext.jobId,
        signal: queueContext.signal,
        targetArticleThresholdDaysOld: input.targetArticleThresholdDaysOld,
        targetArticleStateReviewCount: input.targetArticleStateReviewCount,
        includeArticlesThatMightHaveBeenStateAssigned:
          input.includeArticlesThatMightHaveBeenStateAssigned
      },
      dependencies
    );
  };
};

export default createArticleContentScraper02JobHandler;
