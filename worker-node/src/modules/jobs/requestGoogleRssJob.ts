import ExcelJS from 'exceljs';
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
import {
  GoogleNavigationSession,
  createGoogleNavigationSession
} from '../article-content-02/googleNavigator';
import { processArticleContent02Candidate } from '../article-content-02/enrichment';
import {
  getArticleContent02SkipDecision,
  persistArticleContent02Result
} from '../article-content-02/persistence';
import {
  ArticleContent02Candidate,
  ArticleContent02WorkflowResult
} from '../article-content-02/types';
import { hasUsableArticleContent02 } from '../article-content-02/repository';

export const DEFAULT_REQUEST_GOOGLE_RSS_REPEAT_WINDOW_HOURS = 72;

interface QueryRow {
  id: number;
  and_keywords: string;
  and_exact_phrases: string;
  or_keywords: string;
  or_exact_phrases: string;
  time_range: string;
}

interface QueryBuildResult {
  query: string;
  andString: string | null;
  orString: string | null;
  timeRange: string;
  timeRangeInvalid: boolean;
}

interface RssItem {
  title?: string;
  description?: string;
  link?: string;
  pubDate?: string;
  source?: string;
  content?: string;
}

interface RssFetchResult {
  status: 'success' | 'error';
  items: RssItem[];
  error?: string;
  statusCode?: number;
}

export interface RequestGoogleRssJobContext {
  jobId: string;
  spreadsheetPath: string;
  doNotRepeatRequestsWithinHours: number;
  signal: AbortSignal;
}

export interface RequestGoogleRssJobDependencies {
  runLegacyWorkflow?: (context: RequestGoogleRssJobContext) => Promise<void>;
}

export interface RequestGoogleRssJobInput {
  spreadsheetPath: string;
  doNotRepeatRequestsWithinHours: number;
}

const REQUIRED_HEADERS = [
  'id',
  'and_keywords',
  'and_exact_phrases',
  'or_keywords',
  'or_exact_phrases',
  'time_range'
] as const;

const GOOGLE_NEWS_RSS_ORG_NAME = 'Google News RSS';
const DEFAULT_TIME_RANGE = '180d';

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

const toCellString = (value: ExcelJS.CellValue | null | undefined): string => {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object' && 'text' in value) {
    return String(value.text).trim();
  }
  return String(value).trim();
};

const splitCsv = (value?: string): string[] => {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
};

const normalizeTerm = (term: string): string => {
  const trimmed = term.trim();
  if (!trimmed) {
    return '';
  }
  const hasQuotes =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"));
  if (hasQuotes) {
    return trimmed;
  }
  if (trimmed.includes(' ')) {
    return `"${trimmed}"`;
  }
  return trimmed;
};

const normalizeTimeRange = (value?: string): { timeRange: string; timeRangeInvalid: boolean } => {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    return { timeRange: DEFAULT_TIME_RANGE, timeRangeInvalid: false };
  }
  if (!/^\d+d$/.test(trimmed)) {
    return { timeRange: DEFAULT_TIME_RANGE, timeRangeInvalid: true };
  }
  const days = Number.parseInt(trimmed.slice(0, -1), 10);
  if (!Number.isFinite(days) || days <= 0) {
    return { timeRange: DEFAULT_TIME_RANGE, timeRangeInvalid: true };
  }
  return { timeRange: trimmed, timeRangeInvalid: false };
};

const combineForDb = (keywords?: string, exactPhrases?: string): string | null => {
  const parts = [...splitCsv(keywords), ...splitCsv(exactPhrases)];
  if (parts.length === 0) {
    return null;
  }
  return parts.join(', ');
};

const buildQuery = (row: QueryRow): QueryBuildResult => {
  const andKeywords = splitCsv(row.and_keywords);
  const andExact = splitCsv(row.and_exact_phrases);
  const orKeywords = splitCsv(row.or_keywords);
  const orExact = splitCsv(row.or_exact_phrases);

  const andTerms = [...andKeywords, ...andExact].map(normalizeTerm).filter(Boolean);
  const orTerms = [...orKeywords, ...orExact].map(normalizeTerm).filter(Boolean);

  const queryParts: string[] = [];
  if (andTerms.length > 0) {
    queryParts.push(andTerms.join(' '));
  }
  if (orTerms.length > 0) {
    const orExpression = orTerms.join(' OR ');
    queryParts.push(andTerms.length > 0 && orTerms.length > 1 ? `(${orExpression})` : orExpression);
  }

  const { timeRange, timeRangeInvalid } = normalizeTimeRange(row.time_range);
  queryParts.push(`when:${timeRange}`);

  return {
    query: queryParts.join(' ').trim(),
    andString: combineForDb(row.and_keywords, row.and_exact_phrases),
    orString: combineForDb(row.or_keywords, row.or_exact_phrases),
    timeRange,
    timeRangeInvalid
  };
};

const buildRssUrl = (query: string): string => {
  const baseUrl = 'https://news.google.com/rss/search';
  const params = new URLSearchParams({ q: query });

  const hl = process.env.GOOGLE_RSS_HL || 'en-US';
  const gl = process.env.GOOGLE_RSS_GL || 'US';
  const ceid = process.env.GOOGLE_RSS_CEID || 'US:en';

  params.set('hl', hl);
  params.set('gl', gl);
  params.set('ceid', ceid);

  return `${baseUrl}?${params.toString()}`;
};

