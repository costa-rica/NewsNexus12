import logger from '../logger';
import {
  createGoogleNavigationSession,
  GoogleNavigationSession,
  navigateGoogleUrl
} from './googleNavigator';
import { classifyGooglePage } from './googleClassifier';
import { extractPublisherUrl, extractPublisherUrlFromFinalUrl } from './publisherExtractor';
import { fetchPublisherPage } from './publisherFetcher';
import {
  getArticleContent02SkipDecision,
  persistArticleContent02Result
} from './persistence';
import {
  ArticleContent02Candidate,
  ArticleContent02WorkflowResult,
  ArticleContent02WorkflowSummary
} from './types';

export interface EnrichArticleContent02Dependencies {
  createNavigationSession?: typeof createGoogleNavigationSession;
  navigateGoogleUrl?: typeof navigateGoogleUrl;
  classifyGooglePage?: typeof classifyGooglePage;
  extractPublisherUrlFromFinalUrl?: typeof extractPublisherUrlFromFinalUrl;
  extractPublisherUrl?: typeof extractPublisherUrl;
  fetchPublisherPage?: typeof fetchPublisherPage;
  getSkipDecision?: typeof getArticleContent02SkipDecision;
  persistResult?: typeof persistArticleContent02Result;
}

export interface EnrichArticleContent02Options {
  articles: ArticleContent02Candidate[];
  signal: AbortSignal;
}

const createEmptySummary = (): ArticleContent02WorkflowSummary => ({
  articlesConsidered: 0,
  articlesSkipped: 0,
  successfulScrapes: 0,
  failedScrapes: 0,
  createdRows: 0,
  updatedRows: 0
});

const createGoogleFailureResult = ({
  article,
  googleFinalUrl,
  googleStatusCode,
  details,
  failureType
}: {
  article: ArticleContent02Candidate;
  googleFinalUrl: string | null;
  googleStatusCode: number | null;
  details: string;
  failureType: ArticleContent02WorkflowResult['failureType'];
}): ArticleContent02WorkflowResult => ({
  articleId: article.id,
  googleRssUrl: article.url ?? '',
  googleFinalUrl,
  publisherUrl: null,
  publisherFinalUrl: null,
  title: null,
  content: null,
  status: 'fail',
  failureType,
  details,
  extractionSource: 'none',
  bodySource: 'google-page',
  googleStatusCode,
  publisherStatusCode: null
});

