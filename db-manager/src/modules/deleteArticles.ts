import { Op } from "sequelize";
import {
  Article,
  ArticleApproved,
  ArticleIsRelevant,
} from "@newsnexus/db-models";
import { logger } from "../config/logger";
import { calculateOldArticleCutoffDate } from "./deleteArticlesCutoff";

const DELETE_BATCH_SIZE = 5000;
const DELETE_SAMPLE_SIZE = 1000;

export type DeleteArticlesResult = {
  daysOldThreshold: number;
  cutoffDate: string;
  eligibleCount: number;
  processedCount: number;
  deletedCount: number;
};

export type DeleteTrimResult = {
  requestedCount: number;
  foundCount: number;
  deletedCount: number;
};

export function formatDeleteOldArticlesResult(
  result: DeleteArticlesResult,
): string {
  return JSON.stringify({
    event: "old_articles_deleted",
    daysOldThreshold: result.daysOldThreshold,
    cutoffDate: result.cutoffDate,
    eligibleCount: result.eligibleCount,
    processedCount: result.processedCount,
    deletedCount: result.deletedCount,
  });
}

export async function deleteOldUnapprovedArticles(
  daysOldThreshold: number,
): Promise<DeleteArticlesResult> {
  const cutoffDate = calculateOldArticleCutoffDate(daysOldThreshold);

  const [relevantRows, approvedRows] = await Promise.all([
    ArticleIsRelevant.findAll({
      attributes: ["articleId"],
      raw: true,
    }),
    ArticleApproved.findAll({
      attributes: ["articleId"],
      raw: true,
    }),
  ]);

  const protectedIds = new Set<number>();

  for (const row of relevantRows) {
    const articleId = Number((row as { articleId?: number }).articleId);
    if (Number.isFinite(articleId)) {
      protectedIds.add(articleId);
    }
  }

  for (const row of approvedRows) {
    const articleId = Number((row as { articleId?: number }).articleId);
    if (Number.isFinite(articleId)) {
      protectedIds.add(articleId);
    }
  }

  const conditions: any[] = [
    { publishedDate: { [Op.lt]: cutoffDate } },
  ];

  if (protectedIds.size > 0) {
    conditions.push({ id: { [Op.notIn]: Array.from(protectedIds) } });
  }

  const eligibleCount = await Article.count({
    where: { [Op.and]: conditions } as any,
  });
  if (!Number.isSafeInteger(eligibleCount) || eligibleCount < 0) {
    throw new Error(
      `Article.count returned invalid eligible count: ${String(eligibleCount)}`,
    );
  }

  logger.info(
    `Found ${eligibleCount} articles eligible for deletion (before ${cutoffDate}).`,
  );

  if (eligibleCount === 0) {
    return {
      daysOldThreshold,
      cutoffDate,
      eligibleCount: 0,
      processedCount: 0,
      deletedCount: 0,
    };
  }

  let processedCount = 0;
  let deletedCount = 0;
  let lastId = 0;
  let batchNumber = 0;
  let didSampleEstimate = false;

  while (processedCount < eligibleCount) {
    batchNumber += 1;
    const preferredBatchSize =
      !didSampleEstimate && eligibleCount > DELETE_BATCH_SIZE
        ? DELETE_SAMPLE_SIZE
        : DELETE_BATCH_SIZE;
    const batchSize = Math.min(
      preferredBatchSize,
      eligibleCount - processedCount,
    );
    const batchConditions = [
      ...conditions,
      { id: { [Op.gt]: lastId } },
    ];

    const rows = await Article.findAll({
      attributes: ["id"],
      where: { [Op.and]: batchConditions } as any,
      order: [["id", "ASC"]],
      limit: batchSize,
      raw: true,
    });

    if (rows.length === 0) {
      break;
    }

    const ids = rows
      .map((row) => Number((row as { id?: number }).id))
      .filter((id) => Number.isSafeInteger(id) && id > 0)
      .slice(0, batchSize);

    if (ids.length === 0) {
      throw new Error(
        "Article deletion batch contained rows without valid primary IDs",
      );
    }

    const batchStart = Date.now();
    const destroyedRows = await Article.destroy({
      where: { id: { [Op.in]: ids } } as any,
    });
    const batchDurationMs = Date.now() - batchStart;
    if (
      !Number.isSafeInteger(destroyedRows) ||
      destroyedRows < 0 ||
      destroyedRows > ids.length
    ) {
      throw new Error(
        `Article.destroy returned invalid deletion count: ${String(destroyedRows)}`,
      );
    }

    processedCount += ids.length;
    deletedCount += destroyedRows;
    lastId = Math.max(...ids);

    if (!didSampleEstimate && batchSize === DELETE_SAMPLE_SIZE) {
      didSampleEstimate = true;
      const perItemMs = batchDurationMs / ids.length;
      const remaining = eligibleCount - processedCount;
      const estimateMs = Math.round(perItemMs * remaining);
      const estimateMinutes = Math.round((estimateMs / 60000) * 10) / 10;
      logger.info(
        `Estimated time remaining: ~${estimateMinutes} minutes based on ${ids.length} processed articles.`,
      );
    }

    logger.info(
      `Deleted ${deletedCount} rows after processing ${processedCount} of ${eligibleCount} eligible articles (batch ${batchNumber}).`,
    );
  }

  return {
    daysOldThreshold,
    cutoffDate,
    eligibleCount,
    processedCount,
    deletedCount,
  };
}

export async function deleteOldestEligibleArticles(
  requestedCount: number,
): Promise<DeleteTrimResult> {
  const [relevantRows, approvedRows] = await Promise.all([
    ArticleIsRelevant.findAll({
      attributes: ["articleId"],
      raw: true,
    }),
    ArticleApproved.findAll({
      attributes: ["articleId"],
      raw: true,
    }),
  ]);

  const protectedIds = new Set<number>();

  for (const row of relevantRows) {
    const articleId = Number((row as { articleId?: number }).articleId);
    if (Number.isFinite(articleId)) {
      protectedIds.add(articleId);
    }
  }

  for (const row of approvedRows) {
    const articleId = Number((row as { articleId?: number }).articleId);
    if (Number.isFinite(articleId)) {
      protectedIds.add(articleId);
    }
  }

  const conditions: any[] = [
    { publishedDate: { [Op.not]: null } },
  ];

  if (protectedIds.size > 0) {
    conditions.push({ id: { [Op.notIn]: Array.from(protectedIds) } });
  }

  const rows = await Article.findAll({
    attributes: ["id"],
    where: { [Op.and]: conditions } as any,
    order: [
      ["publishedDate", "ASC"],
      ["id", "ASC"],
    ],
    limit: requestedCount,
    raw: true,
  });

  const ids = rows
    .map((row) => Number((row as { id?: number }).id))
    .filter((id) => Number.isFinite(id));

  const foundCount = ids.length;

  logger.info(
    `Found ${foundCount} eligible articles for trim (requested ${requestedCount}).`,
  );

  if (foundCount === 0) {
    return { requestedCount, foundCount, deletedCount: 0 };
  }

  let deletedCount = 0;
  let batchNumber = 0;

  for (let i = 0; i < ids.length; i += DELETE_BATCH_SIZE) {
    batchNumber += 1;
    const batchIds = ids.slice(i, i + DELETE_BATCH_SIZE);
    await Article.destroy({ where: { id: { [Op.in]: batchIds } } as any });
    deletedCount += batchIds.length;
    logger.info(
      `Deleted ${deletedCount} of ${foundCount} trim articles (batch ${batchNumber}).`,
    );
  }

  return { requestedCount, foundCount, deletedCount };
}
