import { sequelize } from "@newsnexus/db-models";
import logger from "./logger";
import { QueryTypes } from "sequelize";

const sequelizeAny = sequelize as any;

type SqlQueryReplacements = Record<string, string | number | boolean | Date>;
type SqlQueryRow = Record<string, any>;

type RequestsFromApiQueryOptions = {
  dateLimitOnRequestMade?: string | Date;
  includeIsFromAutomation?: boolean;
};

type ArticlesQueryOptions = {
  publishedDate?: string | Date;
  createdAt?: string | Date;
};

type ArticlesOldQueryOptions = {
  publishedDate?: string | Date;
};

async function sqlQueryArticlesSummaryStatistics(): Promise<SqlQueryRow[]> {
  // ------ NOTE -----------------------------------
  //  const articlesArray = await Article.findAll({
  //   include: [
  //     {
  //       model: State,
  //       through: { attributes: [] }, // omit ArticleStateContract from result
  //     },
  //     {
  //       model: ArticleIsRelevant,
  //     },
  //     {
  //       model: ArticleApproved,
  //     },
  //   ],
  // });
  // -----------------------------------------

  const sql = `
  SELECT
    a.id AS "articleId",
    a."createdAt",
    ar."isRelevant",
    aa."createdAt" AS "approvalCreatedAt",
    s.id AS "stateId",
    arc."reportId"
  FROM "Articles" a
  LEFT JOIN "ArticleIsRelevants" ar ON ar."articleId" = a.id
  LEFT JOIN "ArticleApproveds" aa ON aa."articleId" = a.id
  LEFT JOIN "ArticleStateContracts" asc ON asc."articleId" = a.id
  LEFT JOIN "States" s ON s.id = asc."stateId"
  LEFT JOIN "ArticleReportContracts" arc ON arc."articleId" = a.id;
`;

  const results = (await sequelizeAny.query(sql, {
    type: QueryTypes.SELECT,
  })) as SqlQueryRow[];

  return results;
}

async function sqlQueryArticlesApproved(): Promise<SqlQueryRow[]> {
  const sql = `
    SELECT
      a.id AS "articleId",
      a.title,
      a.description,
      a."publishedDate",
      a."createdAt",
      a.url,
      aa."userId" AS "approvedByUserId"
    FROM "Articles" a
    INNER JOIN "ArticleApproveds" aa ON aa."articleId" = a.id
    WHERE aa."isApproved" = true
    ORDER BY a.id;
  `;

  const results = (await sequelizeAny.query(sql, {
    type: QueryTypes.SELECT,
  })) as SqlQueryRow[];

  return results;
}

async function sqlQueryRequestsFromApi({
  dateLimitOnRequestMade,
  includeIsFromAutomation,
}: RequestsFromApiQueryOptions): Promise<SqlQueryRow[]> {
  // ------ NOTE -----------------------------------
  // const newsApiRequestsArray = await NewsApiRequest.findAll({
  //   where: whereClause,
  //   include: [
  //     {
  //       model: NewsArticleAggregatorSource,
  //     },
  //     {
  //       model: NewsApiRequestWebsiteDomainContract,
  //       include: [
  //         {
  //           model: WebsiteDomain,
  //         },
  //       ],
  //     },
  //   ],
  // });
  // -----------------------------------------
  const replacements: SqlQueryReplacements = {};
  const whereClauses = [];

  if (dateLimitOnRequestMade) {
    whereClauses.push(`nar."createdAt" >= :dateLimitOnRequestMade`);
    replacements.dateLimitOnRequestMade = dateLimitOnRequestMade;
  }

  if (includeIsFromAutomation !== true) {
    whereClauses.push(`nar."isFromAutomation" = false`);
  }

  const whereString =
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const sql = `
    SELECT
      nar.id AS "newsApiRequestId",
      nar."createdAt",
      nar."dateStartOfRequest",
      nar."dateEndOfRequest",
      nar."countOfArticlesReceivedFromRequest",
      nar."countOfArticlesSavedToDbFromRequest",
      nar.status,
      nar."andString",
      nar."orString",
      nar."notString",
      nas."nameOfOrg",
      wd."name" AS "domainName",
      ndc."includedOrExcludedFromRequest"
    FROM "NewsApiRequests" nar
    LEFT JOIN "NewsArticleAggregatorSources" nas ON nas.id = nar."newsArticleAggregatorSourceId"
    LEFT JOIN "NewsApiRequestWebsiteDomainContracts" ndc ON ndc."newsApiRequestId" = nar.id
    LEFT JOIN "WebsiteDomains" wd ON wd.id = ndc."websiteDomainId"
    ${whereString}
    ORDER BY nar."createdAt" DESC;
  `;

  const results = (await sequelizeAny.query(sql, {
    replacements,
    type: QueryTypes.SELECT,
  })) as SqlQueryRow[];

  return results;
}

