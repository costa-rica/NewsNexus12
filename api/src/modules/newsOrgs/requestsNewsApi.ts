import {
  Article,
  EntityWhoFoundArticle,
  NewsApiRequest,
  NewsApiRequestWebsiteDomainContract,
  NewsArticleAggregatorSource,
} from "@newsnexus/db-models";
import { writeResponseDataFromNewsAggregator } from "../common";
import logger from "../logger";
import { upsertArticleContents02Seed } from "./articleContents02Seed";
import {
  normalizeExternalJsonResponse,
  normalizeNewsApiArticlesPayload,
} from "./responseNormalizers";

export async function makeNewsApiRequest(
  source: any,
  keywordString: string,
  startDate?: string | null,
  endDate?: string | null,
  max = 100,
) {
  const token = source.apiKey;
  if (!endDate) {
    endDate = new Date().toISOString().split("T")[0];
  }
  if (!startDate) {
    startDate = new Date(new Date().setDate(new Date().getDate() - 29))
      .toISOString()
      .split("T")[0];
  }

  logger.info("- keywordString :  ", keywordString);
  const urlNewsApi = `${source.url}everything?q=${encodeURIComponent(
    keywordString,
  )}&from=${startDate}&to=${endDate}&pageSize=${max}&language=en&apiKey=${token}`;

  const response = await fetch(urlNewsApi);
  const rawPayload = await response.json();
  const normalizedResponse = normalizeExternalJsonResponse(
    response.status,
    rawPayload,
  );
  const requestResponseData = normalizedResponse.payload || {};

  let status = "success";
  const normalizedArticles =
    normalizeNewsApiArticlesPayload(requestResponseData);
  if (!normalizedResponse.ok || !normalizedArticles.ok) {
    status = "error";
    writeResponseDataFromNewsAggregator(
      source.id,
      { id: "failed", url: urlNewsApi },
      requestResponseData,
      true,
    );
  }

  const newsApiRequest = await NewsApiRequest.create({
    newsArticleAggregatorSourceId: source.id,
    andString: keywordString,
    dateStartOfRequest: startDate,
    dateEndOfRequest: new Date().toISOString().split("T")[0],
    countOfArticlesReceivedFromRequest: requestResponseData.articles?.length,
    status,
    url: urlNewsApi,
  });

  return { requestResponseData, newsApiRequest };
}

export async function storeNewsApiArticles(
  requestResponseData: any,
  newsApiRequest: any,
) {
  const newsApiSource = await NewsArticleAggregatorSource.findOne({
    where: { nameOfOrg: "NewsAPI" },
    include: [{ model: EntityWhoFoundArticle }],
  });

  const entityWhoFoundArticleId = (newsApiSource as any)?.EntityWhoFoundArticle
    ?.id;

  try {
    let countOfArticlesSavedToDbFromRequest = 0;
    for (const article of requestResponseData.articles as any[]) {
      const existingArticle = await Article.findOne({
        where: { url: article.url },
      });
      if (existingArticle) {
        continue;
      }
      const newArticle = await Article.create({
        publicationName: article.source.name,
        title: article.title,
        author: article.author,
        description: article.description,
        url: article.url,
        urlToImage: article.urlToImage,
        publishedDate: article.publishedAt,
        entityWhoFoundArticleId,
        newsApiRequestId: newsApiRequest.id,
      });

      await upsertArticleContents02Seed({
        articleId: newArticle.id,
        discoveryUrl: article.url,
        resolvedUrl: article.url,
        title: article.title,
        content: article.content,
        bodySource: "aggregator-feed",
        extractionSource: "final-url",
        successDetails: "Seeded from NewsAPI article content",
        shortDetails: "NewsAPI article content too short",
      });
      countOfArticlesSavedToDbFromRequest += 1;
    }

    await newsApiRequest.update({
      countOfArticlesSavedToDbFromRequest,
    });

    if (newsApiSource) {
      writeResponseDataFromNewsAggregator(
        (newsApiSource as any).id,
        newsApiRequest,
        requestResponseData,
        false,
      );
    }
  } catch (error) {
    logger.error(error);
    if (newsApiSource) {
      writeResponseDataFromNewsAggregator(
        (newsApiSource as any).id,
        newsApiRequest,
        requestResponseData,
        true,
      );
    }
  }
}

