import { ArticleContents02 } from "@newsnexus/db-models";

const ARTICLE_CONTENT_MIN_LENGTH = 200;

export type ArticleContents02SeedBodySource = "rss-feed" | "aggregator-feed";

export type ArticleContents02SeedResult = "skip" | "success" | "needs-scrape";

export type ArticleContents02SeedInput = {
  articleId: number;
  discoveryUrl: string;
  title?: string | null;
  content?: string | null;
  successDetails: string;
  missingDetails: string;
  shortDetails: string;
  bodySource: ArticleContents02SeedBodySource;
  extractionSource?: "final-url" | "none";
  resolvedUrl?: string | null;
};

export const normalizeWhitespace = (input: string): string =>
  input.replace(/\s+/g, " ").trim();

export const stripHtml = (input: string): string =>
  input.replace(/<[^>]*>/g, "").trim();

export const normalizeSeedContent = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }

  const normalized = normalizeWhitespace(stripHtml(value));
  return normalized === "" ? null : normalized;
};

export const hasUsableSeedContent = (value?: string | null): boolean => {
  const normalized = normalizeSeedContent(value);
  return (normalized?.length ?? 0) >= ARTICLE_CONTENT_MIN_LENGTH;
};

export const hasStoredArticleContent = (value?: string | null): boolean => {
  const normalized = normalizeSeedContent(value);
  return (normalized?.length ?? 0) > 0;
};

export const isSuccessfulArticleContents02Row = (row: {
  status?: string | null;
  content?: string | null;
}): boolean => row.status === "success" && hasStoredArticleContent(row.content);

export const hasSuccessfulArticleContents02 = async (
  articleId: number,
): Promise<boolean> => {
  const rows = await ArticleContents02.findAll({
    where: { articleId },
    order: [["id", "DESC"]],
  });

  return rows.some((row) => isSuccessfulArticleContents02Row(row));
};

export const getCanonicalArticleContents02Row = async (articleId: number) => {
  const rows = await ArticleContents02.findAll({
    where: { articleId },
    order: [["id", "DESC"]],
  });

  if (rows.length === 0) {
    return null;
  }

  const sorted = [...rows].sort((left, right) => {
    const leftContentLength = normalizeSeedContent(left.content)?.length ?? 0;
    const rightContentLength = normalizeSeedContent(right.content)?.length ?? 0;
    const leftStatusRank = left.status === "success" ? 2 : leftContentLength > 0 ? 1 : 0;
    const rightStatusRank = right.status === "success" ? 2 : rightContentLength > 0 ? 1 : 0;

    if (leftStatusRank !== rightStatusRank) {
      return rightStatusRank - leftStatusRank;
    }

    if (leftContentLength !== rightContentLength) {
      return rightContentLength - leftContentLength;
    }

    return right.id - left.id;
  });

  return sorted[0] ?? null;
};

export const upsertArticleContents02Seed = async (
  input: ArticleContents02SeedInput,
): Promise<ArticleContents02SeedResult> => {
  if (await hasSuccessfulArticleContents02(input.articleId)) {
    return "skip";
  }

  const normalizedContent = normalizeSeedContent(input.content);
  const isUsable = hasUsableSeedContent(normalizedContent);

  const seedPayload = {
    url: input.resolvedUrl ?? (input.bodySource === "aggregator-feed" ? input.discoveryUrl : null),
    googleRssUrl: input.discoveryUrl,
    googleFinalUrl: null,
    publisherFinalUrl: null,
    title: input.title ?? null,
    content: normalizedContent,
    status: isUsable ? "success" : "fail",
    failureType: !isUsable && normalizedContent ? "short_content" : null,
    details: isUsable
      ? input.successDetails
      : normalizedContent
        ? input.shortDetails
        : input.missingDetails,
    extractionSource: input.extractionSource ?? "none",
    bodySource: normalizedContent ? input.bodySource : "none",
    googleStatusCode: null,
    publisherStatusCode: null,
  };

  const canonicalRow = await getCanonicalArticleContents02Row(input.articleId);

  if (canonicalRow && canonicalRow.status !== "success") {
    await canonicalRow.update(seedPayload);
  } else {
    await ArticleContents02.create({
      articleId: input.articleId,
      ...seedPayload,
    });
  }

  return isUsable ? "success" : "needs-scrape";
};
