import { TargetArticleRecord } from '../articleTargeting';

export type ArticleContentScrapeMethod = 'cheerio' | 'puppeteer';

export interface ArticleContentScrapeSuccess {
  success: true;
  method: ArticleContentScrapeMethod;
  content: string;
  contentLength: number;
  scrapeStatusCheerio: boolean;
  scrapeStatusPuppeteer: boolean | null;
}

export interface ArticleContentScrapeFailure {
  success: false;
  method: ArticleContentScrapeMethod;
  error: string;
  failureType: 'http_error' | 'network_error' | 'short_content' | 'browser_error';
  scrapeStatusCheerio: boolean;
  scrapeStatusPuppeteer: boolean | null;
}

export type ArticleContentScrapeResult =
  | ArticleContentScrapeSuccess
  | ArticleContentScrapeFailure;

export interface ArticleContentCandidate extends TargetArticleRecord {}

export interface ArticleContentCanonicalRow {
  id: number;
  articleId: number;
  content: string;
  scrapeStatusCheerio: boolean | null;
  scrapeStatusPuppeteer: boolean | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ArticleContentEnrichmentSummary {
  articlesConsidered: number;
  articlesSkipped: number;
  successfulScrapes: number;
  failedScrapes: number;
  updatedRows: number;
  createdRows: number;
}
