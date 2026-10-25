import { parseStringPromise } from 'xml2js';
import {
  Article,
  EntityWhoFoundArticle,
  NewsApiRequest,
  NewsArticleAggregatorSource,
  ensureSchemaReady,
  initModels,
  sequelize
} from '@newsnexus/db-models';
import logger, { logWorkflowStart } from '../logger';
import { QueueExecutionContext } from '../queue/queueEngine';
import { createGoogleNavigationSession } from '../article-content-02/googleNavigator';
import { processArticleContent02Candidate } from '../article-content-02/enrichment';
import {
  createGoogleNavigationSessionManager,
  GoogleNavigationSessionManager
} from '../article-content-02/navigationSessionManager';
import {
  getArticleContent02SkipDecision,
  persistArticleContent02Result
} from '../article-content-02/persistence';
import {
  ArticleContent02Candidate,
  ArticleContent02WorkflowResult
} from '../article-content-02/types';
import { hasUsableArticleContent02 } from '../article-content-02/repository';
import {
  buildGoogleRssQuery,
  buildGoogleRssUrl,
  GoogleRssQueryRow,
  parseTimeRangeDays,
  readGoogleRssQuerySpreadsheet,
  getDefaultLimitDays,
} from '../google-rss/querySpreadsheet';

export const DEFAULT_REQUEST_GOOGLE_RSS_REPEAT_WINDOW_HOURS = 72;

const DEFAULT_RETRY_DELAY_MINUTES = 120;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const RSS_503_BODY_CAPTURE_LIMIT_BYTES = 1_048_576;

const RSS_HEADER_SUMMARY_KEYS = [
  'retry-after',
  'ratelimit',
  'ratelimit-policy',
  'ratelimit-limit',
  'ratelimit-remaining',
  'ratelimit-reset',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-rate-limit-limit',
  'x-rate-limit-remaining',
  'x-rate-limit-reset',
  'location',
  'content-type',
  'content-length',
  'content-encoding',
  'cache-control',
  'expires',
  'date',
  'server',
  'via',
  'x-request-id',
  'x-cloud-trace-context',
  'traceparent'
] as const;

export type RssHeaderSummary = Record<(typeof RSS_HEADER_SUMMARY_KEYS)[number], string | null> & {
  setCookieNames: string[];
  googlePrefixedHeaders: Record<string, string>;
};

interface RssItem {
  title?: string;
  description?: string;
  link?: string;
  pubDate?: string;
  source?: string;
  content?: string;
}

interface RssDiagnosticBody {
  text: string;
  byteLength: number;
  bodyTruncated: boolean;
  readError?: string;
}

interface RssFetchResult {
  status: 'success' | 'error';
  items: RssItem[];
  error?: string;
  statusCode?: number;
  statusText?: string;
  finalUrl?: string;
  redirected?: boolean;
  responseHeaders?: Record<string, string | string[]>;
  headerSummary?: RssHeaderSummary;
  diagnosticBody?: RssDiagnosticBody;
}

export type GoogleRssEndingReason =
  | 'queries_exhausted'
  | 'target_articles_collected'
  | 'rate_limited'
  | 'error'
  | 'canceled'
  | 'aborted';

export type GoogleRssQueryStatus = 'success' | 'skipped' | 'failed';

export interface GoogleRssQueryResult {
  id: number;
  and_keywords: string;
  and_exact_phrases: string;
  or_keywords: string;
  or_exact_phrases: string;
  time_range: string;
  status: GoogleRssQueryStatus;
  saved_articles: number;
  note: string | null;
}

export interface GoogleRssJobResult {
  endingReason: GoogleRssEndingReason;
  endingMessage: string;
  articlesAddedCount: number;
  queryResults: GoogleRssQueryResult[];
}

export interface RequestGoogleRssJobContext {
  jobId: string;
  spreadsheetPath: string;
  doNotRepeatRequestsWithinHours: number;
  targetArticlesAddedCount?: number;
  signal: AbortSignal;
  updateResult?: (result: Record<string, unknown>) => Promise<void>;
}

