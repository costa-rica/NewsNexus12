import type { BrowserContext, Page, Response } from 'playwright';
import logger from '../logger';
import { ARTICLE_CONTENT_MIN_LENGTH } from '../article-content/config';
import {
  ARTICLE_CONTENT_02_DEFAULT_HEADERS,
  ARTICLE_CONTENT_02_DESKTOP_USER_AGENT,
  ARTICLE_CONTENT_02_PUBLISHER_FETCH_RETRY_COUNT,
  ARTICLE_CONTENT_02_PUBLISHER_MIN_HTML_LENGTH,
  ARTICLE_CONTENT_02_PUBLISHER_NAVIGATION_TIMEOUT_MS,
  ARTICLE_CONTENT_02_PUBLISHER_POST_LOAD_WAIT_MS
} from './config';
import { parseArticleFields } from './articleParser';
import { classifyPublisherPage } from './publisherClassifier';
import { ArticleContent02BodySource, ArticleContent02FailureType } from './types';

export interface PublisherFetchResult {
  title: string | null;
  content: string | null;
  finalUrl: string | null;
  statusCode: number | null;
  bodySource: ArticleContent02BodySource;
  details: string;
  failureType: ArticleContent02FailureType | null;
}

export interface PublisherFetchDependencies {
  fetchImpl?: typeof fetch;
}

const looksIncomplete = (html: string): boolean => {
  const lower = html.toLowerCase();
  const contentLength = html.trim().length;

  if (contentLength < ARTICLE_CONTENT_02_PUBLISHER_MIN_HTML_LENGTH) {
    return true;
  }

  if (lower.includes('enable javascript') || lower.includes('please enable cookies')) {
    return true;
  }

  return false;
};

const hasUsableParsedContent = (content: string | null | undefined): boolean =>
  typeof content === 'string' && content.trim().length >= ARTICLE_CONTENT_MIN_LENGTH;

const toParsedResult = ({
  html,
  finalUrl,
  statusCode,
  bodySource,
  details,
  failureType
}: {
  html: string;
  finalUrl: string | null;
  statusCode: number | null;
  bodySource: ArticleContent02BodySource;
  details: string;
  failureType: ArticleContent02FailureType | null;
}): PublisherFetchResult => {
  const parsed = parseArticleFields(html);

  if (failureType) {
    return {
      title: parsed.title || null,
      content: hasUsableParsedContent(parsed.content) ? parsed.content : null,
      finalUrl,
      statusCode,
      bodySource,
      details,
      failureType
    };
  }

  if (!hasUsableParsedContent(parsed.content)) {
    return {
      title: parsed.title || null,
      content: parsed.content || null,
      finalUrl,
      statusCode,
      bodySource,
      details: `${details}; parsed content was shorter than minimum length`,
      failureType: 'short_content'
    };
  }

  return {
    title: parsed.title || null,
    content: parsed.content,
    finalUrl,
    statusCode,
    bodySource,
    details,
    failureType: null
  };
};

