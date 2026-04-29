import logger from '../logger';
import {
  createGoogleNavigationSession,
  GoogleNavigationSession,
  navigateGoogleUrl
} from './googleNavigator';
import { ARTICLE_CONTENT_02_ARTICLE_TIMEOUT_MS } from './config';
import { classifyGooglePage } from './googleClassifier';
import { createGoogleNavigationSessionManager } from './navigationSessionManager';
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

export interface ProcessArticleContent02CandidateOptions {
  article: ArticleContent02Candidate;
  signal: AbortSignal;
  navigationSession?: GoogleNavigationSession;
  bypassExistingRowSkip?: boolean;
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

export interface ProcessArticleContent02CandidateResult {
  skipped: boolean;
  persistenceAction: 'created' | 'updated' | 'skipped' | null;
  workflowResult: ArticleContent02WorkflowResult | null;
}

const createTimeoutFailureResult = (
  article: ArticleContent02Candidate,
  timeoutMs: number
): ArticleContent02WorkflowResult => ({
  articleId: article.id,
  googleRssUrl: article.url ?? '',
  googleFinalUrl: null,
  publisherUrl: null,
  publisherFinalUrl: null,
  title: null,
  content: null,
  status: 'fail',
  failureType: 'navigation_error',
  details: `Article content 02 scrape timed out after ${timeoutMs}ms`,
  extractionSource: 'none',
  bodySource: 'none',
  googleStatusCode: null,
  publisherStatusCode: null
});

const createLinkedAbortController = (parentSignal: AbortSignal): AbortController => {
  const controller = new AbortController();

  if (parentSignal.aborted) {
    controller.abort();
    return controller;
  }

  parentSignal.addEventListener(
    'abort',
    () => {
      controller.abort();
    },
    { once: true, signal: controller.signal }
  );

  return controller;
};

const runWithArticleTimeout = async (
  article: ArticleContent02Candidate,
  parentSignal: AbortSignal,
  work: (signal: AbortSignal) => Promise<ArticleContent02WorkflowResult>,
  timeoutMs = ARTICLE_CONTENT_02_ARTICLE_TIMEOUT_MS
): Promise<ArticleContent02WorkflowResult> => {
  const controller = createLinkedAbortController(parentSignal);
  let timeoutFired = false;

  const timeoutPromise = new Promise<ArticleContent02WorkflowResult>((resolve) => {
    const timeout = setTimeout(() => {
      timeoutFired = true;
      controller.abort();
      resolve(createTimeoutFailureResult(article, timeoutMs));
    }, timeoutMs);

    controller.signal.addEventListener(
      'abort',
      () => {
        if (!timeoutFired) {
          clearTimeout(timeout);
        }
      },
      { once: true }
    );
  });

  try {
    const workPromise = work(controller.signal);
    workPromise.catch(() => undefined);

    return await Promise.race([workPromise, timeoutPromise]);
  } finally {
    controller.abort();
  }
};

const buildArticleContent02WorkflowResult = async ({
  article,
  googleRssUrl,
  signal,
  navigationSession,
  navigateGoogleUrlImpl,
  classifyGooglePageImpl,
  extractPublisherUrlFromFinalUrlImpl,
  extractPublisherUrlImpl,
  fetchPublisherPageImpl
}: {
  article: ArticleContent02Candidate;
  googleRssUrl: string;
  signal: AbortSignal;
  navigationSession: GoogleNavigationSession;
  navigateGoogleUrlImpl: typeof navigateGoogleUrl;
  classifyGooglePageImpl: typeof classifyGooglePage;
  extractPublisherUrlFromFinalUrlImpl: typeof extractPublisherUrlFromFinalUrl;
  extractPublisherUrlImpl: typeof extractPublisherUrl;
  fetchPublisherPageImpl: typeof fetchPublisherPage;
}): Promise<ArticleContent02WorkflowResult> => {
  try {
    const googleNavigation = await navigateGoogleUrlImpl(
      navigationSession.context,
      googleRssUrl,
      signal
    );

    const googleClassification = classifyGooglePageImpl({
      finalUrl: googleNavigation.finalUrl,
      html: googleNavigation.html
    });

    if (googleClassification.isBlocked) {
      return createGoogleFailureResult({
        article,
        googleFinalUrl: googleNavigation.finalUrl,
        googleStatusCode: googleNavigation.statusCode,
        details: googleClassification.details,
        failureType: googleClassification.failureType
      });
    }

    const extractedFromFinalUrl = extractPublisherUrlFromFinalUrlImpl(
      googleNavigation.finalUrl
    );
    const extractedFromHtml = extractPublisherUrlImpl({
      html: googleNavigation.html,
      baseUrl: googleNavigation.finalUrl || googleRssUrl
    });
    const extracted =
      extractedFromFinalUrl.publisherUrl !== null ? extractedFromFinalUrl : extractedFromHtml;

    if (!extracted.publisherUrl) {
      return {
        articleId: article.id,
        googleRssUrl,
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
    }

    const publisherResult = await fetchPublisherPageImpl({
      publisherUrl: extracted.publisherUrl,
      browserContext: navigationSession.context,
      signal
    });

    return {
      articleId: article.id,
      googleRssUrl,
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      articleId: article.id,
      googleRssUrl,
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
};

export const processArticleContent02Candidate = async (
  options: ProcessArticleContent02CandidateOptions,
  dependencies: EnrichArticleContent02Dependencies = {}
): Promise<ProcessArticleContent02CandidateResult> => {
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

  const article = options.article;
  const googleRssUrl = article.url?.trim() ?? '';

  if (!googleRssUrl) {
    logger.info('Skipping article content 02 scrape because Google RSS URL is missing', {
      articleId: article.id
    });
    return {
      skipped: true,
      persistenceAction: null,
      workflowResult: null
    };
  }

  const skipDecision = options.bypassExistingRowSkip
    ? {
        shouldSkip: false,
        reason: 'Bypassed existing-row skip for initial requestGoogleRss follow-up scrape',
        existingRow: null
      }
    : await getSkipDecision(article.id);

  if (skipDecision.shouldSkip) {
    logger.info('Skipping article content 02 scrape because a canonical row already exists', {
      articleId: article.id,
      existingArticleContents02Id: skipDecision.existingRow?.id ?? null
    });
    return {
      skipped: true,
      persistenceAction: null,
      workflowResult: null
    };
  }

  const ownsSession = !options.navigationSession;
  const navigationSession = options.navigationSession ?? (await createNavigationSession());

  try {
    const workflowResult = await runWithArticleTimeout(
      article,
      options.signal,
      (signal) =>
        buildArticleContent02WorkflowResult({
          article,
          googleRssUrl,
          signal,
          navigationSession,
          navigateGoogleUrlImpl,
          classifyGooglePageImpl,
          extractPublisherUrlFromFinalUrlImpl,
          extractPublisherUrlImpl,
          fetchPublisherPageImpl
        })
    );

    const persistenceResult = await persistResult(workflowResult);

    logger.info('Article content 02 workflow result persisted', {
      articleId: article.id,
      status: workflowResult.status,
      failureType: workflowResult.failureType,
      bodySource: workflowResult.bodySource,
      extractionSource: workflowResult.extractionSource,
      persistenceAction: persistenceResult.action
    });

    return {
      skipped: false,
      persistenceAction: persistenceResult.action,
      workflowResult
    };
  } finally {
    if (ownsSession) {
      await navigationSession.close();
    }
  }
};

export const enrichArticleContent02 = async (
  options: EnrichArticleContent02Options,
  dependencies: EnrichArticleContent02Dependencies = {}
): Promise<ArticleContent02WorkflowSummary> => {
  const createNavigationSession =
    dependencies.createNavigationSession ?? createGoogleNavigationSession;
  const summary = createEmptySummary();
  const navigationSessionManager = createGoogleNavigationSessionManager({
    createNavigationSession,
    logContext: {
      workflow: 'article-content-02-enrichment'
    }
  });

  try {
    for (const article of options.articles) {
      if (options.signal.aborted) {
        logger.warn('Article content 02 enrichment canceled', {
          remainingArticles: options.articles.length - summary.articlesConsidered
        });
        break;
      }

      summary.articlesConsidered += 1;

      const navigationSession = await navigationSessionManager.getSession();
      const result = await processArticleContent02Candidate(
        {
          article,
          signal: options.signal,
          navigationSession
        },
        dependencies
      );
      await navigationSessionManager.recordResult(result.workflowResult);

      if (result.skipped || !result.workflowResult) {
        summary.articlesSkipped += 1;
        continue;
      }

      if (result.workflowResult.status === 'success') {
        summary.successfulScrapes += 1;
      } else {
        summary.failedScrapes += 1;
      }

      if (result.persistenceAction === 'created') {
        summary.createdRows += 1;
      }

      if (result.persistenceAction === 'updated') {
        summary.updatedRows += 1;
      }
    }
  } finally {
    await navigationSessionManager.close();
  }

  logger.info('Article content 02 enrichment summary', summary);
  return summary;
};

export default enrichArticleContent02;