export interface RequestGoogleRssJobDependencies {
  runLegacyWorkflow?: (context: RequestGoogleRssJobContext) => Promise<void>;
}

export interface RequestGoogleRssJobInput {
  spreadsheetPath: string;
  doNotRepeatRequestsWithinHours: number;
  targetArticlesAddedCount?: number;
}

const GOOGLE_NEWS_RSS_ORG_NAME = 'Google News RSS';

let dbReadyPromise: Promise<void> | null = null;

const ensureDbReady = async (): Promise<void> => {
  if (dbReadyPromise) {
    return dbReadyPromise;
  }

  dbReadyPromise = (async () => {
    initModels();
    await ensureSchemaReady(sequelize);
  })();

  return dbReadyPromise;
};

export const verifySpreadsheetFileExists = async (spreadsheetPath: string): Promise<void> => {
  const fs = await import('node:fs/promises');

  try {
    const fileStat = await fs.stat(spreadsheetPath);
    if (!fileStat.isFile()) {
      throw new Error(`Spreadsheet path is not a file: ${spreadsheetPath}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Spreadsheet file not found: ${spreadsheetPath}`);
    }
    throw error;
  }
};


const stripHtml = (input: string): string => input.replace(/<[^>]*>/g, '').trim();

const normalizeWhitespace = (input: string): string => input.replace(/\s+/g, ' ').trim();

const extractAnchorText = (input: string): string | null => {
  const match = input.match(/<a[^>]*>(.*?)<\/a>/i);
  return match?.[1]?.trim() || null;
};

export const mapRssItems = (items: unknown[]): RssItem[] =>
  items.map((rawItem) => {
    const item = rawItem as Record<string, unknown>;
    const descriptionRaw = String((item.description as string[] | undefined)?.[0] ?? '');
    const anchorText = extractAnchorText(descriptionRaw);
    const description = anchorText || stripHtml(descriptionRaw) || descriptionRaw;
    const sourceValue = (item.source as Array<{ _: string } | string> | undefined)?.[0];
    const contentEncoded =
      (item['content:encoded'] as string[] | undefined)?.[0] ??
      (item.content as string[] | undefined)?.[0] ??
      '';

    return {
      title: (item.title as string[] | undefined)?.[0],
      description,
      link: (item.link as string[] | undefined)?.[0],
      pubDate: (item.pubDate as string[] | undefined)?.[0],
      source: typeof sourceValue === 'object' ? sourceValue._ : sourceValue,
      content: normalizeWhitespace(stripHtml(contentEncoded))
    };
  });

const normalizeRssSeedContent = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }

  const normalized = normalizeWhitespace(stripHtml(value));
  return normalized === '' ? null : normalized;
};

export const createRssSeedResult = (
  articleId: number,
  googleRssUrl: string,
  item: RssItem
): ArticleContent02WorkflowResult => {
  const seededContent = normalizeRssSeedContent(item.content);

  if (seededContent && hasUsableArticleContent02(seededContent)) {
    return {
      articleId,
      googleRssUrl,
      googleFinalUrl: null,
      publisherUrl: null,
      publisherFinalUrl: null,
      title: item.title ?? null,
      content: seededContent,
      status: 'success',
      failureType: null,
      details: 'Seeded from Google RSS item content',
      extractionSource: 'none',
      bodySource: 'rss-feed',
      googleStatusCode: null,
      publisherStatusCode: null
    };
  }

  return {
    articleId,
    googleRssUrl,
    googleFinalUrl: null,
    publisherUrl: null,
    publisherFinalUrl: null,
    title: item.title ?? null,
    content: seededContent,
    status: 'fail',
    failureType: seededContent ? 'short_content' : null,
    details: seededContent
      ? 'RSS item content too short; triggering Google-to-publisher scrape'
      : 'RSS item content missing; triggering Google-to-publisher scrape',
    extractionSource: 'none',
    bodySource: seededContent ? 'rss-feed' : 'none',
    googleStatusCode: null,
    publisherStatusCode: null
  };
};

