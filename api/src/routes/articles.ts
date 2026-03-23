import express from "express";
import type { Request, Response } from "express";
import {
  getCanonicalArticleContents02Row,
  isSuccessfulArticleContents02Row,
} from "../modules/newsOrgs/articleContents02Seed";

const router = express.Router();
const {
  Article,
  State,
  ArticleIsRelevant,
  ArticleApproved,
  EntityWhoFoundArticle,
  ArticleStateContract,
  ArticleContents02,
  ArtificialIntelligence,
  ArticleReviewed,
  EntityWhoCategorizedArticle,
} = require("@newsnexus/db-models");
const { authenticateToken } = require("../modules/userAuthentication");
const {
  createNewsApiRequestsArray,
  createArticlesApprovedArray,
  formatArticleDetails,
} = require("../modules/articles");
const { getLastThursdayAt20hInNyTimeZone } = require("../modules/common");

const {
  sqlQueryArticles,
  sqlQueryArticlesWithStatesApprovedReportContract,
  sqlQueryArticlesForWithRatingsRoute,
  sqlQueryArticlesWithStates,
  sqlQueryArticlesApproved,
  sqlQueryArticlesReport,
  sqlQueryArticlesIsRelevant,
  sqlQueryArticlesAndAiScores,
  sqlQueryArticleDetails,
} = require("../modules/queriesSql");
import logger from "../modules/logger";

function parseNumericId(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }

  const numericValue = Number(value);
  return Number.isSafeInteger(numericValue) ? numericValue : null;
}

// NOTE: ---- > will need to refactor because sqlQueryArticles is changed
// 🔹 POST /articles: filtered list of articles
router.post("/", authenticateToken, async (req: Request, res: Response) => {
  logger.info("- POST /articles");

  const {
    returnOnlyThisPublishedDateOrAfter,
    returnOnlyThisCreatedAtDateOrAfter,
    returnOnlyIsNotApproved,
    returnOnlyIsRelevant,
  } = req.body;

  logger.info("req.body:");
  logger.info(JSON.stringify(req.body, null, 2));

  // const articlesArray = await sqlQueryArticlesOld({
  const articlesArray = await sqlQueryArticles({
    publishedDate: returnOnlyThisPublishedDateOrAfter,
    createdAt: returnOnlyThisCreatedAtDateOrAfter,
  });

  logger.info(
    "- articlesArray.length (before filtering):",
    articlesArray.length,
  );

  // Create Article - State Map for modifing the articlesArray
  const articlesArrayWithStates = await sqlQueryArticlesWithStates();
  const statesByArticleId = new Map();
  for (const entry of articlesArrayWithStates) {
    if (!statesByArticleId.has(entry.articleId)) {
      statesByArticleId.set(entry.articleId, []);
    }
    statesByArticleId.get(entry.articleId).push({
      id: entry.stateId,
      name: entry.stateName,
      abbreviation: entry.abbreviation,
    });
  }

  // Create ARticle - Relevants Map for modifying the articleArray
  const articlesArrayWithRelevants = await sqlQueryArticlesIsRelevant();
  const isRelevantByArticleId = new Map();
  for (const entry of articlesArrayWithRelevants) {
    if (!isRelevantByArticleId.has(entry.articleId)) {
      isRelevantByArticleId.set(entry.articleId, []);
    }
    isRelevantByArticleId.get(entry.articleId).push({
      isRelevant: entry.isRelevant,
    });
  }

  // Create Article - Approved Map for modifying the articlesArray
  const articlesArrayWithApproveds = await sqlQueryArticlesApproved();
  const approvedByUserIdByArticleId = new Map();
  for (const entry of articlesArrayWithApproveds) {
    if (!approvedByUserIdByArticleId.has(entry.articleId)) {
      approvedByUserIdByArticleId.set(entry.articleId, []);
    }
    approvedByUserIdByArticleId.get(entry.articleId).push({
      userId: entry.userId,
    });
  }

  // Filter in JavaScript based on related tables
  const articlesMap = new Map();

  for (const row of articlesArray) {
    if (!articlesMap.has(row.articleId)) {
      articlesMap.set(row.articleId, {
        id: row.articleId,
        title: row.title,
        description: row.description,
        publishedDate: row.publishedDate,
        url: row.url,
        States: [],
        statesStringCommaSeparated: "",
        ArticleIsRelevant: true,
        // ArticleApproveds: [],
        articleIsApproved: false,
        keyword: "",
        NewsApiRequest: {
          andString: row.andString,
          orString: row.orString,
          notString: row.notString,
        },
      });
    }

    const article = articlesMap.get(row.articleId);

    // Check is articlesArrayWithStates contains the row.articleId
    if (statesByArticleId.has(row.articleId)) {
      const states = statesByArticleId.get(row.articleId);
      for (const state of states) {
        // Only push if not already present
        if (!article.States.some((s: any) => s.id === state.id)) {
          article.States.push(state);
        }
        // add comma separated abbreviation
        if (article.statesStringCommaSeparated === "") {
          article.statesStringCommaSeparated = state.abbreviation;
        } else {
          article.statesStringCommaSeparated =
            article.statesStringCommaSeparated + ", " + state.abbreviation;
        }
      }
    }

    // Check if isRelevant
    if (isRelevantByArticleId.has(row.articleId)) {
      article.ArticleIsRelevant = false;
    }

    if (approvedByUserIdByArticleId.has(row.articleId)) {
      article.articleIsApproved = true;
    }
    // if (row.approvedByUserId) {
    //   article.ArticleApproveds.push({ userId: row.approvedByUserId });
    // }

    if (article.NewsApiRequest?.andString) {
      article.keyword =
        article.keyword + `AND ${article.NewsApiRequest.andString}`;
    }
    if (article.NewsApiRequest?.orString) {
      article.keyword =
        article.keyword + ` OR ${article.NewsApiRequest.orString}`;
    }
    if (article.NewsApiRequest?.notString) {
      article.keyword =
        article.keyword + ` NOT ${article.NewsApiRequest.notString}`;
    }
  }

  let articlesArrayGrouped = Array.from(articlesMap.values());

  if (returnOnlyIsNotApproved) {
    articlesArrayGrouped = articlesArrayGrouped.filter((article: any) => {
      return !article.articleIsApproved;
    });
  }

  if (returnOnlyIsRelevant) {
    articlesArrayGrouped = articlesArrayGrouped.filter((article: any) => {
      return article.ArticleIsRelevant;
    });
  }

  res.json({ articlesArray: articlesArrayGrouped });
});

