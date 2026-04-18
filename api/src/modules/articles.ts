import {
  Article,
  ArticleApproved,
  NewsApiRequest,
  NewsApiRequestWebsiteDomainContract,
  NewsArticleAggregatorSource,
  WebsiteDomain,
  sequelize,
} from "@newsnexus/db-models";
import { Op, QueryTypes } from "sequelize";
import logger from "./logger";

type SemanticKeywordRatedArticleRow = {
  id: number;
  title: string | null;
  description: string | null;
  url: string | null;
  publishedDate: string | null;
  keywordOfRating: string | null;
  keywordRating: number | null;
};

type NewsApiRequestFormattedRow = {
  id: number;
  andString: string | null;
  orString: string | null;
  notString: string | null;
  nameOfOrg: string;
  includeOrExcludeDomainsString: string;
  createdAt: Date;
};

type ApprovedSummary = {
  requestIdArray: number[];
  manualFoundCount: number;
};

type RawArticleDetailsRow = {
  articleId: number;
  title: string | null;
  description: string | null;
  url: string | null;
  articleContent?: string | null;
  humanStateId?: number | null;
  humanStateName?: string | null;
  aiPromptId?: number | null;
  aiIsHumanApproved?: boolean | null;
  aiReasoning?: string | null;
  aiStateId?: number | null;
  aiStateName?: string | null;
};

type FormattedArticleDetails = {
  articleId: number;
  title: string | null;
  description: string | null;
  url: string | null;
  content?: string | null;
  stateHumanApprovedArray?: Array<{ id: number; name: string | null }>;
  stateAiApproved?: {
    promptId: number | null | undefined;
    isHumanApproved: boolean | null | undefined;
    reasoning: string | null | undefined;
    state: {
      id: number;
      name: string | null | undefined;
    };
  };
};

export async function createArticlesArrayWithSqlForSemanticKeywordsRating(
  entityWhoCategorizesId: number,
  publishedDateAfter: string | null = null,
): Promise<SemanticKeywordRatedArticleRow[]> {
  let dateCondition = "";
  if (publishedDateAfter) {
    dateCondition = `AND a."publishedDate" >= :publishedDateAfter`;
  }

  const sql = `
    SELECT
      a."id",
      a."title",
      a."description",
      a."url",
      a."publishedDate",
      arc."keyword" AS "keywordOfRating",
      arc."keywordRating"
    FROM "Articles" a
    LEFT JOIN (
      SELECT arc1.*
      FROM "ArticleEntityWhoCategorizedArticleContracts" arc1
      JOIN (
        SELECT "articleId", MAX("keywordRating") AS "maxRating"
        FROM "ArticleEntityWhoCategorizedArticleContracts"
        WHERE "entityWhoCategorizesId" = :entityWhoCategorizesId
        GROUP BY "articleId"
      ) arc2
      ON arc1."articleId" = arc2."articleId" AND arc1."keywordRating" = arc2."maxRating"
      WHERE arc1."entityWhoCategorizesId" = :entityWhoCategorizesId
    ) arc
    ON a."id" = arc."articleId"
    WHERE 1=1 ${dateCondition}
  `;

  const rawArticles = await sequelize.query<SemanticKeywordRatedArticleRow>(
    sql,
    {
      type: QueryTypes.SELECT,
      replacements: {
        entityWhoCategorizesId,
        ...(publishedDateAfter ? { publishedDateAfter } : {}),
      },
    },
  );
  return rawArticles;
}

export async function createNewsApiRequestsArray(): Promise<
  NewsApiRequestFormattedRow[]
> {
  const requestsArray = await NewsApiRequest.findAll({
    include: [
      {
        model: NewsArticleAggregatorSource,
        attributes: ["nameOfOrg"],
      },
      {
        model: NewsApiRequestWebsiteDomainContract,
        include: [
          {
            model: WebsiteDomain,
            attributes: ["name"],
          },
        ],
      },
    ],
  });

  logger.info("requestsArray.length: ", requestsArray.length);

  const requestArrayFormatted = requestsArray.map((request: any) => {
    const domainNames = request.NewsApiRequestWebsiteDomainContracts.map(
      (contract: any) => contract.WebsiteDomain?.name,
    ).filter(Boolean);

    return {
      id: request.id,
      andString: request.andString,
      orString: request.orString,
      notString: request.notString,
      nameOfOrg: request.NewsArticleAggregatorSource?.nameOfOrg || "N/A",
      includeOrExcludeDomainsString: domainNames.join(", "),
      createdAt: request.createdAt,
    };
  });

  return requestArrayFormatted;
}

export async function createArticlesApprovedArray(
  dateRequestsLimit?: string | Date,
): Promise<ApprovedSummary> {
  let articles;
  if (dateRequestsLimit) {
    const normalizedDate =
      dateRequestsLimit instanceof Date
        ? dateRequestsLimit
        : new Date(dateRequestsLimit);
    articles = await Article.findAll({
      where: {
        createdAt: {
          [Op.gte]: normalizedDate,
        },
      } as any,
      include: [
        {
          model: ArticleApproved,
          required: true,
        },
      ],
    });
  } else {
    articles = await Article.findAll({
      include: [
        {
          model: ArticleApproved,
          required: true,
        },
      ],
    });
  }

  logger.info("Approved articles count:", articles.length);

  const requestIdArray: number[] = [];
  let manualFoundCount = 0;

  for (const article of articles as any[]) {
    if (article.newsApiRequestId) {
      requestIdArray.push(article.newsApiRequestId);
    } else {
      manualFoundCount += 1;
    }
  }

  return { requestIdArray, manualFoundCount };
}

export function formatArticleDetails(
  rawResults: RawArticleDetailsRow[],
): FormattedArticleDetails | null {
  if (!rawResults || rawResults.length === 0) {
    return null;
  }

  const firstRow = rawResults[0];

  const articleData: FormattedArticleDetails = {
    articleId: firstRow.articleId,
    title: firstRow.title,
    description: firstRow.description,
    url: firstRow.url,
  };

  if (firstRow.articleContent) {
    articleData.content = firstRow.articleContent;
  }

  const humanStatesMap = new Map<number, { id: number; name: string | null }>();
  for (const row of rawResults) {
    if (row.humanStateId && !humanStatesMap.has(row.humanStateId)) {
      humanStatesMap.set(row.humanStateId, {
        id: row.humanStateId,
        name: row.humanStateName ?? null,
      });
    }
  }

  if (humanStatesMap.size > 0) {
    articleData.stateHumanApprovedArray = Array.from(humanStatesMap.values());
  }

  if (firstRow.aiStateId) {
    articleData.stateAiApproved = {
      promptId: firstRow.aiPromptId,
      isHumanApproved: firstRow.aiIsHumanApproved,
      reasoning: firstRow.aiReasoning,
      state: {
        id: firstRow.aiStateId,
        name: firstRow.aiStateName,
      },
    };
  }

  return articleData;
}