export const buildRssHeaderSummary = (headers: Headers): RssHeaderSummary => {
  const googlePrefixedHeaders: Record<string, string> = {};
  headers.forEach((value, name) => {
    // 'x-goog' also matches 'x-google-*' names.
    if (name.toLowerCase().startsWith('x-goog')) {
      googlePrefixedHeaders[name.toLowerCase()] = value;
    }
  });

  const keyedValues = Object.fromEntries(
    RSS_HEADER_SUMMARY_KEYS.map((key) => [key, headers.get(key)])
  ) as Record<(typeof RSS_HEADER_SUMMARY_KEYS)[number], string | null>;

  return {
    ...keyedValues,
    setCookieNames: headers.getSetCookie().map((cookie) => cookie.split('=')[0].trim()),
    googlePrefixedHeaders
  };
};

const collectResponseHeaders = (headers: Headers): Record<string, string | string[]> => {
  const collected: Record<string, string | string[]> = {};
  headers.forEach((value, name) => {
    if (name !== 'set-cookie') {
      collected[name] = value;
    }
  });

  const setCookies = headers.getSetCookie();
  if (setCookies.length > 0) {
    collected['set-cookie'] = setCookies;
  }
  return collected;
};

const readBodyWithCap = async (response: Response, capBytes: number): Promise<RssDiagnosticBody> => {
  if (!response.body) {
    return { text: '', byteLength: 0, bodyTruncated: false };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  let bodyTruncated = false;
  let readError: string | undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      const remaining = capBytes - byteLength;
      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, remaining));
        byteLength += remaining;
        bodyTruncated = true;
        await reader.cancel().catch(() => undefined);
        break;
      }

      chunks.push(value);
      byteLength += value.byteLength;
    }
  } catch (error) {
    readError = error instanceof Error ? error.message : 'Unknown body read error';
  }

  return {
    text: new TextDecoder('utf-8').decode(Buffer.concat(chunks)),
    byteLength,
    bodyTruncated,
    ...(readError ? { readError } : {})
  };
};

const fetchRssItems = async (
  url: string,
  signal: AbortSignal,
  options: { captureResponseDetails: boolean } = { captureResponseDetails: false }
): Promise<RssFetchResult> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    signal.addEventListener(
      'abort',
      () => {
        controller.abort();
      },
      { once: true }
    );

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'NewsNexusRequesterGoogleRss04/1.0'
      }
    });

    // A 503 body is captured for diagnostics, so its read stays under the same timeout.
    if (response.status !== 503) {
      clearTimeout(timeout);
    }

    const responseDetails =
      response.status === 503 || options.captureResponseDetails
        ? {
            statusText: response.statusText,
            finalUrl: response.url,
            redirected: response.redirected,
            responseHeaders: collectResponseHeaders(response.headers),
            headerSummary: buildRssHeaderSummary(response.headers)
          }
        : {};

    if (!response.ok) {
      const errorMessage = `RSS request failed with status ${response.status}`;
      logger.error(errorMessage);
      const diagnosticBody =
        response.status === 503
          ? await readBodyWithCap(response, RSS_503_BODY_CAPTURE_LIMIT_BYTES)
          : undefined;
      return {
        status: 'error',
        items: [],
        error: errorMessage,
        statusCode: response.status,
        ...responseDetails,
        ...(diagnosticBody ? { diagnosticBody } : {})
      };
    }

    const xml = await response.text();
    const parsed = (await parseStringPromise(xml, { explicitArray: true })) as {
      rss?: { channel?: Array<{ item?: unknown[] }> };
    };
    const items = parsed?.rss?.channel?.[0]?.item || [];
    return {
      status: 'success',
      items: mapRssItems(items),
      statusCode: response.status,
      ...responseDetails
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown RSS fetch error';
    logger.error(`RSS request error: ${message}`);
    return {
      status: 'error',
      items: [],
      error: message
    };
  } finally {
    clearTimeout(timeout);
  }
};

