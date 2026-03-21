import {
  createArticleContent02Row,
  getCanonicalArticleContent02Row,
  hasSuccessfulArticleContent02,
  toArticleContent02StoredRow,
  updateArticleContent02Row
} from './repository';
import { ArticleContent02StoredRow, ArticleContent02WorkflowResult } from './types';

export interface ArticleContent02PersistenceDependencies {
  getCanonicalRow?: typeof getCanonicalArticleContent02Row;
  createRow?: typeof createArticleContent02Row;
  updateRow?: typeof updateArticleContent02Row;
  toStoredRow?: typeof toArticleContent02StoredRow;
}

export interface ArticleContent02SkipDecision {
  shouldSkip: boolean;
  reason: string;
  existingRow: ArticleContent02StoredRow | null;
}

export interface PersistArticleContent02Result {
  persisted: boolean;
  action: 'created' | 'updated' | 'skipped';
  reason: string;
  row: ArticleContent02StoredRow | null;
}

const hasEnoughDiagnosticInformation = (result: ArticleContent02WorkflowResult): boolean =>
  result.status === 'success' ||
  result.details.trim() !== '' ||
  result.googleFinalUrl !== null ||
  result.publisherUrl !== null ||
  result.publisherFinalUrl !== null ||
  result.googleStatusCode !== null ||
  result.publisherStatusCode !== null ||
  (result.title?.trim() ?? '') !== '' ||
  (result.content?.trim() ?? '') !== '';

export const getArticleContent02SkipDecision = async (
  articleId: number,
  dependencies: ArticleContent02PersistenceDependencies = {}
): Promise<ArticleContent02SkipDecision> => {
  const getCanonicalRow = dependencies.getCanonicalRow ?? getCanonicalArticleContent02Row;
  const toStoredRow = dependencies.toStoredRow ?? toArticleContent02StoredRow;

  const existingRow = await getCanonicalRow(articleId);
  const storedRow = toStoredRow(existingRow);

  if (existingRow) {
    return {
      shouldSkip: true,
      reason: 'Canonical ArticleContents02 row already exists for this article',
      existingRow: storedRow
    };
  }

  return {
    shouldSkip: false,
    reason: 'No ArticleContents02 row exists for this article',
    existingRow: storedRow
  };
};

export const persistArticleContent02Result = async (
  result: ArticleContent02WorkflowResult,
  dependencies: ArticleContent02PersistenceDependencies = {}
): Promise<PersistArticleContent02Result> => {
  const getCanonicalRow = dependencies.getCanonicalRow ?? getCanonicalArticleContent02Row;
  const createRow = dependencies.createRow ?? createArticleContent02Row;
  const updateRow = dependencies.updateRow ?? updateArticleContent02Row;
  const toStoredRow = dependencies.toStoredRow ?? toArticleContent02StoredRow;

  if (!hasEnoughDiagnosticInformation(result)) {
    return {
      persisted: false,
      action: 'skipped',
      reason: 'Skipped persistence because the result did not include enough diagnostic information',
      row: null
    };
  }

  const existingRow = await getCanonicalRow(result.articleId);

  if (existingRow && !hasSuccessfulArticleContent02(existingRow)) {
    const updatedRow = await updateRow(existingRow, {
      url: result.publisherUrl,
      googleFinalUrl: result.googleFinalUrl,
      publisherFinalUrl: result.publisherFinalUrl,
      title: result.title,
      content: result.content,
      status: result.status,
      failureType: result.failureType,
      details: result.details,
      extractionSource: result.extractionSource,
      bodySource: result.bodySource,
      googleStatusCode: result.googleStatusCode,
      publisherStatusCode: result.publisherStatusCode
    });

    return {
      persisted: true,
      action: 'updated',
      reason: 'Updated existing ArticleContents02 row with the latest workflow result',
      row: toStoredRow(updatedRow)
    };
  }

  const createdRow = await createRow({
    articleId: result.articleId,
    url: result.publisherUrl,
    googleRssUrl: result.googleRssUrl,
    googleFinalUrl: result.googleFinalUrl,
    publisherFinalUrl: result.publisherFinalUrl,
    title: result.title,
    content: result.content,
    status: result.status,
    failureType: result.failureType,
    details: result.details,
    extractionSource: result.extractionSource,
    bodySource: result.bodySource,
    googleStatusCode: result.googleStatusCode,
    publisherStatusCode: result.publisherStatusCode
  });

  return {
    persisted: true,
    action: 'created',
    reason: 'Created new ArticleContents02 row from workflow result',
    row: toStoredRow(createdRow)
  };
};

export default {
  getArticleContent02SkipDecision,
  persistArticleContent02Result
};