const readQuerySpreadsheet = async (filePath: string): Promise<QueryRow[]> => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('Spreadsheet has no worksheets.');
  }

  const headerRow = worksheet.getRow(1);
  const headerMap = new Map<string, number>();

  headerRow.eachCell((cell, colNumber) => {
    const header = toCellString(cell.value).toLowerCase();
    if (header) {
      headerMap.set(header, colNumber);
    }
  });

  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headerMap.has(header));
  if (missingHeaders.length > 0) {
    throw new Error(`Spreadsheet missing required columns: ${missingHeaders.join(', ')}`);
  }

  const rows: QueryRow[] = [];
  for (let rowIndex = 2; rowIndex <= worksheet.rowCount; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    const rowValues = {
      id: toCellString(row.getCell(headerMap.get('id')!).value),
      and_keywords: toCellString(row.getCell(headerMap.get('and_keywords')!).value),
      and_exact_phrases: toCellString(row.getCell(headerMap.get('and_exact_phrases')!).value),
      or_keywords: toCellString(row.getCell(headerMap.get('or_keywords')!).value),
      or_exact_phrases: toCellString(row.getCell(headerMap.get('or_exact_phrases')!).value),
      time_range: toCellString(row.getCell(headerMap.get('time_range')!).value)
    };

    const hasAnyValue = Object.values(rowValues).some((value) => value);
    if (!hasAnyValue) {
      continue;
    }

    const idNumber = Number.parseInt(rowValues.id, 10);
    if (Number.isNaN(idNumber) || !rowValues.id) {
      throw new Error(
        `Missing or invalid id in row ${rowIndex}. All rows must have a valid numeric id.`
      );
    }

    rows.push({
      id: idNumber,
      and_keywords: rowValues.and_keywords,
      and_exact_phrases: rowValues.and_exact_phrases,
      or_keywords: rowValues.or_keywords,
      or_exact_phrases: rowValues.or_exact_phrases,
      time_range: rowValues.time_range
    });
  }

  return rows;
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

const fetchRssItems = async (url: string, signal: AbortSignal): Promise<RssFetchResult> => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

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

    clearTimeout(timeout);

    if (!response.ok) {
      const errorMessage = `RSS request failed with status ${response.status}`;
      logger.error(errorMessage);
      return {
        status: 'error',
        items: [],
        error: errorMessage,
        statusCode: response.status
      };
    }

    const xml = await response.text();
    const parsed = (await parseStringPromise(xml, { explicitArray: true })) as {
      rss?: { channel?: Array<{ item?: unknown[] }> };
    };
    const items = parsed?.rss?.channel?.[0]?.item || [];
    return {
      status: 'success',
      items: mapRssItems(items)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown RSS fetch error';
    logger.error(`RSS request error: ${message}`);
    return {
      status: 'error',
      items: [],
      error: message
    };
  }
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
  navigationSession: GoogleNavigationSession;
}): Promise<void> => {
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

      await processArticleContent02Candidate(
        {
          article: articleCandidate,
          signal: params.signal,
          navigationSession: params.navigationSession,
          bypassExistingRowSkip: true
        }
      );
    }
  }

  await request.update({
    countOfArticlesSavedToDbFromRequest: savedCount
  });

  logger.info(`Stored ${savedCount} new articles for request ${request.id} (${params.items.length} received).`);
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
    doNotRepeatRequestsWithinHours: context.doNotRepeatRequestsWithinHours
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

  logger.info(
    `Delay between requests: ${delayBetweenRequestsMs}ms (${(delayBetweenRequestsMs / 1000).toFixed(1)}s)`
  );

  await ensureDbReady();

  const { newsArticleAggregatorSourceId, entityWhoFoundArticleId } =
    await ensureAggregatorSourceAndEntity();
  const navigationSession = await createGoogleNavigationSession();

  try {
    const rows = await readQuerySpreadsheet(context.spreadsheetPath);
    logger.info(`Loaded ${rows.length} query rows from spreadsheet.`);

    for (const row of rows) {
      if (context.signal.aborted) {
        return;
      }

      const queryResult = buildQuery(row);
      if (!queryResult.query) {
        logger.warn(`Skipping row ${row.id}: empty query.`);
        continue;
      }

      const requestUrl = buildRssUrl(queryResult.query);
      const alreadyRequested = await wasRequestMadeRecently(
        requestUrl,
        context.doNotRepeatRequestsWithinHours
      );
      if (alreadyRequested) {
        logger.info(
          `Skipping RSS request (id: ${row.id}): already requested within the last ${context.doNotRepeatRequestsWithinHours} hours: ${requestUrl}`
        );
        continue;
      }

      const timeRangeNote = queryResult.timeRangeInvalid ? ' - invalid time_range' : '';
      logger.info(
        `Requesting RSS (id: ${row.id}, ${queryResult.timeRange}${timeRangeNote}): ${requestUrl}`
      );

      const response = await fetchRssItems(requestUrl, context.signal);
      if (response.statusCode === 503) {
        const message = `HTTP 503 Service Unavailable (id: ${row.id}): ${requestUrl}. Google RSS rate limit likely exceeded. Try increasing MILISECONDS_IN_BETWEEN_REQUESTS (current: ${delayBetweenRequestsMs}ms).`;
        logger.error(message);
        throw new Error(message);
      }

      await storeRequestAndArticles({
        requestUrl,
        andString: queryResult.andString,
        orString: queryResult.orString,
        status: response.status,
        items: response.items,
        newsArticleAggregatorSourceId,
        entityWhoFoundArticleId,
        signal: context.signal,
        navigationSession
      });

      await delay(delayBetweenRequestsMs, context.signal);
    }
  } finally {
    await navigationSession.close();
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
      signal: queueContext.signal
    });
  };
};