// 🔹 GET /articles/approved
router.get(
  "/approved",
  authenticateToken,
  async (req: Request, res: Response) => {
    logger.info("- GET /articles/approved");
    const startTime = Date.now();
    const articlesArray =
      await sqlQueryArticlesWithStatesApprovedReportContract();

    logger.info(
      `- articlesArray.length (before filtering): ${articlesArray.length}`,
    );

    const approvedArticlesArray = articlesArray.filter((article: any) =>
      article.ArticleApproveds?.some(
        (entry: any) => entry.isApproved === true || entry.isApproved === 1,
      ),
    );

    const approvedArticlesArrayModified = approvedArticlesArray.map(
      (article: any) => {
        const isSubmitted =
          article.ArticleReportContracts.length > 0 ? "Yes" : "No";
        const articleHasBeenAcceptedByAll =
          article.ArticleReportContracts.every(
            (contract: any) => contract.articleAcceptedByCpsc === 1,
          );
        let stateAbbreviation = "";
        if (article.States?.length === 1) {
          stateAbbreviation = article.States[0].abbreviation;
        } else if (article.States?.length > 1) {
          stateAbbreviation = article.States.map(
            (state: any) => state.abbreviation,
          ).join(", ");
        }
        return {
          ...article,
          isSubmitted,
          articleHasBeenAcceptedByAll,
          stateAbbreviation,
        };
      },
    );

    logger.info(
      `- approvedArticlesArrayModified.length (after filtering): ${approvedArticlesArrayModified.length}`,
    );

    const timeToRenderResponseFromApiInSeconds =
      (Date.now() - startTime) / 1000;
    res.json({
      articlesArray: approvedArticlesArrayModified,
      timeToRenderResponseFromApiInSeconds,
    });
  },
);

// 🔹 POST /articles/update-approved
router.post(
  "/update-approved",
  authenticateToken,
  async (req: Request, res: Response) => {
    const { articleId, contentToUpdate } = req.body;
    logger.info(`articleId: ${articleId}`);
    logger.info(`contentToUpdate: ${contentToUpdate}`);

    const articleApprovedArrayOriginal = await ArticleApproved.findAll({
      where: { articleId },
    });

    let articleApprovedArrayModified = [];
    if (articleApprovedArrayOriginal.length > 0) {
      await ArticleApproved.update(
        {
          textForPdfReport: contentToUpdate,
        },
        {
          where: { articleId },
        },
      );

      articleApprovedArrayModified = await ArticleApproved.findAll({
        where: { articleId },
      });
    }

    return res.json({ result: true, articleApprovedArrayModified });
  },
);

