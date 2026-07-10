import {
  Article,
  EntityWhoFoundArticle,
  NewsApiRequest,
  NewsApiRequestWebsiteDomainContract,
  NewsArticleAggregatorSource,
  WebsiteDomain,
} from "@newsnexus/db-models";
import { writeResponseDataFromNewsAggregator } from "../common";
import logger from "../logger";
import { upsertArticleContents02Seed } from "./articleContents02Seed";
import {
  normalizeExternalJsonResponse,
  normalizeNewsDataIoResultsPayload,
} from "./responseNormalizers";

export async function storeNewsDataIoArticles(
  requestResponseData: any,
  newsApiRequest: any,
) {
  const newsApiSource = await NewsArticleAggregatorSource.findOne({
    where: { nameOfOrg: "NewsData.IO" },
    include: [{ model: EntityWhoFoundArticle }],
  });

  const entityWhoFoundArticleId = (newsApiSource as any)?.EntityWhoFoundArticle
    ?.id;

  try {
    let countOfArticlesSavedToDbFromRequest = 0;
    for (const article of requestResponseData.results as any[]) {
      const existingArticle = await Article.findOne({
        where: { url: article.link },
      });
      if (existingArticle) {
        continue;
      }
      const newArticle = await Article.create({
        publicationName: article.source_name,
        title: article.title,
        author: article?.creator?.[0],
        description: article.description,
        url: article.link,
        urlToImage: article.image_url,
        publishedDate: article.pubDate,
        entityWhoFoundArticleId,
        newsApiRequestId: newsApiRequest.id,
      });

      await upsertArticleContents02Seed({
        articleId: newArticle.id,
        discoveryUrl: article.link,
        resolvedUrl: article.link,
        title: article.title,
        content: article.content,
        bodySource: "aggregator-feed",
        extractionSource: "final-url",
        successDetails: "Seeded from NewsData.io article content",
        shortDetails: "NewsData.io article content too short",
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

export async function makeNewsDataIoRequest(
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

  const includeSourcesArray = includeWebsiteDomainObjArray
    .splice(0, 4)
    .map((obj) => obj.name);
  const excludeSourcesArray = excludeWebsiteDomainObjArray
    .splice(0, 4)
    .map((obj) => obj.name);

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
    queryParams.push(`domainurl=${includeSourcesArray.join(",")}`);
  }

  if (excludeSourcesArray.length > 0) {
    queryParams.push(`excludedomain=${excludeSourcesArray.join(",")}`);
  }

  const andPart = andArray.length > 0 ? andArray.join(" AND ") : "";
  const orPart = orArray.length > 0 ? `(${orArray.join(" OR ")})` : "";
  const notPart =
    notArray.length > 0 ? notArray.map((k) => `NOT ${k}`).join(" AND ") : "";

  const fullQuery = [andPart, orPart, notPart].filter(Boolean).join(" AND ");

  if (fullQuery) {
    queryParams.push(`q=${encodeURIComponent(fullQuery)}`);
  }

  queryParams.push("language=en");
  queryParams.push(`apiKey=${source.apiKey}`);
  queryParams.push("removeduplicate=1");
  queryParams.push("country=us");
  queryParams.push("excludecategory=entertainment,politics,world");

  const requestUrl = `${source.url}latest?${queryParams.join("&")}`;
  logger.info("- [makeNewsDataIoRequest] requestUrl", requestUrl);
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
    const normalizedResults =
      normalizeNewsDataIoResultsPayload(requestResponseData);

    if (!normalizedResponse.ok || requestResponseData.status === "error") {
      status = "error";
      writeResponseDataFromNewsAggregator(
        source.id,
        { id: "failed", url: requestUrl },
        requestResponseData,
        true,
      );
      await handleErrorNewsDataIoRequest(requestResponseData);
    }

    if (!normalizedResults.ok) {
      status = "error";
    }
    newsApiRequest = await NewsApiRequest.create({
      newsArticleAggregatorSourceId: source.id,
      dateStartOfRequest: startDate,
      dateEndOfRequest: endDate,
      countOfArticlesReceivedFromRequest: requestResponseData.results?.length,
      countOfArticlesAvailableFromRequest: requestResponseData?.totalResults,
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

async function handleErrorNewsDataIoRequest(requestResponseData: any) {
  if (
    Array.isArray(requestResponseData.results?.message) &&
    typeof requestResponseData.results.message[0]?.message === "string" &&
    requestResponseData.results.message[0].message.includes(
      "The domain you provided does not exist",
    )
  ) {
    logger.info(
      "- [makeNewsDataIoRequest] invalid domain: ",
      requestResponseData.results?.message?.[0]?.invalid_domain,
    );
    await WebsiteDomain.update(
      {
        isArchievedNewsDataIo: true,
      },
      {
        where: {
          name: requestResponseData.results.message[0].invalid_domain,
        },
      },
    );
  } else {
    logger.info("Correctly handled invalid_domain with no message");
  }

  if (requestResponseData.results.message[0]?.suggestion) {
    logger.info(
      "- [makeNewsDataIoRequest] suggestion: ",
      requestResponseData.results.message[0].suggestion,
    );
    for (const msg of requestResponseData.results.message as any[]) {
      const invalidDomain = msg.invalid_domain;
      const suggestions = msg.suggestion;

      if (invalidDomain) {
        logger.info(
          "- [makeNewsDataIoRequest] Archiving invalid domain:",
          invalidDomain,
        );
        await WebsiteDomain.update(
          { isArchievedNewsDataIo: true },
          { where: { name: invalidDomain } },
        );
      }

      if (Array.isArray(suggestions)) {
        for (const suggestion of suggestions) {
          try {
            const websiteDomain = await WebsiteDomain.create({
              name: suggestion,
            });
            logger.info(
              "- [makeNewsDataIoRequest] Added suggestion:",
              (websiteDomain as any).name,
            );
          } catch (err: any) {
            logger.warn(
              `Failed to add suggestion ${suggestion}:`,
              err?.message,
            );
          }
        }
      }
    }
  }
}