const logRss503Diagnostics = (params: {
  queryId: number;
  jobId: string;
  attempt: number;
  requestUrl: string;
  outcome: string;
  response: RssFetchResult;
}): void => {
  const { response } = params;
  // Winston's format.timestamp() owns the `timestamp` key, so the capture time uses `capturedAt`.
  const capturedAt = new Date().toISOString();

  logger.error('RSS 503 header summary', {
    queryId: params.queryId,
    jobId: params.jobId,
    attempt: params.attempt,
    capturedAt,
    status: response.statusCode,
    statusText: response.statusText,
    finalUrl: response.finalUrl,
    redirected: response.redirected,
    outcome: params.outcome,
    headerSummary: response.headerSummary
  });

  logger.error('RSS 503 full response', {
    queryId: params.queryId,
    jobId: params.jobId,
    attempt: params.attempt,
    capturedAt,
    requestUrl: params.requestUrl,
    finalUrl: response.finalUrl,
    redirected: response.redirected,
    status: response.statusCode,
    statusText: response.statusText,
    responseHeaders: response.responseHeaders,
    body: response.diagnosticBody?.text,
    bodyByteLength: response.diagnosticBody?.byteLength,
    bodyTruncated: response.diagnosticBody?.bodyTruncated,
    ...(response.diagnosticBody?.readError ? { bodyReadError: response.diagnosticBody.readError } : {})
  });
};

const ensureAggregatorSourceAndEntity = async (): Promise<{
  newsArticleAggregatorSourceId: number;
  entityWhoFoundArticleId: number;
}> => {
  let source = await NewsArticleAggregatorSource.findOne({
    where: { nameOfOrg: GOOGLE_NEWS_RSS_ORG_NAME }
  });

  if (!source) {
    source = await NewsArticleAggregatorSource.create({
      nameOfOrg: GOOGLE_NEWS_RSS_ORG_NAME,
      isRss: true,
      isApi: false
    });
  }

  let entity = await EntityWhoFoundArticle.findOne({
    where: { newsArticleAggregatorSourceId: source.id }
  });

  if (!entity) {
    entity = await EntityWhoFoundArticle.create({
      newsArticleAggregatorSourceId: source.id
    });
  }

  return {
    newsArticleAggregatorSourceId: source.id,
    entityWhoFoundArticleId: entity.id
  };
};

const wasRequestMadeRecently = async (url: string, doNotRepeatRequestsWithinHours: number): Promise<boolean> => {
  const existing = await NewsApiRequest.findOne({
    where: {
      url
    },
    order: [['createdAt', 'DESC']]
  });

  if (!existing) {
    return false;
  }

  const thresholdTime = Date.now() - doNotRepeatRequestsWithinHours * 60 * 60 * 1000;
  return existing.createdAt.getTime() >= thresholdTime;
};