// 🔹 POST /articles/update-approved-all/:articleId
router.post(
  "/update-approved-all/:articleId",
  authenticateToken,
  async (req: Request, res: Response) => {
    const { articleId } = req.params;
    const {
      newPublicationName,
      newTitle,
      newUrl,
      newPublishedDate,
      newStateIdsArray,
      newContent,
    } = req.body;

    logger.info(`- POST /articles/update-approved-all/${articleId}`);
    logger.info("req.body:", JSON.stringify(req.body, null, 2));

    try {
      // Step 1: Update Articles table
      const articleUpdateFields: Record<string, unknown> = {};
      if (newPublicationName !== null && newPublicationName !== undefined) {
        articleUpdateFields.publicationName = newPublicationName;
      }
      if (newTitle !== null && newTitle !== undefined) {
        articleUpdateFields.title = newTitle;
      }
      if (newUrl !== null && newUrl !== undefined) {
        articleUpdateFields.url = newUrl;
      }
      if (newPublishedDate !== null && newPublishedDate !== undefined) {
        articleUpdateFields.publishedDate = newPublishedDate;
      }
      if (newContent !== null && newContent !== undefined) {
        articleUpdateFields.description = newContent;
      }

      if (Object.keys(articleUpdateFields).length > 0) {
        await Article.update(articleUpdateFields, {
          where: { id: articleId },
        });
        logger.info(
          `Updated Articles table for articleId ${articleId}:`,
          articleUpdateFields,
        );
      }

      // Step 2: Update ArticleApproved table if record exists
      const articleApprovedRecord = await ArticleApproved.findOne({
        where: { articleId },
      });

      if (articleApprovedRecord) {
        const approvedUpdateFields: Record<string, unknown> = {};
        if (newTitle !== null && newTitle !== undefined) {
          approvedUpdateFields.headlineForPdfReport = newTitle;
        }
        if (newPublicationName !== null && newPublicationName !== undefined) {
          approvedUpdateFields.publicationNameForPdfReport = newPublicationName;
        }
        if (newUrl !== null && newUrl !== undefined) {
          approvedUpdateFields.urlForPdfReport = newUrl;
        }
        if (newPublishedDate !== null && newPublishedDate !== undefined) {
          approvedUpdateFields.publicationDateForPdfReport = newPublishedDate;
        }
        if (newContent !== null && newContent !== undefined) {
          approvedUpdateFields.textForPdfReport = newContent;
        }

        if (Object.keys(approvedUpdateFields).length > 0) {
          await ArticleApproved.update(approvedUpdateFields, {
            where: { articleId },
          });
          logger.info(
            `Updated ArticleApproved table for articleId ${articleId}:`,
            approvedUpdateFields,
          );
        }
      }

      // Step 3: Replace ArticleStateContract records if newStateIdsArray is provided
      if (newStateIdsArray !== null && newStateIdsArray !== undefined) {
        // Delete all existing ArticleStateContract records for this articleId
        await ArticleStateContract.destroy({
          where: { articleId },
        });
        logger.info(
          `Deleted existing ArticleStateContract records for articleId ${articleId}`,
        );

        // Create new ArticleStateContract records
        for (const stateId of newStateIdsArray) {
          await ArticleStateContract.create({
            articleId: articleId,
            stateId: stateId,
          });
        }
        logger.info(
          `Created new ArticleStateContract records for articleId ${articleId} with stateIds:`,
          newStateIdsArray,
        );
      }

      // Step 4: Fetch and return updated article data
      const updatedArticle = await Article.findOne({
        where: { id: articleId },
        include: [
          {
            model: State,
            through: { attributes: [] },
          },
          {
            model: ArticleApproved,
          },
        ],
      });

      res.json({
        result: true,
        status: `articleId ${articleId} updated successfully`,
        article: updatedArticle,
      });
    } catch (error: any) {
      logger.error(`❌ Error updating articleId ${articleId}:`, error.message);
      res.status(500).json({
        result: false,
        error: "Failed to update article",
        message: error.message,
      });
    }
  },
);

// 🔹 POST /articles/user-toggle-is-not-relevant/:articleId
router.post(
  "/user-toggle-is-not-relevant/:articleId",
  authenticateToken,
  async (req: Request, res: Response) => {
    const { articleId } = req.params;
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        result: false,
        message: "Authentication required",
      });
    }
    const existingRecord = await ArticleIsRelevant.findOne({
      where: { articleId },
    });
    let status;
    let articleIsRelevant;
    if (existingRecord) {
      await existingRecord.destroy({
        where: { articleId },
      });
      status = `articleId ${articleId} is made relevant`;
      articleIsRelevant = true;
    } else {
      await ArticleIsRelevant.create({
        articleId: articleId,
        userId: user.id,
        isRelevant: false,
      });
      status = `articleId ${articleId} is marked as NOT relevant`;
      articleIsRelevant = false;
    }
    res.json({ result: true, status, articleIsRelevant });
  },
);