async function sqlQueryArticlesOld({
  publishedDate,
}: ArticlesOldQueryOptions): Promise<SqlQueryRow[]> {
  // ------ NOTE -----------------------------------
  // const articlesArray = await Article.findAll({
  //   where: whereClause,
  //   include: [
  //     {
  //       model: State,
  //       through: { attributes: [] },
  //     },
  //     {
  //       model: ArticleIsRelevant,
  //     },
  //     {
  //       model: ArticleApproved,
  //     },
  //     {
  //       model: NewsApiRequest,
  //     },
  //   ],
  // });
  // -----------------------------------------
  const replacements: SqlQueryReplacements = {};
  const whereClauses = [];

  if (publishedDate) {
    whereClauses.push(`a."publishedDate" >= :publishedDate`);
    replacements.publishedDate = publishedDate;
  }

  const whereString =
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const sql = `
      SELECT
        a.id AS "articleId",
        a.title,
        a.description,
        a."publishedDate",
        a.url,
        s.id AS "stateId",
        s.name AS "stateName",
        ar."isRelevant",
        aa."userId" AS "approvedByUserId",
        nar."andString",
        nar."orString",
        nar."notString"
      FROM "Articles" a
      LEFT JOIN "ArticleStateContracts" asc ON a.id = asc."articleId"
      LEFT JOIN "States" s ON asc."stateId" = s.id
      LEFT JOIN "ArticleIsRelevants" ar ON ar."articleId" = a.id
      LEFT JOIN "ArticleApproveds" aa ON aa."articleId" = a.id
      LEFT JOIN "NewsApiRequests" nar ON nar.id = a."newsApiRequestId"
      ${whereString}
      ORDER BY a.id;
    `;

  const results = (await sequelizeAny.query(sql, {
    replacements,
    type: QueryTypes.SELECT,
  })) as SqlQueryRow[];

  return results;
}

// --- New method of creating SQL query functions
async function sqlQueryArticles({
  publishedDate,
  createdAt,
}: ArticlesQueryOptions): Promise<SqlQueryRow[]> {
  const replacements: SqlQueryReplacements = {};
  const whereClauses = [];

  if (publishedDate) {
    whereClauses.push(`a."publishedDate" >= :publishedDate`);
    replacements.publishedDate = publishedDate;
  }

  if (createdAt) {
    whereClauses.push(`a."createdAt" >= :createdAt`);
    replacements.createdAt = createdAt;
  }

  const whereString =
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const sql = `
      SELECT
        a.id AS "articleId",
        a.title,
        a.description,
        a."publishedDate",
        a.url,
        a.createdAt,
        nar."andString",
        nar."orString",
        nar."notString"
      FROM "Articles" a
      LEFT JOIN "NewsApiRequests" nar ON nar.id = a."newsApiRequestId"
      ${whereString}
      ORDER BY a.id;
    `;

  const results = (await sequelizeAny.query(sql, {
    replacements,
    type: QueryTypes.SELECT,
  })) as SqlQueryRow[];

  return results;
}

async function sqlQueryArticlesWithStates(): Promise<SqlQueryRow[]> {
  const sql = `
      SELECT
        a.id AS "articleId",
        a.title,
        a.description,
        a."publishedDate",
        a.url,
        s.id AS "stateId",
        s.name AS "stateName",
        s.abbreviation
      FROM "Articles" a
      INNER JOIN "ArticleStateContracts" asc ON a.id = asc."articleId"
      LEFT JOIN "States" s ON asc."stateId" = s.id
      ORDER BY a.id;
    `;

  const results = (await sequelizeAny.query(sql, {
    type: QueryTypes.SELECT,
  })) as SqlQueryRow[];

  return results;
}