export async function makeNewsApiRequestDetailed(
  source: any,
  startDate: string | null,
  endDate: string | null,
  includeWebsiteDomainObjArray: any[] = [],
  excludeWebsiteDomainObjArray: any[] = [],
  keywordsAnd: string | null,
  keywordsOr: string | null,
  keywordsNot: string | null,
) {
  function splitPreservingQuotes(str: string) {
    return str.match(/"[^"]+"|\S+/g)?.map((s) => s.trim()) || [];
  }

  const andArray = splitPreservingQuotes(keywordsAnd || "");
  const orArray = splitPreservingQuotes(keywordsOr || "");
  const notArray = splitPreservingQuotes(keywordsNot || "");

  const includeSourcesArray = includeWebsiteDomainObjArray.map(
    (obj) => obj.name,
  );
  const excludeSourcesArray = excludeWebsiteDomainObjArray.map(
    (obj) => obj.name,
  );

  if (!endDate) {
    endDate = new Date().toISOString().split("T")[0];
  }
  if (!startDate) {
    startDate = new Date(new Date().setDate(new Date().getDate() - 29))
      .toISOString()
      .split("T")[0];
  }

  const queryParams: string[] = [];

  if (includeSourcesArray.length > 0) {
    queryParams.push(`domains=${includeSourcesArray.join(",")}`);
  }

  if (excludeSourcesArray.length > 0) {
    queryParams.push(`excludeDomains=${excludeSourcesArray.join(",")}`);
  }

  const andPart = andArray.length > 0 ? andArray.join(" AND ") : "";
  const orPart = orArray.length > 0 ? `(${orArray.join(" OR ")})` : "";
  const notPart =
    notArray.length > 0 ? notArray.map((k) => `NOT ${k}`).join(" AND ") : "";

  const fullQuery = [andPart, orPart, notPart].filter(Boolean).join(" AND ");

  if (fullQuery) {
    queryParams.push(`q=${encodeURIComponent(fullQuery)}`);
  }

  if (startDate) {
    queryParams.push(`from=${startDate}`);
  }

  if (endDate) {
    queryParams.push(`to=${endDate}`);
  }

  queryParams.push("language=en");
  queryParams.push(`apiKey=${source.apiKey}`);

  const requestUrl = `${source.url}everything?${queryParams.join("&")}`;
  logger.info("- [makeNewsApiRequestDetailed] requestUrl", requestUrl);
  let status = "success";
  let requestResponseData: any = null;
  let newsApiRequest: any = null;
  if (process.env.ACTIVATE_API_REQUESTS_TO_OUTSIDE_SOURCES === "true") {
    const response = await fetch(requestUrl);
    const rawPayload = await response.json();
    const normalizedResponse = normalizeExternalJsonResponse(
      response.status,
      rawPayload,
    );
    requestResponseData = normalizedResponse.payload || {};

    const normalizedArticles =
      normalizeNewsApiArticlesPayload(requestResponseData);
    if (!normalizedResponse.ok || !normalizedArticles.ok) {
      status = "error";
      writeResponseDataFromNewsAggregator(
        source.id,
        { id: "failed", url: requestUrl },
        requestResponseData,
        true,
      );
    }
    newsApiRequest = await NewsApiRequest.create({
      newsArticleAggregatorSourceId: source.id,
      dateStartOfRequest: startDate,
      dateEndOfRequest: endDate,
      countOfArticlesReceivedFromRequest: requestResponseData.articles?.length,
      status,
      url: requestUrl,
      andString: keywordsAnd,
      orString: keywordsOr,
      notString: keywordsNot,
    });

    for (const domain of includeWebsiteDomainObjArray) {
      await NewsApiRequestWebsiteDomainContract.create({
        newsApiRequestId: newsApiRequest.id,
        websiteDomainId: domain.websiteDomainId,
        includedOrExcludedFromRequest: "included",
      });
    }
    for (const domain of excludeWebsiteDomainObjArray) {
      await NewsApiRequestWebsiteDomainContract.create({
        newsApiRequestId: newsApiRequest.id,
        websiteDomainId: domain.websiteDomainId,
        includedOrExcludedFromRequest: "excluded",
      });
    }
  } else {
    newsApiRequest = requestUrl;
  }

  return { requestResponseData, newsApiRequest };
}
