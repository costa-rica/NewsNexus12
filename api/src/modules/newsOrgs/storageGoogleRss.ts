import {
  Article,
  EntityWhoFoundArticle,
  NewsApiRequest,
  NewsArticleAggregatorSource,
} from "@newsnexus/db-models";
import logger from "../logger";
import { upsertArticleContents02Seed } from "./articleContents02Seed";

export const GOOGLE_NEWS_RSS_ORG_NAME = "Google News RSS";

export type GoogleRssStorageItem = {
  title?: string;
  description?: string;
  link?: string;
  pubDate?: string | Date;
  source?: string;
  content?: string;
};

type EnsureAggregatorSourceAndEntityResult = {
  newsArticleAggregatorSourceId: number;
  entityWhoFoundArticleId: number;
};

export async function ensureAggregatorSourceAndEntity(): Promise<EnsureAggregatorSourceAndEntityResult> {
  let source = await NewsArticleAggregatorSource.findOne({
    where: { nameOfOrg: GOOGLE_NEWS_RSS_ORG_NAME },
  });

  if (!source) {
    source = await NewsArticleAggregatorSource.create({
      nameOfOrg: GOOGLE_NEWS_RSS_ORG_NAME,
      isRss: true,
      isApi: false,
    });
    logger.info(
      `Created NewsArticleAggregatorSource: ${GOOGLE_NEWS_RSS_ORG_NAME}`,
    );
  }

  let entity = await EntityWhoFoundArticle.findOne({
    where: { newsArticleAggregatorSourceId: source.id },
  });

  if (!entity) {
    entity = await EntityWhoFoundArticle.create({
      newsArticleAggregatorSourceId: source.id,
    });
    logger.info(
      `Created EntityWhoFoundArticle for: ${GOOGLE_NEWS_RSS_ORG_NAME}`,
    );
  }

  return {
    newsArticleAggregatorSourceId: source.id,
    entityWhoFoundArticleId: entity.id,
  };
}

type StoreRequestAndArticlesInput = {
  requestUrl: string;
  andString: string | null;
  orString: string | null;
  items: GoogleRssStorageItem[];
  newsArticleAggregatorSourceId: number;
  entityWhoFoundArticleId: number;
};

type StoreRequestAndArticlesResult = {
  newsApiRequestId: number;
  articlesReceived: number;
  articlesSaved: number;
  articleIds: number[];
  articleIdsNeedingScrape: number[];
};

export async function storeRequestAndArticles(
  params: StoreRequestAndArticlesInput,
): Promise<StoreRequestAndArticlesResult> {
  const requestDate = new Date().toISOString().split("T")[0];

  const request = await NewsApiRequest.create({
    newsArticleAggregatorSourceId: params.newsArticleAggregatorSourceId,
    dateEndOfRequest: requestDate,
    countOfArticlesReceivedFromRequest: params.items.length,
    status: "success",
    url: params.requestUrl,
    andString: params.andString,
    orString: params.orString,
    notString: null,
    isFromAutomation: false,
  });

  let savedCount = 0;
  const articleIds: number[] = [];
  const articleIdsNeedingScrape: number[] = [];

  for (const item of params.items) {
    if (!item.link) {
      logger.warn("Skipping article without link");
      continue;
    }

    const existing = await Article.findOne({ where: { url: item.link } });
    if (existing) {
      logger.info(`Skipping duplicate article: ${item.link}`);
      continue;
    }

    let publishedDate: string | null = null;
    if (item.pubDate) {
      try {
        const parsedDate = new Date(item.pubDate);
        publishedDate = parsedDate.toISOString();
      } catch (_error) {
        logger.warn(`Failed to parse pubDate: ${item.pubDate}`);
      }
    }

    const article = await Article.create({
      publicationName: item.source || "Unknown",
      title: item.title || "",
      description: item.description || "",
      url: item.link,
      publishedDate,
      entityWhoFoundArticleId: params.entityWhoFoundArticleId,
      newsApiRequestId: request.id,
    });

    savedCount += 1;
    articleIds.push(article.id);

    const seedResult = await upsertArticleContents02Seed({
      articleId: article.id,
      discoveryUrl: item.link,
      title: item.title,
      content: item.content,
      bodySource: "rss-feed",
      successDetails: "Seeded from Google RSS item content",
      shortDetails: "RSS item content too short; triggering Google-to-publisher scrape"
    });
    if (seedResult === "needs-scrape") {
      articleIdsNeedingScrape.push(article.id);
    }
  }

  await request.update({
    countOfArticlesSavedToDbFromRequest: savedCount,
  });

  logger.info(
    `Stored ${savedCount} new articles for request ${request.id} (${params.items.length} received).`,
  );

  return {
    newsApiRequestId: request.id,
    articlesReceived: params.items.length,
    articlesSaved: savedCount,
    articleIds,
    articleIdsNeedingScrape,
  };
}