async function sqlQueryArticlesWithStatesApprovedReportContract(): Promise<
  SqlQueryRow[]
> {
  const sql = `
    SELECT
      a.id AS "articleId",
      a.title,
      a.description,
      a.publishedDate,
      a.createdAt,
      a.publicationName,
      a.url,
      a.author,
      a.urlToImage,
      a.entityWhoFoundArticleId,
      a.newsApiRequestId,
      a.newsRssRequestId,
      s.id AS "stateId",
      s.name AS "stateName",
      s.abbreviation AS "stateAbbreviation",
      aa.id AS "approvedId",
      aa."userId" AS "approvedByUserId",
      aa."createdAt" AS "approvedAt",
      aa."isApproved",
      aa."headlineForPdfReport",
      aa."publicationNameForPdfReport",
      aa."publicationDateForPdfReport",
      aa."textForPdfReport",
      aa."urlForPdfReport",
      aa."kmNotes",
      arc.id AS "reportContractId",
      arc."reportId",
      arc."articleReferenceNumberInReport",
      arc."articleAcceptedByCpsc",
      arc."articleRejectionReason"
    FROM "Articles" a
    LEFT JOIN "ArticleStateContracts" asc ON a.id = asc."articleId"
    LEFT JOIN "States" s ON s.id = asc."stateId"
    LEFT JOIN "ArticleApproveds" aa ON aa."articleId" = a.id
    LEFT JOIN "ArticleReportContracts" arc ON arc."articleId" = a.id
    ORDER BY a.id;
  `;

  const flatResults = (await sequelizeAny.query(sql, {
    type: QueryTypes.SELECT,
  })) as SqlQueryRow[];

  const articlesMap = new Map<number, any>();

  for (const row of flatResults) {
    const {
      articleId,
      title,
      description,
      publishedDate,
      createdAt,
      publicationName,
      url,
      author,
      urlToImage,
      entityWhoFoundArticleId,
      newsApiRequestId,
      newsRssRequestId,
      stateId,
      stateName,
      stateAbbreviation,
      approvedId,
      approvedByUserId,
      approvedAt,
      isApproved,
      headlineForPdfReport,
      publicationNameForPdfReport,
      publicationDateForPdfReport,
      textForPdfReport,
      urlForPdfReport,
      kmNotes,
      reportContractId,
      reportId,
      articleReferenceNumberInReport,
      articleAcceptedByCpsc,
      articleRejectionReason,
    } = row as any;

    if (!articlesMap.has(articleId)) {
      articlesMap.set(articleId, {
        id: articleId,
        title,
        description,
        publishedDate,
        createdAt,
        publicationName,
        url,
        author,
        urlToImage,
        entityWhoFoundArticleId,
        newsApiRequestId,
        newsRssRequestId,
        States: [],
        ArticleApproveds: [],
        ArticleReportContracts: [],
      });
    }

    if (stateId) {
      const stateExists = articlesMap
        .get(articleId)
        .States.some((s: any) => s.id === stateId);
      if (!stateExists) {
        articlesMap.get(articleId).States.push({
          id: stateId,
          name: stateName,
          abbreviation: stateAbbreviation,
        });
      }
    }

    if (approvedId) {
      const approvedExists = articlesMap
        .get(articleId)
        .ArticleApproveds.some((a: any) => a.id === approvedId);
      if (!approvedExists) {
        articlesMap.get(articleId).ArticleApproveds.push({
          id: approvedId,
          userId: approvedByUserId,
          createdAt: approvedAt,
          isApproved,
          headlineForPdfReport,
          publicationNameForPdfReport,
          publicationDateForPdfReport,
          textForPdfReport,
          urlForPdfReport,
          kmNotes,
        });
      }
    }

    if (reportContractId) {
      articlesMap.get(articleId).ArticleReportContracts.push({
        id: reportContractId,
        reportId,
        articleReferenceNumberInReport,
        articleAcceptedByCpsc,
        articleRejectionReason,
      });
    }
  }

  return Array.from(articlesMap.values());
}

