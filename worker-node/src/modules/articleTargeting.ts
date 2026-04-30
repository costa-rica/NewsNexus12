import {
  Article,
  ArticleApproved,
  ArticleIsRelevant,
  ArticleStateContract,
  ArticleStateContract02,
  sequelize
} from '@newsnexus/db-models';
import { AppError } from './errors/appError';
import logger from './logger';

export interface ArticleAutomationTargetingInput {
  targetArticleThresholdDaysOld: number;
  targetArticleStateReviewCount: number;
  includeArticlesThatMightHaveBeenStateAssigned?: boolean;
  articleIds?: number[];
  articleIdMinExclusive?: number;
  articleIdMaxInclusive?: number;
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

const parseArticleIdsField = (value: unknown): number[] | null => {
  if (value === undefined) {
    return null;
  }

  if (!Array.isArray(value) || value.length === 0) {
    logger.warn('Invalid articleIds input field', { value });
    return null;
  }

  const normalizedIds = value.filter(
    (candidate): candidate is number =>
      typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0
  );

  if (normalizedIds.length !== value.length) {
    logger.warn('Invalid articleIds input values', { value });
    return null;
  }

  return [...new Set(normalizedIds)];
};

const parseOptionalPositiveIntegerField = (
  value: unknown,
  fieldName: string
): number | null | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    logger.warn('Invalid optional article targeting field', { field: fieldName, value });
    return null;
  }
  return value;
};

export const validateArticleAutomationTargetingInput = (
  body: unknown
): ArticleAutomationTargetingInput => {
  const candidate = body as Record<string, unknown>;
  const articleIds = parseArticleIdsField(candidate?.articleIds);

  const articleIdMinExclusive = parseOptionalPositiveIntegerField(
    candidate?.articleIdMinExclusive,
    'articleIdMinExclusive'
  );
  const articleIdMaxInclusive = parseOptionalPositiveIntegerField(
    candidate?.articleIdMaxInclusive,
    'articleIdMaxInclusive'
  );

  if (Array.isArray(candidate?.articleIds) && articleIds !== null) {
    return {
      ...ARTICLE_AUTOMATION_DEFAULTS,
      articleIds,
      ...(typeof articleIdMinExclusive === 'number' ? { articleIdMinExclusive } : {}),
      ...(typeof articleIdMaxInclusive === 'number' ? { articleIdMaxInclusive } : {})
    };
  }

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

  if (articleIdMinExclusive === null) {
    details.push({
      field: 'articleIdMinExclusive',
      message: 'articleIdMinExclusive must be a positive integer when provided'
    });
  }

  if (articleIdMaxInclusive === null) {
    details.push({
      field: 'articleIdMaxInclusive',
      message: 'articleIdMaxInclusive must be a positive integer when provided'
    });
  }

  if (details.length > 0) {
    if (candidate?.articleIds !== undefined && articleIds === null) {
      details.push({
        field: 'articleIds',
        message: 'articleIds must be a non-empty array of positive integers'
      });
    }

    throw AppError.validation(details);
  }

  return {
    targetArticleThresholdDaysOld: thresholdDays!,
    targetArticleStateReviewCount: reviewCount!,
    articleIds: articleIds ?? undefined,
    ...(typeof articleIdMinExclusive === 'number' ? { articleIdMinExclusive } : {}),
    ...(typeof articleIdMaxInclusive === 'number' ? { articleIdMaxInclusive } : {})
  };
};

export const selectTargetArticles = async ({
  articleIds,
  includeArticlesThatMightHaveBeenStateAssigned = false,
  targetArticleStateReviewCount,
  targetArticleThresholdDaysOld,
  articleIdMinExclusive,
  articleIdMaxInclusive
}: ArticleAutomationTargetingInput): Promise<TargetArticleRecord[]> => {
  if (articleIds && articleIds.length > 0) {
    const articles = await Article.findAll({
      where: { id: articleIds },
      order: [['id', 'DESC']]
    });

    logger.info('Selected explicit article ids for automation workflow', {
      requestedArticleIds: articleIds.length,
      foundArticles: articles.length
    });

    return articles.map((article) => ({
      id: article.id,
      title: article.title ?? '',
      description: article.description ?? '',
      url: article.url ?? null,
      publishedDate: article.publishedDate ?? null
    }));
  }

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

  const articleWhereRaw: string[] = [];
  if (typeof articleIdMinExclusive === 'number') {
    articleWhereRaw.push(`"Article"."id" > ${articleIdMinExclusive}`);
  }
  if (typeof articleIdMaxInclusive === 'number') {
    articleWhereRaw.push(`"Article"."id" <= ${articleIdMaxInclusive}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const articleWhere: any = articleWhereRaw.length > 0
    ? sequelize.and(...articleWhereRaw.map((cond) => sequelize.literal(cond)))
    : undefined;

  const articles = await Article.findAll({
    where: articleWhere,
    order: [['id', 'DESC']]
  });

  if (articleWhereRaw.length > 0) {
    logger.info('Article targeting applying id range filter', {
      articleIdMinExclusive,
      articleIdMaxInclusive,
      fetchedCount: articles.length
    });
  }

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
