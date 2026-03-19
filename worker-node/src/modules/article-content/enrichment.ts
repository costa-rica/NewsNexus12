import { ArticleContent } from '@newsnexus/db-models';
import logger from '../logger';
import { ArticleContentCandidate, ArticleContentEnrichmentSummary } from './types';
import { getCanonicalArticleContentRow, hasUsableArticleContent } from './repository';
import { scrapeArticleContent } from './scraper';

export interface EnrichArticleContentDependencies {
  scrapeArticleContent?: typeof scrapeArticleContent;
}

export interface EnrichArticleContentOptions {
  articles: ArticleContentCandidate[];
  signal: AbortSignal;
}

const createEmptySummary = (): ArticleContentEnrichmentSummary => ({
  articlesConsidered: 0,
  articlesSkipped: 0,
  successfulScrapes: 0,
  failedScrapes: 0,
  updatedRows: 0,
  createdRows: 0
});

const shouldSkipExistingRow = (row: InstanceType<typeof ArticleContent> | null): boolean => {
  if (!row) {
    return false;
  }

  if (hasUsableArticleContent(row.content)) {
    return true;
  }

  if (row.scrapeStatusCheerio === true) {
    return true;
  }

  return false;
};

export const enrichArticleContent = async (
  options: EnrichArticleContentOptions,
  dependencies: EnrichArticleContentDependencies = {}
): Promise<ArticleContentEnrichmentSummary> => {
  const scrapeArticleContentImpl = dependencies.scrapeArticleContent ?? scrapeArticleContent;
  const summary = createEmptySummary();

  for (const article of options.articles) {
    if (options.signal.aborted) {
      logger.warn('Article content enrichment canceled', {
        remainingArticles: options.articles.length - summary.articlesConsidered
      });
      break;
    }

    summary.articlesConsidered += 1;

    if (!article.url || article.url.trim() === '') {
      summary.articlesSkipped += 1;
      logger.info('Skipping article content scrape because URL is missing', {
        articleId: article.id
      });
      continue;
    }

    const existingRow = await getCanonicalArticleContentRow(article.id);
    if (shouldSkipExistingRow(existingRow)) {
      summary.articlesSkipped += 1;
      logger.info('Skipping article content scrape because content is already usable', {
        articleId: article.id,
        articleContentId: existingRow?.id ?? null
      });
      continue;
    }

    const scrapeResult = await scrapeArticleContentImpl(article.url, options.signal);

    if (!scrapeResult.success) {
      summary.failedScrapes += 1;

      if (existingRow) {
        await existingRow.update({
          scrapeStatusCheerio: scrapeResult.scrapeStatusCheerio,
          scrapeStatusPuppeteer: scrapeResult.scrapeStatusPuppeteer
        });
        summary.updatedRows += 1;
      } else {
        await ArticleContent.create({
          articleId: article.id,
          content: '',
          scrapeStatusCheerio: scrapeResult.scrapeStatusCheerio,
          scrapeStatusPuppeteer: scrapeResult.scrapeStatusPuppeteer
        });
        summary.createdRows += 1;
      }

      logger.warn('Article content scrape failed', {
        articleId: article.id,
        error: scrapeResult.error,
        failureType: scrapeResult.failureType,
        method: scrapeResult.method
      });
      continue;
    }

    summary.successfulScrapes += 1;

    if (existingRow) {
      await existingRow.update({
        content: scrapeResult.content,
        scrapeStatusCheerio: scrapeResult.scrapeStatusCheerio,
        scrapeStatusPuppeteer: scrapeResult.scrapeStatusPuppeteer
      });
      summary.updatedRows += 1;
    } else {
      await ArticleContent.create({
        articleId: article.id,
        content: scrapeResult.content,
        scrapeStatusCheerio: scrapeResult.scrapeStatusCheerio,
        scrapeStatusPuppeteer: scrapeResult.scrapeStatusPuppeteer
      });
      summary.createdRows += 1;
    }

    logger.info('Article content scrape succeeded', {
      articleId: article.id,
      contentLength: scrapeResult.contentLength,
      method: scrapeResult.method
    });
  }

  logger.info('Article content enrichment summary', summary);
  return summary;
};

export default enrichArticleContent;