// async function sqlQueryArticlesForWithRatingsRouteNoAi(
async function sqlQueryArticlesForWithRatingsRoute(
  returnOnlyThisCreatedAtDateOrAfter?: string | Date | null,
  returnOnlyThisPublishedDateOrAfter?: string | Date | null,
): Promise<SqlQueryRow[]> {
  const replacements: SqlQueryReplacements = {};
  const whereClauses = [];

  if (returnOnlyThisCreatedAtDateOrAfter) {
    whereClauses.push(`a."createdAt" >= :returnOnlyThisCreatedAtDateOrAfter`);
    replacements.returnOnlyThisCreatedAtDateOrAfter =
      returnOnlyThisCreatedAtDateOrAfter;
  }

  if (returnOnlyThisPublishedDateOrAfter) {
    whereClauses.push(
      `a."publishedDate" >= :returnOnlyThisPublishedDateOrAfter`,
    );
    replacements.returnOnlyThisPublishedDateOrAfter =
      returnOnlyThisPublishedDateOrAfter;
  }

  const whereClause =
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  const sql = `
    SELECT
      a.id,
      a."createdAt",
      a."newsApiRequestId",
      a."title",
      a."description",
      a."publishedDate",
      a."publicationName",
      a."url",
      ac2_publisher."publisherFinalUrl" AS "publisherFinalUrl",

      -- NewsApiRequest fields
      nar."andString" AS "NewsApiRequest.andString",
      nar."orString" AS "NewsApiRequest.orString",
      nar."notString" AS "NewsApiRequest.notString",
      nar.id AS "NewsApiRequest.id",
      nar."createdAt" AS "NewsApiRequest.createdAt",

      -- NewsArticleAggregatorSource fields
      nas.id AS "NewsApiRequest.NewsArticleAggregatorSource.id",
      nas."nameOfOrg" AS "NewsApiRequest.NewsArticleAggregatorSource.nameOfOrg",

      -- Review / Approval / Relevance
      air."isRelevant",
      air."userId" AS "ArticleIsRelevant.userId",
      air."articleId" AS "ArticleIsRelevant.articleId",
      air."isRelevant" AS "ArticleIsRelevant.isRelevant",
      aa.id AS "ArticleApproved.id",
      aa."userId" AS "ArticleApproved.userId",
      aa."articleId" AS "ArticleApproved.articleId",
      aa."isApproved" AS "ArticleApproved.isApproved",
      CASE
        WHEN ac2_lookup."articleId" IS NOT NULL THEN true
        ELSE false
      END AS "hasArticleContent",
      s.id AS "stateId",
      s.id AS "States.id",
      s.name AS "States.name",
      s.abbreviation AS "States.abbreviation",
      s."createdAt" AS "States.createdAt",
      s."updatedAt" AS "States.updatedAt",

      ar.id AS "ArticleReviewed.id",
      ar."userId" AS "ArticleReviewed.userId",
      ar."articleId" AS "ArticleReviewed.articleId",

      -- AI State Assignment fields from ArticleStateContracts02
      asc02."promptId" AS "StateAssignment.promptId",
      asc02."isHumanApproved" AS "StateAssignment.isHumanApproved",
      asc02."isDeterminedToBeError" AS "StateAssignment.isDeterminedToBeError",
      asc02."occuredInTheUS" AS "StateAssignment.occuredInTheUS",
      asc02."reasoning" AS "StateAssignment.reasoning",
      asc02."stateId" AS "StateAssignment.stateId",
      s2.name AS "StateAssignment.stateName"

    FROM "Articles" a
    LEFT JOIN "ArticleIsRelevants" air ON air."articleId" = a.id
    LEFT JOIN "ArticleApproveds" aa ON aa."articleId" = a.id
    LEFT JOIN "ArticleStateContracts" asc ON asc."articleId" = a.id
    LEFT JOIN "States" s ON s.id = asc."stateId"

    LEFT JOIN "NewsApiRequests" nar ON nar.id = a."newsApiRequestId"
    LEFT JOIN "NewsArticleAggregatorSources" nas ON nas.id = nar."newsArticleAggregatorSourceId"
    LEFT JOIN (
      SELECT DISTINCT ac2."articleId"
      FROM "ArticleContents02" ac2
      WHERE ac2."status" = 'success'
        AND LENGTH(TRIM(COALESCE(ac2."content", ''))) > 0
    ) ac2_lookup ON ac2_lookup."articleId" = a.id
    LEFT JOIN (
      SELECT ac2_selected."articleId", ac2_selected."publisherFinalUrl"
      FROM "ArticleContents02" ac2_selected
      INNER JOIN (
        SELECT ac2."articleId", MAX(ac2."id") AS "latestUsableId"
        FROM "ArticleContents02" ac2
        WHERE ac2."status" = 'success'
          AND LENGTH(TRIM(COALESCE(ac2."content", ''))) > 0
          AND LENGTH(TRIM(COALESCE(ac2."publisherFinalUrl", ''))) > 0
        GROUP BY ac2."articleId"
      ) ac2_latest ON ac2_latest."latestUsableId" = ac2_selected."id"
    ) ac2_publisher ON ac2_publisher."articleId" = a.id

    LEFT JOIN "ArticleRevieweds" ar ON ar."articleId" = a.id

    -- Join AI state assignments from ArticleStateContracts02
    LEFT JOIN "ArticleStateContracts02" asc02 ON asc02."articleId" = a.id
    LEFT JOIN "States" s2 ON s2.id = asc02."stateId"
    ${whereClause}
    ORDER BY a.id;
  `;

  const rawResults = (await sequelizeAny.query(sql, {
    replacements,
    type: QueryTypes.SELECT,
  })) as SqlQueryRow[];

  const articleMap: Record<string, any> = {};

  for (const row of rawResults) {
    const {
      id,
      createdAt,
      newsApiRequestId,
      title,
      description,
      publishedDate,
      url,
      publisherFinalUrl,
      isRelevant,
      approvalCreatedAt,
      publicationName,
      hasArticleContent,

      // NewsApiRequest
      "NewsApiRequest.id": narId,
      "NewsApiRequest.createdAt": narCreatedAt,
      "NewsApiRequest.andString": andString,
      "NewsApiRequest.orString": orString,
      "NewsApiRequest.notString": notString,

      // Aggregator
      "NewsApiRequest.NewsArticleAggregatorSource.id": nasId,
      "NewsApiRequest.NewsArticleAggregatorSource.nameOfOrg": nasName,

      // State
      "States.id": stateId,
      "States.name": stateName,
      "States.abbreviation": stateAbbr,
      "States.createdAt": stateCreatedAt,
      "States.updatedAt": stateUpdatedAt,

      // AI State Assignment from ArticleStateContracts02
      "StateAssignment.promptId": saPromptId,
      "StateAssignment.isHumanApproved": saIsHumanApproved,
      "StateAssignment.isDeterminedToBeError": saIsDeterminedToBeError,
      "StateAssignment.occuredInTheUS": saOccuredInTheUS,
      "StateAssignment.reasoning": saReasoning,
      "StateAssignment.stateId": saStateId,
      "StateAssignment.stateName": saStateName,
    } = row as any;

    if (!articleMap[id]) {
      articleMap[id] = {
        id,
        createdAt,
        newsApiRequestId,
        title,
        description,
        publishedDate,
        url,
        publisherFinalUrl,
        publicationName,
        isRelevant,
        approvalCreatedAt,
        hasArticleContent: Boolean(hasArticleContent),
        NewsApiRequest: {
          id: narId,
          createdAt: narCreatedAt,
          andString,
          orString,
          notString,
          NewsArticleAggregatorSource: {
            id: nasId,
            nameOfOrg: nasName,
          },
        },
        States: [],
        ArticleIsRelevants: [],
        ArticleApproveds: [],
        ArticleRevieweds: [],
        // Add StateAssignment object if data exists
        StateAssignment:
          saPromptId !== null && saPromptId !== undefined
            ? {
                promptId: saPromptId,
                isHumanApproved: Boolean(saIsHumanApproved), // Convert 0/1 to boolean
                isDeterminedToBeError: Boolean(saIsDeterminedToBeError), // Convert 0/1 to boolean
                occuredInTheUS: Boolean(saOccuredInTheUS), // Convert 0/1 to boolean
                reasoning: saReasoning,
                stateId: saStateId,
                stateName: saStateName,
              }
            : null,
      };
    }

    if (stateId && !articleMap[id].States.some((s: any) => s.id === stateId)) {
      articleMap[id].States.push({
        id: stateId,
        name: stateName,
        abbreviation: stateAbbr,
        createdAt: stateCreatedAt,
        updatedAt: stateUpdatedAt,
      });
    }
    if (
      !articleMap[id].ArticleIsRelevants.some(
        (ar: any) => ar.id === row["ArticleIsRelevant.id"],
      )
    ) {
      articleMap[id].ArticleIsRelevants.push({
        id: row["ArticleIsRelevant.id"],
        userId: row["ArticleIsRelevant.userId"],
        articleId: row["ArticleIsRelevant.articleId"],
        isRelevant: row["ArticleIsRelevant.isRelevant"],
      });
    }
    const approvedId = row["ArticleApproved.id"];
    if (
      approvedId !== null &&
      !articleMap[id].ArticleApproveds.some((aa: any) => aa.id === approvedId)
    ) {
      articleMap[id].ArticleApproveds.push({
        id: approvedId,
        userId: row["ArticleApproved.userId"],
        articleId: row["ArticleApproved.articleId"],
        isApproved: row["ArticleApproved.isApproved"],
      });
    }
    const reviewedId = row["ArticleReviewed.id"];
    if (
      reviewedId !== null &&
      !articleMap[id].ArticleRevieweds.some((r: any) => r.id === reviewedId)
    ) {
      articleMap[id].ArticleRevieweds.push({
        id: reviewedId,
        userId: row["ArticleReviewed.userId"],
        articleId: row["ArticleReviewed.articleId"],
      });
    }
  }

  const results = Object.values(articleMap) as SqlQueryRow[];
  return results;
}

