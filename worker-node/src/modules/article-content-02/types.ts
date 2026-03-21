import { TargetArticleRecord } from '../articleTargeting';

export type ArticleContent02Status = 'success' | 'fail';

export type ArticleContent02FailureType =
  | 'blocked_google'
  | 'blocked_publisher'
  | 'no_publisher_url_found'
  | 'navigation_error'
  | 'publisher_fetch_error'
  | 'short_content';

export type ArticleContent02ExtractionSource =
  | 'final-url'
  | 'canonical'
  | 'og:url'
  | 'json-ld'
  | 'fallback-link'
  | 'none';

export type ArticleContent02BodySource =
  | 'direct-http'
  | 'playwright-publisher'
  | 'google-page'
  | 'none';

export interface ArticleContent02Candidate extends TargetArticleRecord {}

export interface ArticleContent02StoredRow {
  id: number;
  articleId: number;
  url: string | null;
  googleRssUrl: string;
  googleFinalUrl: string | null;
  publisherFinalUrl: string | null;
  title: string | null;
  content: string | null;
  status: ArticleContent02Status;
  failureType: ArticleContent02FailureType | null;
  details: string;
  extractionSource: ArticleContent02ExtractionSource;
  bodySource: ArticleContent02BodySource;
  googleStatusCode: number | null;
  publisherStatusCode: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CreateArticleContent02Input {
  articleId: number;
  url?: string | null;
  googleRssUrl: string;
  googleFinalUrl?: string | null;
  publisherFinalUrl?: string | null;
  title?: string | null;
  content?: string | null;
  status: ArticleContent02Status;
  failureType?: ArticleContent02FailureType | null;
  details?: string;
  extractionSource?: ArticleContent02ExtractionSource;
  bodySource?: ArticleContent02BodySource;
  googleStatusCode?: number | null;
  publisherStatusCode?: number | null;
}

export interface UpdateArticleContent02Input {
  url?: string | null;
  googleFinalUrl?: string | null;
  publisherFinalUrl?: string | null;
  title?: string | null;
  content?: string | null;
  status?: ArticleContent02Status;
  failureType?: ArticleContent02FailureType | null;
  details?: string;
  extractionSource?: ArticleContent02ExtractionSource;
  bodySource?: ArticleContent02BodySource;
  googleStatusCode?: number | null;
  publisherStatusCode?: number | null;
}

export interface ArticleContent02WorkflowResult {
  articleId: number;
  googleRssUrl: string;
  googleFinalUrl: string | null;
  publisherUrl: string | null;
  publisherFinalUrl: string | null;
  title: string | null;
  content: string | null;
  status: ArticleContent02Status;
  failureType: ArticleContent02FailureType | null;
  details: string;
  extractionSource: ArticleContent02ExtractionSource;
  bodySource: ArticleContent02BodySource;
  googleStatusCode: number | null;
  publisherStatusCode: number | null;
}

export interface ArticleContent02WorkflowSummary {
  articlesConsidered: number;
  articlesSkipped: number;
  successfulScrapes: number;
  failedScrapes: number;
  createdRows: number;
  updatedRows: number;
}