// 🔹 GET /articles/get-approved/:articleId
router.get(
  "/get-approved/:articleId",
  authenticateToken,
  async (req: Request, res: Response) => {
    const { articleId } = req.params;
    const articleApproved = await ArticleApproved.findOne({
      where: { articleId },
      include: [
        {
          model: Article,
          include: [
            {
              model: State,
              through: { attributes: [] }, // omit ArticleStateContract from result
            },
            {
              model: ArticleIsRelevant,
            },
          ],
        },
      ],
    });

    // Check if record exists AND isApproved is true
    if (
      !articleApproved ||
      (articleApproved.isApproved !== true && articleApproved.isApproved !== 1)
    ) {
      return res.json({
        articleIsApproved: false,
        article: {},
      });
    }

    res.json({
      articleIsApproved: true,
      article: articleApproved.Article,
      content: articleApproved.textForPdfReport,
      States: articleApproved.Article.States,
    });
  },
);

// 🔹 POST /articles/approve/:articleId
router.post(
  "/approve/:articleId",
  authenticateToken,
  async (req: Request, res: Response) => {
    const rawArticleId =
      typeof req.params.articleId === "string" ? req.params.articleId : "";
    const articleId = parseNumericId(rawArticleId);
    if (articleId === null) {
      return res.status(400).json({
        result: false,
        message: "Invalid articleId",
      });
    }

    const {
      // isApproved,
      headlineForPdfReport,
      approvedStatus,
    } = req.body;
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        result: false,
        message: "Authentication required",
      });
    }

    logger.info(`articleId ${articleId}: ${headlineForPdfReport}`);
    logger.info(`approvedStatus: ${approvedStatus}`);

    const canonicalContentRow = await getCanonicalArticleContents02Row(articleId);
    const preferredPublisherFinalUrl =
      canonicalContentRow !== null &&
      isSuccessfulArticleContents02Row(canonicalContentRow) &&
      typeof canonicalContentRow.publisherFinalUrl === "string" &&
      canonicalContentRow.publisherFinalUrl.trim() !== ""
        ? canonicalContentRow.publisherFinalUrl.trim()
        : null;

    const articleApprovedExists = await ArticleApproved.findOne({
      where: { articleId },
    });

    if (approvedStatus === "Approve") {
      const approvalPayload = {
        ...req.body,
        urlForPdfReport: preferredPublisherFinalUrl ?? req.body.urlForPdfReport,
      };

      if (articleApprovedExists) {
        // Update existing record to approved
        await ArticleApproved.update(
          {
            isApproved: true,
            userId: user.id,
            ...approvalPayload,
          },
          { where: { articleId } },
        );
        logger.info(
          `---- > updated existing record to approved for articleId ${articleId}`,
        );
      } else {
        // Create new approval record
        await ArticleApproved.create({
          articleId,
          userId: user.id,
          isApproved: true,
          ...approvalPayload,
        });
        logger.info(
          `---- > created new approval record for articleId ${articleId}`,
        );
      }
    } else if (approvedStatus === "Un-approve") {
      logger.info("---- > received Un-approve");
      if (articleApprovedExists) {
        // Update existing record to unapproved instead of deleting
        await ArticleApproved.update(
          {
            isApproved: false,
            userId: user.id,
          },
          { where: { articleId } },
        );
        logger.info(
          `---- > updated record to unapproved for articleId ${articleId}, userId: ${user.id}`,
        );
      } else {
        logger.info(
          `---- > no approval record exists for articleId ${articleId}, cannot unapprove`,
        );
      }
    }

    const statusMessage =
      approvedStatus === "Approve"
        ? `articleId ${articleId} is approved`
        : `articleId ${articleId} is unapproved`;

    res.json({ result: true, status: statusMessage });
  },
);