async function sqlQueryArticlesAndAiScores(
  articlesIdArray: Array<number | string>,
  entityWhoCategorizedArticleId: number | string,
): Promise<SqlQueryRow[]> {
  const whereClause = `WHERE aewcac."articleId" IN (${articlesIdArray.join(
    ",",
  )}) AND aewcac."entityWhoCategorizesId" = ${entityWhoCategorizedArticleId}`;
  const sql = `
    SELECT

      -- ArticleEntityWhoCategorizedArticleContract fields
      aewcac.id AS "ArticleEntityWhoCategorizedArticleContractId",
      aewcac."articleId" AS "articleId",
      aewcac."entityWhoCategorizesId" AS "entityWhoCategorizesId",
      aewcac."keyword" AS "keyword",
      aewcac."keywordRating" AS "keywordRating"

    FROM "ArticleEntityWhoCategorizedArticleContracts" aewcac 

    ${whereClause}
    ORDER BY aewcac.id;
  `;

  const rawResults = (await sequelizeAny.query(sql, {
    // replacements,
    type: QueryTypes.SELECT,
  })) as SqlQueryRow[];

  return rawResults;
}

async function sqlQueryArticlesReport(): Promise<SqlQueryRow[]> {
  const sql = `
  SELECT
    a.id AS "articleId",
    a.title,
    a.description,
    a.publishedDate,
    a.createdAt,
    a.publicationName,
    a.url,
    a.author,
    a.urlToImage,
    a.entityWhoFoundArticleId,
    a.newsApiRequestId,
    a.newsRssRequestId,
    arc.id AS "reportContractId",
    arc."reportId",
    r.id AS "reportId",
    r."createdAt" AS "reportCreatedAt"
  FROM "Articles" a
  LEFT JOIN "ArticleReportContracts" arc ON arc."articleId" = a.id
  LEFT JOIN "Reports" r ON r.id = arc."reportId"
  ORDER BY a.id;
`;

  const flatResults = (await sequelizeAny.query(sql, {
    type: QueryTypes.SELECT,
  })) as SqlQueryRow[];

  return flatResults;
}

