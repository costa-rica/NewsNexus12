import { QueueExecutionContext } from '../queue/queueEngine';
import ensureDbReady from '../db/ensureDbReady';
import {
  ArticleAutomationTargetingInput,
  selectTargetArticles
} from '../articleTargeting';
import { enrichArticleContent } from '../article-content/enrichment';
import logger from '../logger';

export interface ArticleContentScraperJobDependencies {
  ensureDb?: typeof ensureDbReady;
  selectArticles?: typeof selectTargetArticles;
  enrichContent?: typeof enrichArticleContent;
}

export const runArticleContentScraperWorkflow = async (
  input: ArticleAutomationTargetingInput & { signal: AbortSignal; jobId: string },
  dependencies: ArticleContentScraperJobDependencies = {}
): Promise<void> => {
  const ensureDb = dependencies.ensureDb ?? ensureDbReady;
  await ensureDb();

  const selectArticles = dependencies.selectArticles ?? selectTargetArticles;
  const enrichContent = dependencies.enrichContent ?? enrichArticleContent;

  const articles = await selectArticles({
    targetArticleThresholdDaysOld: input.targetArticleThresholdDaysOld,
    targetArticleStateReviewCount: input.targetArticleStateReviewCount,
    includeArticlesThatMightHaveBeenStateAssigned:
      input.includeArticlesThatMightHaveBeenStateAssigned
  });

  logger.info('Starting standalone article content scraper workflow', {
    jobId: input.jobId,
    candidateArticles: articles.length,
    targetArticleThresholdDaysOld: input.targetArticleThresholdDaysOld,
    targetArticleStateReviewCount: input.targetArticleStateReviewCount,
    includeArticlesThatMightHaveBeenStateAssigned:
      input.includeArticlesThatMightHaveBeenStateAssigned === true
  });

  const summary = await enrichContent({
    articles,
    signal: input.signal
  });

  logger.info('Completed standalone article content scraper workflow', {
    jobId: input.jobId,
    ...summary
  });
};

export const createArticleContentScraperJobHandler = (
  input: ArticleAutomationTargetingInput,
  dependencies: ArticleContentScraperJobDependencies = {}
) => {
  return async (queueContext: QueueExecutionContext): Promise<void> => {
    await runArticleContentScraperWorkflow(
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

export default createArticleContentScraperJobHandler;