// 🔹 GET /articles/summary-statistics
router.get(
  "/summary-statistics",
  authenticateToken,
  async (_req: Request, res: Response) => {
    // Article count AND Article count since last Thursday at 20h
    const articlesArray = await sqlQueryArticles({});
    let articlesCount = articlesArray.length;
    let articlesSinceLastThursday20hEst = 0;
    const lastThursday20hEst = getLastThursdayAt20hInNyTimeZone();

    articlesArray.map((article: any) => {
      const articleCreatedAtDate = new Date(article.createdAt);
      if (articleCreatedAtDate >= lastThursday20hEst) {
        articlesSinceLastThursday20hEst++;
      }
    });

    // Article count with states
    const articlesArrayIncludeStates = await sqlQueryArticlesWithStates();
    const articlesArrayWithStatesSubset = articlesArrayIncludeStates.filter(
      (article: any) => article.stateId,
    );
    const uniqueArticleIdsWithStatesSubset = [
      ...new Set(
        articlesArrayWithStatesSubset.map((article: any) => article.articleId),
      ),
    ];

    // Approved articles
    const articlesArrayApproved = await sqlQueryArticlesApproved();

    const uniqueArticleIdsApprovedSubset = [
      ...new Set(
        articlesArrayApproved.map((article: any) => article.articleId),
      ),
    ];

    const articlesInReportArray = await sqlQueryArticlesReport();

    // Get all articleIds from articles in report
    const articleIdsInReport: Array<number | string> = [];
    articlesInReportArray.map((article: any) => {
      if (article.reportId) {
        articleIdsInReport.push(article.articleId);
      }
    });

    let approvedButNotInReport: any[] = [];
    articlesArrayApproved.map((article: any) => {
      if (!articleIdsInReport.includes(article.articleId)) {
        approvedButNotInReport.push(article);
      }
    });

    res.json({
      summaryStatistics: {
        articlesCount,
        articlesSinceLastThursday20hEst,
        articleHasStateCount: uniqueArticleIdsWithStatesSubset.length,
        articleIsApprovedCount: uniqueArticleIdsApprovedSubset.length,
        approvedButNotInReportCount: approvedButNotInReport.length,
      },
    });
  },
);

// 🔹 POST /articles/add-article
router.post(
  "/add-article",
  authenticateToken,
  async (req: Request, res: Response) => {
    const {
      publicationName,
      author,
      title,
      description,
      content,
      url,
      publishedDate,
      stateObjArray,
      isApproved,
      kmNotes,
    } = req.body;

    logger.info(`publicationName: ${publicationName}`);
    logger.info(`author: ${author}`);
    logger.info(`title: ${title}`);
    logger.info(`description: ${description}`);
    logger.info(`content: ${content}`);
    logger.info(`url: ${url}`);
    logger.info(`publishedDate: ${publishedDate}`);
    logger.info(`stateObjArray: ${stateObjArray}`);
    logger.info(`isApproved: ${isApproved}`);
    logger.info(`kmNotes: ${kmNotes}`);

    const user = req.user;
    if (!user) {
      return res.status(401).json({
        result: false,
        message: "Authentication required",
      });
    }

    const entityWhoFoundArticleObj = await EntityWhoFoundArticle.findOne({
      where: { userId: user.id },
    });
    if (!entityWhoFoundArticleObj) {
      return res.status(404).json({
        result: false,
        message: `No EntityWhoFoundArticle found for userId ${user.id}`,
      });
    }

    const newArticle = await Article.create({
      publicationName,
      author,
      title,
      description,
      url,
      publishedDate,
      entityWhoFoundArticleId: entityWhoFoundArticleObj.id,
    });

    logger.info(`stateObjArray: ${stateObjArray}`);

    for (let stateObj of stateObjArray) {
      await ArticleStateContract.create({
        articleId: newArticle.id,
        stateId: stateObj.id,
      });
    }

    if (isApproved) {
      await ArticleApproved.create({
        userId: user.id,
        articleId: newArticle.id,
        isApproved,
        headlineForPdfReport: title,
        publicationNameForPdfReport: publicationName,
        publicationDateForPdfReport: publishedDate,
        textForPdfReport: content,
        urlForPdfReport: url,
        kmNotes,
      });
    }

    res.json({ result: true, newArticle });
  },
);

// 🔹 DELETE /articles/:articleId - Delete Article
router.delete(
  "/:articleId",
  authenticateToken,
  async (req: Request, res: Response) => {
    const { articleId } = req.params;
    await Article.destroy({
      where: { id: articleId },
    });
    await ArticleApproved.destroy({
      where: { articleId },
    });
    await ArticleIsRelevant.destroy({
      where: { articleId },
    });
    await ArticleStateContract.destroy({
      where: { articleId },
    });
    await ArticleContents02.destroy({
      where: { articleId },
    });
    res.json({ result: true, status: `articleId ${articleId} deleted` });
  },
);