const fetchPublisherWithPlaywright = async ({
  browserContext,
  publisherUrl,
  directHtml,
  directStatusCode,
  directFinalUrl,
  signal
}: {
  browserContext: Pick<BrowserContext, 'newPage'>;
  publisherUrl: string;
  directHtml?: string;
  directStatusCode?: number | null;
  directFinalUrl?: string | null;
  signal?: AbortSignal;
}): Promise<PublisherFetchResult> => {
  const page = await browserContext.newPage();
  let abortHandler: (() => void) | null = null;

  if (signal) {
    abortHandler = () => {
      void page.close();
    };
    signal.addEventListener('abort', abortHandler, { once: true });
  }

  try {
    const response = (await page.goto(publisherUrl, {
      waitUntil: 'domcontentloaded',
      timeout: ARTICLE_CONTENT_02_PUBLISHER_NAVIGATION_TIMEOUT_MS
    })) as Response | null;
    await page.waitForTimeout(ARTICLE_CONTENT_02_PUBLISHER_POST_LOAD_WAIT_MS);

    const html = await page.content();
    const finalUrl = page.url();
    const publisherState = classifyPublisherPage({ finalUrl, html });

    if (publisherState.isBlocked) {
      return toParsedResult({
        html,
        finalUrl,
        statusCode: response?.status() ?? null,
        bodySource: 'playwright-publisher',
        details: publisherState.details,
        failureType: publisherState.failureType
      });
    }

    if (looksIncomplete(html) && directHtml) {
      return toParsedResult({
        html: directHtml,
        finalUrl: directFinalUrl ?? publisherUrl,
        statusCode: directStatusCode ?? null,
        bodySource: 'direct-http',
        details: 'Playwright fallback did not improve publisher HTML',
        failureType: null
      });
    }

    return toParsedResult({
      html,
      finalUrl,
      statusCode: response?.status() ?? null,
      bodySource: 'playwright-publisher',
      details: 'Playwright fallback returned publisher HTML',
      failureType: null
    });
  } finally {
    if (abortHandler) {
      signal?.removeEventListener('abort', abortHandler);
    }

    try {
      await page.close();
    } catch {
      // Ignore page cleanup failures after fallback completes.
    }
  }
};

const fetchPublisherPageOnce = async (
  {
    publisherUrl,
    browserContext,
    signal
  }: {
    publisherUrl: string;
    browserContext: Pick<BrowserContext, 'newPage'>;
    signal?: AbortSignal;
  },
  dependencies: PublisherFetchDependencies = {}
): Promise<PublisherFetchResult> => {
  const fetchImpl = dependencies.fetchImpl ?? fetch;

  const headers = {
    ...ARTICLE_CONTENT_02_DEFAULT_HEADERS,
    'User-Agent': ARTICLE_CONTENT_02_DESKTOP_USER_AGENT
  };

  const directResponse = await fetchImpl(publisherUrl, {
    headers,
    redirect: 'follow',
    signal
  });
  const body = await directResponse.text();
  const finalUrl = directResponse.url || publisherUrl;
  const directState = classifyPublisherPage({ finalUrl, html: body });

  if (directState.isBlocked) {
    return toParsedResult({
      html: body,
      finalUrl,
      statusCode: directResponse.status,
      bodySource: 'direct-http',
      details: directState.details,
      failureType: directState.failureType
    });
  }

  if (!looksIncomplete(body)) {
    return toParsedResult({
      html: body,
      finalUrl,
      statusCode: directResponse.status,
      bodySource: 'direct-http',
      details: 'Direct HTTP returned usable publisher HTML',
      failureType: null
    });
  }

  return fetchPublisherWithPlaywright({
    browserContext,
    publisherUrl,
    directHtml: body,
    directStatusCode: directResponse.status,
    directFinalUrl: finalUrl,
    signal
  });
};

export const fetchPublisherPage = async (
  {
    publisherUrl,
    browserContext,
    signal
  }: {
    publisherUrl: string;
    browserContext: Pick<BrowserContext, 'newPage'>;
    signal?: AbortSignal;
  },
  dependencies: PublisherFetchDependencies = {}
): Promise<PublisherFetchResult> => {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= ARTICLE_CONTENT_02_PUBLISHER_FETCH_RETRY_COUNT; attempt += 1) {
    try {
      const result = await fetchPublisherPageOnce(
        {
          publisherUrl,
          browserContext,
          signal
        },
        dependencies
      );

      if (attempt > 1) {
        result.details = `${result.details}; succeeded on retry ${attempt}`;
      }

      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      logger.warn('Publisher fetch attempt failed', {
        publisherUrl,
        attempt,
        retryCount: ARTICLE_CONTENT_02_PUBLISHER_FETCH_RETRY_COUNT,
        error: lastError.message
      });
    }
  }

  return {
    title: null,
    content: null,
    finalUrl: publisherUrl,
    statusCode: null,
    bodySource: 'none',
    details: lastError?.message ?? 'Publisher fetch failed',
    failureType: 'publisher_fetch_error'
  };
};

export default fetchPublisherPage;
