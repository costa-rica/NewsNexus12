import { Op } from "sequelize";
import {
  Article,
  ArticleApproved,
  ArticleIsRelevant,
} from "@newsnexus/db-models";
import { logger } from "../config/logger";

const DELETE_BATCH_SIZE = 5000;
const DELETE_SAMPLE_SIZE = 1000;

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export type DeleteArticlesResult = {
  deletedCount: number;
  cutoffDate: string;
};

export type DeleteTrimResult = {
  requestedCount: number;
  foundCount: number;
  deletedCount: number;
};

export async function deleteOldUnapprovedArticles(
  daysOldThreshold: number,
): Promise<DeleteArticlesResult> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOldThreshold);
  const cutoffDateOnly = toDateOnly(cutoffDate);

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
    { publishedDate: { [Op.lt]: cutoffDateOnly } },
  ];

  if (protectedIds.size > 0) {
    conditions.push({ id: { [Op.notIn]: Array.from(protectedIds) } });
  }

  const totalToDelete = await Article.count({
    where: { [Op.and]: conditions } as any,
  });

  logger.info(
    `Found ${totalToDelete} articles eligible for deletion (before ${cutoffDateOnly}).`,
  );

  if (totalToDelete === 0) {
    return { deletedCount: 0, cutoffDate: cutoffDateOnly };
  }

  let deletedCount = 0;
  let lastId = 0;
  let batchNumber = 0;
  let didSampleEstimate = false;

  while (deletedCount < totalToDelete) {
    batchNumber += 1;
    const batchSize =
      !didSampleEstimate && totalToDelete > DELETE_BATCH_SIZE
        ? DELETE_SAMPLE_SIZE
        : DELETE_BATCH_SIZE;
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
      .filter((id) => Number.isFinite(id));

    if (ids.length === 0) {
      break;
    }

    const batchStart = Date.now();
    await Article.destroy({ where: { id: { [Op.in]: ids } } as any });
    const batchDurationMs = Date.now() - batchStart;
    deletedCount += ids.length;
    lastId = ids[ids.length - 1];

    if (!didSampleEstimate && batchSize === DELETE_SAMPLE_SIZE) {
      didSampleEstimate = true;
      const perItemMs = batchDurationMs / ids.length;
      const remaining = totalToDelete - deletedCount;
      const estimateMs = Math.round(perItemMs * remaining);
      const estimateMinutes = Math.round((estimateMs / 60000) * 10) / 10;
      logger.info(
        `Estimated time remaining: ~${estimateMinutes} minutes based on ${ids.length} deletions.`,
      );
    }

    logger.info(
      `Deleted ${deletedCount} of ${totalToDelete} articles (batch ${batchNumber}).`,
    );
  }

  return { deletedCount, cutoffDate: cutoffDateOnly };
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