async function sqlQueryArticlesIsRelevant(): Promise<SqlQueryRow[]> {
  const sql = `
    SELECT
      a.id AS "articleId",
      a.title,
      a.description,
      a."publishedDate",
      a.url,
      a.createdAt,
      ar."isRelevant"
    FROM "Articles" a
    INNER JOIN "ArticleIsRelevants" ar ON ar."articleId" = a.id
    ORDER BY a.id;
  `;

  const flatResults = (await sequelizeAny.query(sql, {
    type: QueryTypes.SELECT,
  })) as SqlQueryRow[];

  return flatResults;
}

async function sqlQueryArticlesApprovedForComponent(
  userId: number | string,
): Promise<SqlQueryRow[]> {
  const sql = `
    SELECT
      a.id AS "articleId",
      aa."headlineForPdfReport" AS "title",
      aa."textForPdfReport" AS "description",
      aa."urlForPdfReport" AS "url",
      aa."publicationNameForPdfReport" AS "publication",
      aa."publicationDateForPdfReport" AS "publicationDate",
      aa."createdAt",
      aa."updatedAt",
      STRING_AGG(s.abbreviation, ', ') AS "states"
    FROM "Articles" a
    INNER JOIN "ArticleApproveds" aa ON aa."articleId" = a.id
    LEFT JOIN "ArticleStateContracts" asct ON asct."articleId" = a.id
    LEFT JOIN "States" s ON s.id = asct."stateId"
    WHERE aa."userId" = :userId AND aa."isApproved" = true
    GROUP BY a.id, aa."headlineForPdfReport", aa."textForPdfReport", aa."urlForPdfReport", aa."publicationNameForPdfReport", aa."publicationDateForPdfReport", aa."createdAt", aa."updatedAt"
    ORDER BY aa."updatedAt" DESC;
  `;

  const results = (await sequelizeAny.query(sql, {
    replacements: { userId },
    type: QueryTypes.SELECT,
  })) as SqlQueryRow[];

  return results;
}