// 🔹 POST /articles/is-being-reviewed/:articleId
router.post(
  "/is-being-reviewed/:articleId",
  authenticateToken,
  async (req: Request, res: Response) => {
    const { articleId } = req.params;
    const { isBeingReviewed } = req.body;
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        result: false,
        message: "Authentication required",
      });
    }

    logger.info(`articleId ${articleId}: ${isBeingReviewed}`);

    if (isBeingReviewed) {
      // Create or update the record
      await ArticleReviewed.upsert({
        articleId: articleId,
        userId: user.id,
      });
      return res.json({
        result: true,
        status: `articleId ${articleId} IS being reviewed`,
      });
    } else {
      // Remove the record if it exists
      await ArticleReviewed.destroy({
        where: { articleId },
      });
      return res.json({
        result: true,
        status: `articleId ${articleId} IS NOT being reviewed`,
      });
    }
  },
);
// 🔹 POST /articles/with-ratings - Get articles with ratings
router.post(
  "/with-ratings",
  authenticateToken,
  async (req: Request, res: Response) => {
    logger.info("- POST /articles/with-ratings");
    const startTime = Date.now();
    const {
      returnOnlyThisPublishedDateOrAfter,
      returnOnlyThisCreatedAtDateOrAfter,
      semanticScorerEntityName,
      returnOnlyIsNotApproved,
      returnOnlyIsRelevant,
    } = req.body;

    let semanticScorerEntityId;

    if (semanticScorerEntityName) {
      const semanticScorerEntityObj = await ArtificialIntelligence.findOne({
        where: { name: semanticScorerEntityName },
      });
      semanticScorerEntityId = semanticScorerEntityObj.id;
    }

    // try {
    // 🔹 Step 1: Get full list of articles as base array
    const whereClause: Record<string, unknown> = {};
    if (returnOnlyThisPublishedDateOrAfter) {
      whereClause.publishedDate = {
        [require("sequelize").Op.gte]: new Date(
          returnOnlyThisPublishedDateOrAfter,
        ),
      };
    }

    if (returnOnlyThisCreatedAtDateOrAfter) {
      whereClause.createdAt = {
        [require("sequelize").Op.gte]: new Date(
          returnOnlyThisCreatedAtDateOrAfter,
        ),
      };
    }

    const articlesArray = await sqlQueryArticlesForWithRatingsRoute(
      returnOnlyThisCreatedAtDateOrAfter,
      returnOnlyThisPublishedDateOrAfter,
    );

    // Step 2: Filter articles
    // Filter in JavaScript based on related tables
    const articlesArrayFilteredNoAi = articlesArray.filter((article: any) => {
      // Filter out not approved if requested
      if (
        returnOnlyIsNotApproved &&
        article.ArticleApproveds &&
        article.ArticleApproveds.some(
          (entry: any) => entry.isApproved === true || entry.isApproved === 1,
        )
      ) {
        return false;
      }

      // Filter out not relevant if requested
      if (
        returnOnlyIsRelevant &&
        article.ArticleIsRelevants &&
        article.ArticleIsRelevants.some(
          (entry: any) => entry.isRelevant !== null,
        )
      ) {
        return false;
      }
      return true;
    });

    // Step 2.1: Get AI scores
    const artificialIntelligenceObject01 = await ArtificialIntelligence.findOne(
      {
        where: { name: semanticScorerEntityName },
        include: [EntityWhoCategorizedArticle],
      },
    );
    if (!artificialIntelligenceObject01) {
      return res.status(404).json({ message: "AI not found." });
    }
    const entityWhoCategorizedArticleId01 =
      artificialIntelligenceObject01.EntityWhoCategorizedArticles[0].id;

    if (!artificialIntelligenceObject01.EntityWhoCategorizedArticles?.length) {
      return res
        .status(500)
        .json({ message: "No related EntityWhoCategorizedArticles found" });
    }

    const articlesIdArray = articlesArrayFilteredNoAi.map(
      (article: any) => article.id,
    );

    const articlesAndAiScores = await sqlQueryArticlesAndAiScores(
      articlesIdArray,
      entityWhoCategorizedArticleId01,
    );
    const articlesArrayFilteredWithSemanticScorer =
      articlesArrayFilteredNoAi.map((article: any) => {
        const aiScore = articlesAndAiScores.find(
          (score: any) => score.articleId === article.id,
        );
        return {
          ...article,
          semanticRatingMax: aiScore?.keywordRating,
          semanticRatingMaxLabel: aiScore?.keyword,
        };
      });

    // Step 2.2: Get zero shot Location Classifier scores

    const artificialIntelligenceObject02 = await ArtificialIntelligence.findOne(
      {
        where: { name: "NewsNexusClassifierLocationScorer01" },
        include: [EntityWhoCategorizedArticle],
      },
    );
    if (!artificialIntelligenceObject02) {
      return res.status(404).json({ message: "AI not found." });
    }
    const entityWhoCategorizedArticleId02 =
      artificialIntelligenceObject02.EntityWhoCategorizedArticles[0].id;

    const articlesAndLocationClassifierScoresArray =
      await sqlQueryArticlesAndAiScores(
        articlesIdArray,
        entityWhoCategorizedArticleId02,
      );

    const articlesArrayWithBothAiScores =
      articlesArrayFilteredWithSemanticScorer.map((article: any) => {
        const locationClassifierScore =
          articlesAndLocationClassifierScoresArray.find(
            (score: any) => score.articleId === article.id,
          );
        return {
          ...article,
          locationClassifierScore: locationClassifierScore?.keywordRating,
          locationClassifierScoreLabel: locationClassifierScore?.keyword,
        };
      });

    // 🔹 Step 3: Build final article objects
    const finalArticles = articlesArrayWithBothAiScores.map((article: any) => {
      const statesStringCommaSeparated = article.States.map(
        (state: any) => state.name,
      ).join(", ");

      let isRelevant = true;
      if (
        article.ArticleIsRelevants.every((entry: any) => entry.isRelevant === 0)
      ) {
        isRelevant = false;
      }
      const isApproved =
        article.ArticleApproveds &&
        article.ArticleApproveds.some(
          (entry: any) => entry.isApproved === true || entry.isApproved === 1,
        );

      let requestQueryString = "";
      if (article.NewsApiRequest?.andString)
        requestQueryString += `AND ${article.NewsApiRequest.andString}`;
      if (article.NewsApiRequest?.orString)
        requestQueryString += ` OR ${article.NewsApiRequest.orString}`;
      if (article.NewsApiRequest?.notString)
        requestQueryString += ` NOT ${article.NewsApiRequest.notString}`;

      let nameOfOrg = "";
      if (article.NewsApiRequest?.NewsArticleAggregatorSource?.nameOfOrg) {
        nameOfOrg =
          article.NewsApiRequest.NewsArticleAggregatorSource.nameOfOrg;
      }
      const isBeingReviewed = article.ArticleRevieweds?.length > 0;

      return {
        id: article.id,
        title: article.title,
        description: article.description,
        publishedDate: article.publishedDate,
        publicationName: article.publicationName,
        url: article.url,
        publisherFinalUrl: article.publisherFinalUrl ?? null,
        hasArticleContent: Boolean(article.hasArticleContent),
        States: article.States,
        statesStringCommaSeparated,
        isRelevant,
        isApproved,
        requestQueryString,
        nameOfOrg,
        semanticRatingMaxLabel: article.semanticRatingMaxLabel,
        semanticRatingMax: article.semanticRatingMax,
        locationClassifierScoreLabel: article.locationClassifierScoreLabel,
        locationClassifierScore: article.locationClassifierScore,
        isBeingReviewed,
        stateAssignment: article.StateAssignment, // Add AI state assignment data
      };
    });

    const timeToRenderResponseFromApiInSeconds =
      (Date.now() - startTime) / 1000;
    logger.info(
      `timeToRenderResponseFromApiInSeconds: ${timeToRenderResponseFromApiInSeconds}`,
    );
    res.json({
      articleCount: finalArticles.length,
      articlesArray: finalArticles,
      // articlesArray: articlesArrayFilteredWithSemanticScorer,
      timeToRenderResponseFromApiInSeconds,
    });
    // } catch (error) {
    //   logger.error("❌ Error in /articles/with-ratings:", error);
    //   res.status(500).json({ error: "Failed to fetch articles with ratings." });
    // }
  },
);

