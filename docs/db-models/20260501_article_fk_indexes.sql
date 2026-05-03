-- Add child-side indexes for foreign keys that cascade from "Articles".
--
-- Run this on an existing Postgres database with psql. These statements use
-- CONCURRENTLY, so do not wrap the file in an explicit transaction.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_article_approveds_article_id
  ON "ArticleApproveds" ("articleId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_article_contents02_article_id
  ON "ArticleContents02" ("articleId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_article_duplicate_analyses_article_id_new
  ON "ArticleDuplicateAnalyses" ("articleIdNew");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_article_duplicate_analyses_article_id_approved
  ON "ArticleDuplicateAnalyses" ("articleIdApproved");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_article_is_relevants_article_id
  ON "ArticleIsRelevants" ("articleId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_article_keyword_contracts_article_id
  ON "ArticleKeywordContracts" ("articleId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_article_report_contracts_article_id
  ON "ArticleReportContracts" ("articleId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_article_revieweds_article_id
  ON "ArticleRevieweds" ("articleId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_article_state_contracts02_article_id
  ON "ArticleStateContracts02" ("articleId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_articles_approved02_article_id
  ON "ArticlesApproved02" ("articleId");