async function sqlQueryArticleDetails(
  articleId: number | string,
): Promise<SqlQueryRow[]> {
  const sql = `
    SELECT
      a.id AS "articleId",
      a.title,
      a.description,
      a.url,
      (
        SELECT ac2.content
        FROM "ArticleContents02" ac2
        WHERE ac2."articleId" = a.id
          AND ac2.status = 'success'
          AND ac2.content IS NOT NULL
          AND TRIM(ac2.content) <> ''
        ORDER BY
          CASE WHEN LENGTH(TRIM(ac2.content)) >= 200 THEN 1 ELSE 0 END DESC,
          LENGTH(TRIM(ac2.content)) DESC,
          ac2.id DESC
        LIMIT 1
      ) AS "articleContent",
      asc."stateId" AS "humanStateId",
      s1.name AS "humanStateName",
      asc2."stateId" AS "aiStateId",
      s2.name AS "aiStateName",
      asc2."promptId" AS "aiPromptId",
      asc2."isHumanApproved" AS "aiIsHumanApproved",
      asc2."reasoning" AS "aiReasoning"
    FROM "Articles" a
    LEFT JOIN "ArticleStateContracts" asc ON asc."articleId" = a.id
    LEFT JOIN "States" s1 ON s1.id = asc."stateId"
    LEFT JOIN "ArticleStateContracts02" asc2 ON asc2."articleId" = a.id
    LEFT JOIN "States" s2 ON s2.id = asc2."stateId"
    WHERE a.id = :articleId;
  `;

  const results = (await sequelizeAny.query(sql, {
    replacements: { articleId },
    type: QueryTypes.SELECT,
  })) as SqlQueryRow[];

  return results;
}

export {
  sqlQueryArticles,
  sqlQueryArticlesOld,
  sqlQueryArticlesSummaryStatistics,
  sqlQueryArticlesApproved,
  sqlQueryRequestsFromApi,
  sqlQueryArticlesWithStatesApprovedReportContract,
  sqlQueryArticlesForWithRatingsRoute,
  sqlQueryArticlesWithStates,
  sqlQueryArticlesReport,
  sqlQueryArticlesIsRelevant,
  sqlQueryArticlesApprovedForComponent,
  // sqlQueryArticlesForWithRatingsRouteNoAi,
  sqlQueryArticlesAndAiScores,
  sqlQueryArticleDetails,
};