// 🔹 POST /articles/table-approved-by-request
router.post(
  "/table-approved-by-request",
  authenticateToken,
  async (req: Request, res: Response) => {
    logger.info("- POST /articles/table-approved-by-request");
    let { dateRequestsLimit } = req.body;
    if (!dateRequestsLimit) {
      dateRequestsLimit = null;
    }

    try {
      const requestsArray = await createNewsApiRequestsArray();
      const { requestIdArray, manualFoundCount } =
        await createArticlesApprovedArray(dateRequestsLimit);

      // Count how many times each requestId appears in requestIdArray
      const countMap: Record<string, number> = {};
      for (const id of requestIdArray) {
        countMap[id] = (countMap[id] || 0) + 1;
      }

      // Add countOfApprovedArticles to each request in the array
      const requestsArrayWithCounts = requestsArray.map((request: any) => ({
        ...request,
        // date: request.createdAt,
        countOfApprovedArticles: countMap[request.id] || 0,
      }));

      // Filter out requests with no approved articles
      const filteredRequestsArray = requestsArrayWithCounts.filter(
        (request: any) => {
          // if (request.id === 6002) {
          //   logger.info(request);
          // }
          return request.countOfApprovedArticles > 0;
        },
      );

      // Sort by count descending
      const sortedRequestsArray = filteredRequestsArray.sort(
        (a: any, b: any) =>
          b.countOfApprovedArticles - a.countOfApprovedArticles,
      );

      // const outputFilePath = path.join(
      //   process.env.PATH_TO_UTILITIES_ANALYSIS_SPREADSHEETS,
      //   `approved_by_request_${new Date().toISOString().split("T")[0]}.xlsx`
      // );
      // await createSpreadsheetFromArray(sortedRequestsArray, outputFilePath);
      // logger.info(`✅ Excel file saved to: ${outputFilePath}`);

      res.json({
        countOfApprovedArticles: requestIdArray.length + manualFoundCount,
        countOfManuallyApprovedArticles: manualFoundCount,
        requestsArray: sortedRequestsArray,
      });
    } catch (error) {
      logger.error("❌ Error in /articles/table-approved-by-request:", error);
      res.status(500).json({ error: "Failed to fetch request summary." });
    }
  },
);