const storeRequestAndArticles = async (params: {
  requestUrl: string;
  andString: string | null;
  orString: string | null;
  status: 'success' | 'error';
  items: RssItem[];
  newsArticleAggregatorSourceId: number;
  entityWhoFoundArticleId: number;
  signal: AbortSignal;
  navigationSessionManager: GoogleNavigationSessionManager;
  timeRange: string;
}): Promise<number> => {
  const cutoffDays = parseTimeRangeDays(params.timeRange) ?? getDefaultLimitDays();
  const cutoffMs = Date.now() - cutoffDays * 24 * 60 * 60 * 1000;

  const dateEndOfRequest = new Date().toISOString().split('T')[0];

  const request = await NewsApiRequest.create({
    newsArticleAggregatorSourceId: params.newsArticleAggregatorSourceId,
    dateEndOfRequest,
    countOfArticlesReceivedFromRequest: params.items.length,
    status: params.status,
    url: params.requestUrl,
    andString: params.andString,
    orString: params.orString,
    notString: null,
    isFromAutomation: true
  });

  let savedCount = 0;

  for (const item of params.items) {
    if (!item.link) {
      continue;
    }

    if (item.pubDate) {
      const parsedDate = new Date(item.pubDate);
      if (Number.isNaN(parsedDate.getTime())) {
        logger.info('Accepting RSS item with unparseable pubDate', {
          url: item.link,
          pubDate: item.pubDate
        });
      } else if (parsedDate.getTime() < cutoffMs) {
        logger.info('Skipping RSS item older than cutoff', {
          url: item.link,
          pubDate: item.pubDate,
          cutoffDays
        });
        continue;
      }
    } else {
      logger.info('Accepting RSS item with missing pubDate', { url: item.link });
    }

    const existing = await Article.findOne({ where: { url: item.link } });
    if (existing) {
      continue;
    }

    const article = await Article.create({
      publicationName: item.source ?? null,
      title: item.title ?? null,
      description: item.description ?? null,
      url: item.link,
      publishedDate: item.pubDate ?? null,
      entityWhoFoundArticleId: params.entityWhoFoundArticleId,
      newsApiRequestId: request.id
    });

    savedCount += 1;

    const skipDecision = await getArticleContent02SkipDecision(article.id);
    if (skipDecision.shouldSkip) {
      logger.info('Skipping requestGoogleRss ArticleContents02 persistence', {
        articleId: article.id,
        existingArticleContents02Id: skipDecision.existingRow?.id ?? null
      });
      continue;
    }

    const seedResult = createRssSeedResult(article.id, item.link, item);
    await persistArticleContent02Result(seedResult);

    if (seedResult.status === 'fail') {
      const articleCandidate: ArticleContent02Candidate = {
        id: article.id,
        title: article.title ?? '',
        description: article.description ?? '',
        url: article.url ?? '',
        publishedDate: article.publishedDate ?? ''
      };

      const navigationSession = await params.navigationSessionManager.getSession();
      const result = await processArticleContent02Candidate(
        {
          article: articleCandidate,
          signal: params.signal,
          navigationSession,
          bypassExistingRowSkip: true
        }
      );
      await params.navigationSessionManager.recordResult(result.workflowResult);
    }
  }

  await request.update({
    countOfArticlesSavedToDbFromRequest: savedCount
  });

  logger.info(`Stored ${savedCount} new articles for request ${request.id} (${params.items.length} received).`);
  return savedCount;
};

const delay = async (ms: number, signal: AbortSignal): Promise<void> => {
  if (signal.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });
};