export const enrichArticleContent02 = async (
  options: EnrichArticleContent02Options,
  dependencies: EnrichArticleContent02Dependencies = {}
): Promise<ArticleContent02WorkflowSummary> => {
  const createNavigationSession =
    dependencies.createNavigationSession ?? createGoogleNavigationSession;
  const navigateGoogleUrlImpl = dependencies.navigateGoogleUrl ?? navigateGoogleUrl;
  const classifyGooglePageImpl = dependencies.classifyGooglePage ?? classifyGooglePage;
  const extractPublisherUrlFromFinalUrlImpl =
    dependencies.extractPublisherUrlFromFinalUrl ?? extractPublisherUrlFromFinalUrl;
  const extractPublisherUrlImpl = dependencies.extractPublisherUrl ?? extractPublisherUrl;
  const fetchPublisherPageImpl = dependencies.fetchPublisherPage ?? fetchPublisherPage;
  const getSkipDecision = dependencies.getSkipDecision ?? getArticleContent02SkipDecision;
  const persistResult = dependencies.persistResult ?? persistArticleContent02Result;

  const summary = createEmptySummary();
  const navigationSession = await createNavigationSession();

  try {
    for (const article of options.articles) {
      if (options.signal.aborted) {
        logger.warn('Article content 02 enrichment canceled', {
          remainingArticles: options.articles.length - summary.articlesConsidered
        });
        break;
      }

      summary.articlesConsidered += 1;

      if (!article.url || article.url.trim() === '') {
        summary.articlesSkipped += 1;
        logger.info('Skipping article content 02 scrape because Google RSS URL is missing', {
          articleId: article.id
        });
        continue;
      }

      const skipDecision = await getSkipDecision(article.id);
      if (skipDecision.shouldSkip) {
        summary.articlesSkipped += 1;
        logger.info('Skipping article content 02 scrape because a usable row already exists', {
          articleId: article.id,
          existingArticleContents02Id: skipDecision.existingRow?.id ?? null
        });
        continue;
      }

      let workflowResult: ArticleContent02WorkflowResult;

      try {
        const googleNavigation = await navigateGoogleUrlImpl(
          navigationSession.context,
          article.url,
          options.signal
        );

        const googleClassification = classifyGooglePageImpl({
          finalUrl: googleNavigation.finalUrl,
          html: googleNavigation.html
        });

        if (googleClassification.isBlocked) {
          workflowResult = createGoogleFailureResult({
            article,
            googleFinalUrl: googleNavigation.finalUrl,
            googleStatusCode: googleNavigation.statusCode,
            details: googleClassification.details,
            failureType: googleClassification.failureType
          });
        } else {
          const extractedFromFinalUrl = extractPublisherUrlFromFinalUrlImpl(
            googleNavigation.finalUrl
          );
          const extractedFromHtml = extractPublisherUrlImpl({
            html: googleNavigation.html,
            baseUrl: googleNavigation.finalUrl || article.url
          });
          const extracted =
            extractedFromFinalUrl.publisherUrl !== null ? extractedFromFinalUrl : extractedFromHtml;

          if (!extracted.publisherUrl) {
            workflowResult = {
              articleId: article.id,
              googleRssUrl: article.url,
              googleFinalUrl: googleNavigation.finalUrl,
              publisherUrl: null,
              publisherFinalUrl: null,
              title: null,
              content: null,
              status: 'fail',
              failureType: extracted.failureType,
              details: extracted.details,
              extractionSource: extracted.extractionSource,
              bodySource: 'google-page',
              googleStatusCode: googleNavigation.statusCode,
              publisherStatusCode: null
            };
          } else {
            const publisherResult = await fetchPublisherPageImpl({
              publisherUrl: extracted.publisherUrl,
              browserContext: navigationSession.context,
              signal: options.signal
            });

            workflowResult = {
              articleId: article.id,
              googleRssUrl: article.url,
              googleFinalUrl: googleNavigation.finalUrl,
              publisherUrl: extracted.publisherUrl,
              publisherFinalUrl: publisherResult.finalUrl,
              title: publisherResult.title,
              content: publisherResult.content,
              status: publisherResult.failureType ? 'fail' : 'success',
              failureType: publisherResult.failureType,
              details: publisherResult.details,
              extractionSource: extracted.extractionSource,
              bodySource: publisherResult.bodySource,
              googleStatusCode: googleNavigation.statusCode,
              publisherStatusCode: publisherResult.statusCode
            };
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        workflowResult = {
          articleId: article.id,
          googleRssUrl: article.url,
          googleFinalUrl: null,
          publisherUrl: null,
          publisherFinalUrl: null,
          title: null,
          content: null,
          status: 'fail',
          failureType: 'navigation_error',
          details: message,
          extractionSource: 'none',
          bodySource: 'none',
          googleStatusCode: null,
          publisherStatusCode: null
        };
      }

      const persistenceResult = await persistResult(workflowResult);

      if (workflowResult.status === 'success') {
        summary.successfulScrapes += 1;
      } else {
        summary.failedScrapes += 1;
      }

      if (persistenceResult.action === 'created') {
        summary.createdRows += 1;
      }

      if (persistenceResult.action === 'updated') {
        summary.updatedRows += 1;
      }

      logger.info('Article content 02 workflow result persisted', {
        articleId: article.id,
        status: workflowResult.status,
        failureType: workflowResult.failureType,
        bodySource: workflowResult.bodySource,
        extractionSource: workflowResult.extractionSource,
        persistenceAction: persistenceResult.action
      });
    }
  } finally {
    await navigationSession.close();
  }

  logger.info('Article content 02 enrichment summary', summary);
  return summary;
};

export default enrichArticleContent02;
