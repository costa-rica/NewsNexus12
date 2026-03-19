import { load } from 'cheerio';
import logger from '../logger';
import {
  ARTICLE_CONTENT_FETCH_REDIRECT,
  ARTICLE_CONTENT_FETCH_TIMEOUT_MS,
  ARTICLE_CONTENT_MIN_LENGTH,
  ARTICLE_CONTENT_PUPPETEER_TIMEOUT_MS,
  ARTICLE_CONTENT_USER_AGENT
} from './config';
import { ArticleContentScrapeResult } from './types';

const ARTICLE_SELECTORS = [
  'article',
  '[role="article"]',
  '.article-content',
  '.article-body',
  '.entry-content',
  'main',
  '.post-content',
  '.story-body',
  '.content'
];

const normalizeExtractedText = (value: string): string =>
  value
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n\n')
    .trim();

const extractArticleContentFromHtml = (html: string): string => {
  const $ = load(html);

  $('script, style, nav, header, footer, aside, .advertisement, .ad').remove();

  let articleElement = null;
  for (const selector of ARTICLE_SELECTORS) {
    const candidate = $(selector);
    if (candidate.length > 0) {
      articleElement = candidate;
      break;
    }
  }

  const container = articleElement && articleElement.length > 0 ? articleElement : $('body');
  const paragraphs: string[] = [];

  container.find('p').each((_, element) => {
    const text = normalizeExtractedText($(element).text());
    if (text !== '') {
      paragraphs.push(text);
    }
  });

  return normalizeExtractedText(paragraphs.join('\n\n'));
};

export const scrapeArticleContentWithCheerio = async (
  url: string,
  signal?: AbortSignal
): Promise<ArticleContentScrapeResult> => {
  try {
    logger.info('Scraping article content with Cheerio', {
      method: 'cheerio',
      timeoutMs: ARTICLE_CONTENT_FETCH_TIMEOUT_MS,
      url
    });

    const response = await fetch(url, {
      headers: {
        'User-Agent': ARTICLE_CONTENT_USER_AGENT
      },
      redirect: ARTICLE_CONTENT_FETCH_REDIRECT,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(ARTICLE_CONTENT_FETCH_TIMEOUT_MS)])
        : AbortSignal.timeout(ARTICLE_CONTENT_FETCH_TIMEOUT_MS)
    });

    if (!response.ok) {
      return {
        success: false,
        method: 'cheerio',
        failureType: 'http_error',
        error: `HTTP ${response.status} while fetching article`,
        scrapeStatusCheerio: false,
        scrapeStatusPuppeteer: null
      };
    }

    const html = await response.text();
    const normalizedContent = extractArticleContentFromHtml(html);

    if (normalizedContent.length < ARTICLE_CONTENT_MIN_LENGTH) {
      return {
        success: false,
        method: 'cheerio',
        failureType: 'short_content',
        error: `Content too short (${normalizedContent.length} chars, minimum ${ARTICLE_CONTENT_MIN_LENGTH})`,
        scrapeStatusCheerio: false,
        scrapeStatusPuppeteer: null
      };
    }

    return {
      success: true,
      method: 'cheerio',
      content: normalizedContent,
      contentLength: normalizedContent.length,
      scrapeStatusCheerio: true,
      scrapeStatusPuppeteer: null
    };
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);

    logger.warn('Cheerio scrape failed', {
      method: 'cheerio',
      url,
      error: message
    });

    return {
      success: false,
      method: 'cheerio',
      failureType: 'network_error',
      error: message,
      scrapeStatusCheerio: false,
      scrapeStatusPuppeteer: null
    };
  }
};

export const scrapeArticleContentWithPuppeteer = async (
  url: string,
  signal?: AbortSignal
): Promise<ArticleContentScrapeResult> => {
  let browser: any = null;
  let abortHandler: (() => Promise<void>) | null = null;

  try {
    logger.info('Scraping article content with Puppeteer fallback', {
      method: 'puppeteer',
      timeoutMs: ARTICLE_CONTENT_PUPPETEER_TIMEOUT_MS,
      url
    });

    const puppeteerModule = await import('puppeteer');
    const puppeteer = puppeteerModule.default;

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setUserAgent(ARTICLE_CONTENT_USER_AGENT);
    await page.setViewport({ width: 1440, height: 1200 });

    abortHandler = async () => {
      try {
        await page.close();
      } catch {
        // Ignore cleanup failures during cancellation.
      }
      try {
        await browser?.close();
      } catch {
        // Ignore cleanup failures during cancellation.
      }
    };

    signal?.addEventListener(
      'abort',
      () => {
        void abortHandler?.();
      },
      { once: true }
    );

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: ARTICLE_CONTENT_PUPPETEER_TIMEOUT_MS
    });

    const html = await page.content();
    const normalizedContent = extractArticleContentFromHtml(html);

    if (normalizedContent.length < ARTICLE_CONTENT_MIN_LENGTH) {
      return {
        success: false,
        method: 'puppeteer',
        failureType: 'short_content',
        error: `Content too short (${normalizedContent.length} chars, minimum ${ARTICLE_CONTENT_MIN_LENGTH})`,
        scrapeStatusCheerio: false,
        scrapeStatusPuppeteer: false
      };
    }

    return {
      success: true,
      method: 'puppeteer',
      content: normalizedContent,
      contentLength: normalizedContent.length,
      scrapeStatusCheerio: false,
      scrapeStatusPuppeteer: true
    };
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);

    logger.warn('Puppeteer scrape failed', {
      method: 'puppeteer',
      url,
      error: message
    });

    return {
      success: false,
      method: 'puppeteer',
      failureType: 'browser_error',
      error: message,
      scrapeStatusCheerio: false,
      scrapeStatusPuppeteer: false
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Ignore cleanup failures after the scrape completes.
      }
    }
  }
};

export interface ArticleContentScraperDependencies {
  scrapeWithCheerio?: typeof scrapeArticleContentWithCheerio;
  scrapeWithPuppeteer?: typeof scrapeArticleContentWithPuppeteer;
}

export const scrapeArticleContent = async (
  url: string,
  signal?: AbortSignal,
  dependencies: ArticleContentScraperDependencies = {}
): Promise<ArticleContentScrapeResult> => {
  const scrapeWithCheerio = dependencies.scrapeWithCheerio ?? scrapeArticleContentWithCheerio;
  const scrapeWithPuppeteer =
    dependencies.scrapeWithPuppeteer ?? scrapeArticleContentWithPuppeteer;

  const cheerioResult = await scrapeWithCheerio(url, signal);

  if (cheerioResult.success) {
    return cheerioResult;
  }

  logger.info('Cheerio scrape failed or returned short content. Trying Puppeteer fallback.', {
    url,
    error: cheerioResult.error,
    failureType: cheerioResult.failureType
  });

  return scrapeWithPuppeteer(url, signal);
};

export default scrapeArticleContent;