const runLegacyWorkflow = async (context: RequestGoogleRssJobContext): Promise<void> => {
  logWorkflowStart('Request Google RSS', {
    jobId: context.jobId,
    spreadsheetPath: context.spreadsheetPath,
    doNotRepeatRequestsWithinHours: context.doNotRepeatRequestsWithinHours,
    targetArticlesAddedCount: context.targetArticlesAddedCount
  });

  const delayBetweenRequestsMs = (() => {
    const envValue = process.env.MILISECONDS_IN_BETWEEN_REQUESTS;
    if (!envValue) {
      return 5000;
    }
    const parsed = Number.parseInt(envValue, 10);
    if (Number.isNaN(parsed) || parsed < 500 || parsed > 10000) {
      const message = `Invalid MILISECONDS_IN_BETWEEN_REQUESTS: ${envValue}. Must be between 500 and 10000.`;
      logger.error(message);
      return 5000;
    }
    return parsed;
  })();

  const retryDelayMinutes = (() => {
    const envValue = process.env.MINUTES_IN_BETWEEN_REQUESTS_RETRY;
    if (!envValue || envValue.trim() === '') {
      return DEFAULT_RETRY_DELAY_MINUTES;
    }
    const parsed = Number(envValue);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed * 60_000 > MAX_TIMER_DELAY_MS) {
      logger.warn(
        `Invalid MINUTES_IN_BETWEEN_REQUESTS_RETRY: ${envValue}. Must be a positive number of minutes. Using ${DEFAULT_RETRY_DELAY_MINUTES}.`
      );
      return DEFAULT_RETRY_DELAY_MINUTES;
    }
    return parsed;
  })();
  const retryDelayMs = Math.round(retryDelayMinutes * 60_000);

  logger.info(
    `Delay between requests: ${delayBetweenRequestsMs}ms (${(delayBetweenRequestsMs / 1000).toFixed(1)}s)`
  );
  logger.info(`Delay before HTTP 503 retry: ${retryDelayMinutes} minutes`);

  await ensureDbReady();

  const { newsArticleAggregatorSourceId, entityWhoFoundArticleId } =
    await ensureAggregatorSourceAndEntity();
  const navigationSessionManager = createGoogleNavigationSessionManager({
    createNavigationSession: createGoogleNavigationSession,
    logContext: {
      workflow: 'request-google-rss',
      jobId: context.jobId
    }
  });

  let articlesAddedCount = 0;
  let endingReason: GoogleRssEndingReason = 'queries_exhausted';
  let endingMessage = 'All queries processed successfully.';
  let queryResults: GoogleRssQueryResult[] = [];
  let currentRowIndex = -1;

  try {
    const rows = await readGoogleRssQuerySpreadsheet(context.spreadsheetPath);
    logger.info(`Loaded ${rows.length} query rows from spreadsheet.`);

    queryResults = rows.map((row) => ({
      id: row.id,
      and_keywords: row.and_keywords,
      and_exact_phrases: row.and_exact_phrases,
      or_keywords: row.or_keywords,
      or_exact_phrases: row.or_exact_phrases,
      time_range: row.time_range,
      status: 'skipped',
      saved_articles: 0,
      note: 'not_reached'
    }));

    for (let i = 0; i < rows.length; i += 1) {
      currentRowIndex = i;
      const row = rows[i];

      if (context.signal.aborted) {
        queryResults[i] = {
          ...queryResults[i],
          status: 'skipped',
          saved_articles: 0,
          note: 'canceled'
        };
        endingReason = 'canceled';
        endingMessage = 'Job was canceled before processing all queries.';
        break;
      }

      const queryResult = buildGoogleRssQuery(row);
      const requestUrl = queryResult.query ? buildGoogleRssUrl(queryResult.query) : null;

      if (!queryResult.query) {
        queryResults[i] = {
          ...queryResults[i],
          status: 'skipped',
          saved_articles: 0,
          note: 'empty_query'
        };
        logger.warn(`Skipping row ${row.id}: empty query.`);
        continue;
      }

      if (!requestUrl) {
        throw new Error(`Failed to build Google RSS request URL for row ${row.id}.`);
      }

      const alreadyRequested = await wasRequestMadeRecently(
        requestUrl,
        context.doNotRepeatRequestsWithinHours
      );
      if (alreadyRequested) {
        queryResults[i] = {
          ...queryResults[i],
          status: 'skipped',
          saved_articles: 0,
          note: 'repeat_window'
        };
        logger.info(
          `Skipping RSS request (id: ${row.id}): already requested within the last ${context.doNotRepeatRequestsWithinHours} hours: ${requestUrl}`
        );
        continue;
      }

      const timeRangeNote = queryResult.timeRangeInvalid ? ' - invalid time_range' : '';
      logger.info(
        `Requesting RSS (id: ${row.id}, ${queryResult.timeRange}${timeRangeNote}): ${requestUrl}`
      );

      let attempt = 1;
      let response = await fetchRssItems(requestUrl, context.signal);

      if (!context.signal.aborted && response.statusCode === 503) {
        logRss503Diagnostics({
          queryId: row.id,
          jobId: context.jobId,
          attempt,
          requestUrl,
          outcome: `retry_scheduled_in_${retryDelayMinutes}_minutes`,
          response
        });
        logger.error('RSS request returned HTTP 503; scheduling one retry', {
          queryId: row.id,
          jobId: context.jobId,
          attempt,
          retryDelayMinutes
        });

        await delay(retryDelayMs, context.signal);

        if (context.signal.aborted) {
          queryResults[i] = {
            ...queryResults[i],
            status: 'skipped',
            saved_articles: 0,
            note: 'canceled'
          };
          endingReason = 'canceled';
          endingMessage = 'Job was canceled during the HTTP 503 retry wait.';
          break;
        }

        attempt = 2;
        response = await fetchRssItems(requestUrl, context.signal, { captureResponseDetails: true });
      }

      if (context.signal.aborted) {
        queryResults[i] = {
          ...queryResults[i],
          status: 'skipped',
          saved_articles: 0,
          note: 'canceled'
        };
        endingReason = 'canceled';
        endingMessage = 'Job was canceled during RSS fetch.';
        break;
      }

      if (response.statusCode === 503) {
        logRss503Diagnostics({
          queryId: row.id,
          jobId: context.jobId,
          attempt,
          requestUrl,
          outcome: 'retry_exhausted',
          response
        });
        queryResults[i] = {
          ...queryResults[i],
          status: 'failed',
          saved_articles: 0,
          note: 'rate_limited'
        };
        endingReason = 'rate_limited';
        endingMessage = `HTTP 503 Service Unavailable (id: ${row.id}): ${requestUrl}. One retry after ${retryDelayMinutes} minutes also returned HTTP 503.`;
        logger.error(endingMessage);
        break;
      }

      if (attempt === 2 && response.status === 'success') {
        logger.info('RSS request recovered after HTTP 503 retry', {
          queryId: row.id,
          jobId: context.jobId,
          attempt,
          status: response.statusCode,
          responseHeaders: response.responseHeaders,
          headerSummary: response.headerSummary
        });
      }

      const savedThisRequest = await storeRequestAndArticles({
        requestUrl,
        andString: queryResult.andString,
        orString: queryResult.orString,
        status: response.status,
        items: response.items,
        newsArticleAggregatorSourceId,
        entityWhoFoundArticleId,
        signal: context.signal,
        navigationSessionManager,
        timeRange: queryResult.timeRange
      });
      articlesAddedCount += savedThisRequest;

      if (response.status === 'error') {
        queryResults[i] = {
          ...queryResults[i],
          status: 'failed',
          saved_articles: 0,
          note: `rss_fetch_error: ${response.error ?? 'unknown error'}`
        };
      } else {
        queryResults[i] = {
          ...queryResults[i],
          status: 'success',
          saved_articles: savedThisRequest,
          note: queryResult.timeRangeInvalid ? 'time_range_invalid' : null
        };
      }

      if (
        context.targetArticlesAddedCount !== undefined &&
        articlesAddedCount >= context.targetArticlesAddedCount
      ) {
        endingReason = 'target_articles_collected';
        endingMessage = `Collected ${articlesAddedCount} articles, meeting target ${context.targetArticlesAddedCount}.`;
        logger.info(endingMessage);
        break;
      }

      await delay(delayBetweenRequestsMs, context.signal);

      if (context.signal.aborted) {
        endingReason = 'canceled';
        endingMessage = 'Job was canceled after processing a query.';
        break;
      }
    }
  } catch (error) {
    endingReason = 'error';
    endingMessage = error instanceof Error ? error.message : 'Unknown error occurred.';
    logger.error(`requestGoogleRss job failed: ${endingMessage}`);
    if (currentRowIndex >= 0 && currentRowIndex < queryResults.length) {
      queryResults[currentRowIndex] = {
        ...queryResults[currentRowIndex],
        status: 'failed',
        saved_articles: 0,
        note: `error: ${endingMessage}`
      };
    }
  } finally {
    await navigationSessionManager.close();

    const result: GoogleRssJobResult = {
      endingReason,
      endingMessage,
      articlesAddedCount,
      queryResults
    };
    logger.info('requestGoogleRss job ending', result);
    await context.updateResult?.(result as unknown as Record<string, unknown>);
  }
};

export const createRequestGoogleRssJobHandler = (
  input: RequestGoogleRssJobInput,
  dependencies: RequestGoogleRssJobDependencies = {}
) => {
  const workflowRunner = dependencies.runLegacyWorkflow ?? runLegacyWorkflow;

  return async (queueContext: QueueExecutionContext): Promise<void> => {
    await verifySpreadsheetFileExists(input.spreadsheetPath);

    await workflowRunner({
      jobId: queueContext.jobId,
      spreadsheetPath: input.spreadsheetPath,
      doNotRepeatRequestsWithinHours: input.doNotRepeatRequestsWithinHours,
      ...(input.targetArticlesAddedCount !== undefined
        ? { targetArticlesAddedCount: input.targetArticlesAddedCount }
        : {}),
      signal: queueContext.signal,
      updateResult: queueContext.updateResult
    });
  };
};
