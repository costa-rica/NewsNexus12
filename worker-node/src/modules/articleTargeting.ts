import {
  Article,
  ArticleApproved,
  ArticleIsRelevant,
  ArticleStateContract,
  ArticleStateContract02
} from '@newsnexus/db-models';
import { AppError } from './errors/appError';
import logger from './logger';

export interface ArticleAutomationTargetingInput {
  targetArticleThresholdDaysOld: number;
  targetArticleStateReviewCount: number;
  includeArticlesThatMightHaveBeenStateAssigned?: boolean;
}

export interface TargetArticleRecord {
  id: number;
  title: string;
  description: string;
  url: string | null;
  publishedDate: string | null;
}

export const ARTICLE_AUTOMATION_DEFAULTS: ArticleAutomationTargetingInput = {
  targetArticleThresholdDaysOld: 180,
  targetArticleStateReviewCount: 100,
  includeArticlesThatMightHaveBeenStateAssigned: false
};

const parsePositiveIntegerField = (
  value: unknown,
  field: keyof ArticleAutomationTargetingInput
): number | null => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    logger.warn('Invalid article targeting input field', { field, value });
    return null;
  }

  return value;
};

export const validateArticleAutomationTargetingInput = (
  body: unknown
): ArticleAutomationTargetingInput => {
  const candidate = body as Record<string, unknown>;

  const thresholdDays = parsePositiveIntegerField(
    candidate?.targetArticleThresholdDaysOld,
    'targetArticleThresholdDaysOld'
  );
  const reviewCount = parsePositiveIntegerField(
    candidate?.targetArticleStateReviewCount,
    'targetArticleStateReviewCount'
  );

  const details: Array<{ field: string; message: string }> = [];

  if (thresholdDays === null) {
    details.push({
      field: 'targetArticleThresholdDaysOld',
      message: 'targetArticleThresholdDaysOld must be a positive integer'
    });
  }

  if (reviewCount === null) {
    details.push({
      field: 'targetArticleStateReviewCount',
      message: 'targetArticleStateReviewCount must be a positive integer'
    });
  }

  if (details.length > 0) {
    throw AppError.validation(details);
  }

  return {
    targetArticleThresholdDaysOld: thresholdDays!,
    targetArticleStateReviewCount: reviewCount!
  };
};

export const selectTargetArticles = async ({
  includeArticlesThatMightHaveBeenStateAssigned = false,
  targetArticleStateReviewCount,
  targetArticleThresholdDaysOld
}: ArticleAutomationTargetingInput): Promise<TargetArticleRecord[]> => {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - targetArticleThresholdDaysOld);
  const cutoffDateString = cutoffDate.toISOString().split('T')[0];

  logger.info(
    `Filtering articles published on or after ${cutoffDateString} (within ${targetArticleThresholdDaysOld} days)`
  );

  const contract02ArticleIds = includeArticlesThatMightHaveBeenStateAssigned
    ? []
    : await ArticleStateContract02.findAll({
        attributes: ['articleId'],
        raw: true
      });

  const contractArticleIds = includeArticlesThatMightHaveBeenStateAssigned
    ? []
    : await ArticleStateContract.findAll({
        attributes: ['articleId'],
        raw: true
      });

  const notRelevantArticleIds = await ArticleIsRelevant.findAll({
    attributes: ['articleId'],
    where: { isRelevant: false },
    raw: true
  });

  const decidedArticleIds = includeArticlesThatMightHaveBeenStateAssigned
    ? await ArticleApproved.findAll({
        attributes: ['articleId'],
        raw: true
      })
    : [];

  const assignedIds = [
    ...contract02ArticleIds
      .map((row) => (row as { articleId?: unknown }).articleId)
      .filter((value): value is number => typeof value === 'number'),
    ...contractArticleIds
      .map((row) => (row as { articleId?: unknown }).articleId)
      .filter((value): value is number => typeof value === 'number')
  ];

  const uniqueAssignedIds = [...new Set(assignedIds)];
  const uniqueNotRelevantIds = [
    ...new Set(
      notRelevantArticleIds
        .map((row) => (row as { articleId?: unknown }).articleId)
        .filter((value): value is number => typeof value === 'number')
    )
  ];
  const uniqueDecidedIds = [
    ...new Set(
      decidedArticleIds
        .map((row) => (row as { articleId?: unknown }).articleId)
        .filter((value): value is number => typeof value === 'number')
    )
  ];

  logger.info(
    `Found ${uniqueAssignedIds.length} articles with existing state assignments (${contract02ArticleIds.length} in ArticleStateContracts02, ${contractArticleIds.length} in ArticleStateContracts)`
  );
  logger.info(
    `Found ${uniqueNotRelevantIds.length} articles marked not relevant in ArticleIsRelevants`
  );
  if (includeArticlesThatMightHaveBeenStateAssigned) {
    logger.info(
      `Scraper override enabled: including state-assigned articles and excluding ${uniqueDecidedIds.length} decided articles from ArticleApproveds`
    );
  }

  const articles = await Article.findAll({
    order: [['id', 'DESC']]
  });

  const unassignedArticles = articles
    .filter((article) => Boolean(article.publishedDate) && article.publishedDate! >= cutoffDateString)
    .filter((article) => !uniqueAssignedIds.includes(article.id))
    .filter((article) => !uniqueNotRelevantIds.includes(article.id))
    .filter((article) => !uniqueDecidedIds.includes(article.id))
    .slice(0, targetArticleStateReviewCount);

  logger.info(`Found ${unassignedArticles.length} articles to process`);

  return unassignedArticles.map((article) => ({
    id: article.id,
    title: article.title ?? '',
    description: article.description ?? '',
    url: article.url ?? null,
    publishedDate: article.publishedDate ?? null
  }));
};