router.get(
  "/review-selected-content/:articleId",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const rawArticleId =
        typeof req.params.articleId === "string" ? req.params.articleId : "";
      const articleId = parseNumericId(rawArticleId);
      if (articleId === null) {
        return res.status(400).json({
          result: false,
          message: "Invalid articleId",
        });
      }

      const article = await Article.findByPk(articleId);
      if (!article) {
        return res.status(404).json({
          result: false,
          message: "Article not found",
        });
      }

      const canonicalContentRow = await getCanonicalArticleContents02Row(articleId);
      const hasArticleContent =
        canonicalContentRow !== null &&
        isSuccessfulArticleContents02Row(canonicalContentRow);

      return res.status(200).json({
        result: true,
        articleId,
        hasArticleContent,
        content: hasArticleContent ? canonicalContentRow?.content ?? null : null,
        contentSource: hasArticleContent ? "article-contents-02" : null,
      });
    } catch (error) {
      logger.error("Error in GET /articles/review-selected-content/:articleId:", error);
      return res.status(500).json({
        result: false,
        message: "Failed to fetch review selected article content",
      });
    }
  },
);

// GET /articles/test
router.get(
  "/test-sql",
  authenticateToken,
  async (_req: Request, res: Response) => {
    const articlesArray = await sqlQueryArticlesForWithRatingsRoute(null, null);
    const articleIdArray = articlesArray.map((article: any) => article.id);

    // AI 01 : NewsNexusSemanticScorer02
    // AI 02 : NewsNexusClassifierLocationScorer01
    const artificialIntelligenceObject = await ArtificialIntelligence.findOne({
      where: { name: "NewsNexusSemanticScorer02" },
      include: [EntityWhoCategorizedArticle],
    });
    if (!artificialIntelligenceObject) {
      return res.status(404).json({ error: "AI not found." });
    }
    const entityWhoCategorizedArticleId =
      artificialIntelligenceObject.EntityWhoCategorizedArticles[0].id;

    const articlesAndAiScores = await sqlQueryArticlesAndAiScores(
      articleIdArray,
      entityWhoCategorizedArticleId,
    );
    const articlesArrayModified = articlesArray.map((article: any) => {
      const aiScore = articlesAndAiScores.find(
        (score: any) => score.articleId === article.id,
      );
      return {
        ...article,
        // aiScore,
        semanticRatingMax: aiScore?.keywordRating,
        semanticRatingMaxLabel: aiScore?.keyword,
      };
    });

    res.json({ articlesArrayModified });
  },
);

// 🔹 GET /articles/article-details/:articleId
router.get(
  "/article-details/:articleId",
  authenticateToken,
  async (req: Request, res: Response) => {
    logger.info("- in GET /articles/article-details/:articleId");

    try {
      const { articleId } = req.params;
      const normalizedArticleId = Array.isArray(articleId)
        ? articleId[0]
        : articleId;
      logger.info(`articleId: ${normalizedArticleId}`);

      // Validate articleId is a number
      if (!normalizedArticleId || isNaN(parseInt(normalizedArticleId, 10))) {
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid article ID provided",
            details: "Article ID must be a valid number",
            status: 400,
          },
        });
      }

      // Query database for article details
      const rawResults = await sqlQueryArticleDetails(
        parseInt(normalizedArticleId, 10),
      );

      // Format results using helper function
      const articleDetails = formatArticleDetails(rawResults);

      // If no article found, return 404
      if (!articleDetails) {
        return res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Article not found",
            details: `No article exists with ID ${normalizedArticleId}`,
            status: 404,
          },
        });
      }

      logger.info(
        `Successfully retrieved article details for ID ${normalizedArticleId}`,
      );

      // Return successful response
      res.status(200).json(articleDetails);
    } catch (error: any) {
      logger.error("Error in GET /articles/article-details/:articleId:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to retrieve article details",
          details:
            process.env.NODE_ENV === "development" ? error.message : undefined,
          status: 500,
        },
      });
    }
  },
);

export = router;
