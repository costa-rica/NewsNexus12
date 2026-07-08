import { Op, QueryTypes } from "sequelize";
import { Article, sequelize } from "@newsnexus/db-models";
import { logger } from "../config/logger";

const DELETE_BATCH_SIZE = 5000;
const SAMPLE_SIZE = 20;

export type NoStateReasonCode = "null_state_id" | "missing_state_join";

export type NoStateEligibleArticle = {
  articleId: number;
  title: string;
  publishedDate: string | null;
  latestAssignmentId: number;
  reasonCode: NoStateReasonCode;
};

export type NoStateDeletionPreview = {
  totalCandidates: number;
  excludedByProtection: {
    relevant: number;
    approved: number;
    aiApproved: number;
    reportLinked: number;
  };
  totalExcluded: number;
  eligibleBeforeLimitCount: number;
  eligible: NoStateEligibleArticle[];
  selectedForDeletionCount: number;
  appliedLimit: number | null;
  reasonCodeCounts: Record<NoStateReasonCode, number>;
};

export type DeleteNoStateArticlesOptions = {
  dryRun: boolean;
  limit?: number;
};

export type DeleteNoStateArticlesResult = {
  deletedCount: number;
  preview: NoStateDeletionPreview;
};

type NoStateCandidateRow = {
  articleId: number | string;
  title: string | null;
  publishedDate: string | null;
  latestAssignmentId: number | string;
  reasonCode: NoStateReasonCode;
  isRelevantProtected: boolean | number | string | null;
  isApprovedProtected: boolean | number | string | null;
  isAiApprovedProtected: boolean | number | string | null;
  isReportLinkedProtected: boolean | number | string | null;
};

const NO_STATE_CANDIDATES_SQL = `
  WITH latest_assignments AS (
    SELECT asc2.*
    FROM "ArticleStateContracts02" asc2
    INNER JOIN (
      SELECT "articleId", MAX("id") AS "latestAssignmentId"
      FROM "ArticleStateContracts02"
      GROUP BY "articleId"
    ) latest ON latest."latestAssignmentId" = asc2."id"
  )
  SELECT
    a."id" AS "articleId",
    COALESCE(a."title", '') AS "title",
    a."publishedDate" AS "publishedDate",
    latest."id" AS "latestAssignmentId",
    CASE
      WHEN latest."stateId" IS NULL THEN 'null_state_id'
      ELSE 'missing_state_join'
    END AS "reasonCode",
    EXISTS (
      SELECT 1 FROM "ArticleIsRelevants" air WHERE air."articleId" = a."id"
    ) AS "isRelevantProtected",
    EXISTS (
      SELECT 1 FROM "ArticleApproveds" aa WHERE aa."articleId" = a."id"
    ) AS "isApprovedProtected",
    EXISTS (
      SELECT 1 FROM "ArticlesApproved02" aa2 WHERE aa2."articleId" = a."id"
    ) AS "isAiApprovedProtected",
    EXISTS (
      SELECT 1 FROM "ArticleReportContracts" arc WHERE arc."articleId" = a."id"
    ) AS "isReportLinkedProtected"
  FROM latest_assignments latest
  INNER JOIN "Articles" a ON a."id" = latest."articleId"
  LEFT JOIN "States" st ON st."id" = latest."stateId"
  WHERE latest."stateId" IS NULL OR st."id" IS NULL
  ORDER BY a."id" ASC;
`;

function assertValidLimit(limit?: number): void {
  if (limit === undefined) {
    return;
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("--delete_articles_no_state limit requires a positive integer");
  }
}

function isTruthyProtectionValue(value: boolean | number | string | null): boolean {
  return value === true || value === 1 || value === "true";
}

function toCandidate(row: NoStateCandidateRow): NoStateEligibleArticle {
  return {
    articleId: Number(row.articleId),
    title: row.title ?? "",
    publishedDate: row.publishedDate,
    latestAssignmentId: Number(row.latestAssignmentId),
    reasonCode: row.reasonCode,
  };
}

function logPreview(preview: NoStateDeletionPreview, dryRun: boolean): void {
  logger.info(
    `${dryRun ? "Dry run:" : "Execute:"} found ${preview.totalCandidates} no-state candidates before protections.`,
  );
  logger.info(
    `Excluded ${preview.totalExcluded} protected candidates (relevant ${preview.excludedByProtection.relevant}, approved ${preview.excludedByProtection.approved}, ai approved ${preview.excludedByProtection.aiApproved}, report linked ${preview.excludedByProtection.reportLinked}).`,
  );
  logger.info(
    `Eligible before limit: ${preview.eligibleBeforeLimitCount}; selected for deletion: ${preview.selectedForDeletionCount}.`,
  );

  if (preview.appliedLimit !== null) {
    logger.info(`Applied limit: ${preview.appliedLimit}.`);
  }

  logger.info(
    `Reason codes: null_state_id ${preview.reasonCodeCounts.null_state_id}, missing_state_join ${preview.reasonCodeCounts.missing_state_join}.`,
  );

  const sampleRows = preview.eligible.slice(0, SAMPLE_SIZE);
  for (const row of sampleRows) {
    logger.info(
      `Sample candidate articleId=${row.articleId} assignmentId=${row.latestAssignmentId} publishedDate=${row.publishedDate ?? "N/A"} reason=${row.reasonCode} title="${row.title}"`,
    );
  }
}

export async function getNoStateDeletionPreview(
  limit?: number,
): Promise<NoStateDeletionPreview> {
  assertValidLimit(limit);

  const rows = await sequelize.query<NoStateCandidateRow>(
    NO_STATE_CANDIDATES_SQL,
    { type: QueryTypes.SELECT },
  );

  const excludedByProtection = {
    relevant: 0,
    approved: 0,
    aiApproved: 0,
    reportLinked: 0,
  };
  const eligibleBeforeLimit: NoStateEligibleArticle[] = [];
  const reasonCodeCounts: Record<NoStateReasonCode, number> = {
    null_state_id: 0,
    missing_state_join: 0,
  };

  for (const row of rows) {
    if (isTruthyProtectionValue(row.isRelevantProtected)) {
      excludedByProtection.relevant += 1;
      continue;
    }

    if (isTruthyProtectionValue(row.isApprovedProtected)) {
      excludedByProtection.approved += 1;
      continue;
    }

    if (isTruthyProtectionValue(row.isAiApprovedProtected)) {
      excludedByProtection.aiApproved += 1;
      continue;
    }

    if (isTruthyProtectionValue(row.isReportLinkedProtected)) {
      excludedByProtection.reportLinked += 1;
      continue;
    }

    const candidate = toCandidate(row);
    eligibleBeforeLimit.push(candidate);
    reasonCodeCounts[candidate.reasonCode] += 1;
  }

  const totalExcluded =
    excludedByProtection.relevant +
    excludedByProtection.approved +
    excludedByProtection.aiApproved +
    excludedByProtection.reportLinked;
  const eligible =
    limit === undefined
      ? eligibleBeforeLimit
      : eligibleBeforeLimit.slice(0, limit);

  return {
    totalCandidates: rows.length,
    excludedByProtection,
    totalExcluded,
    eligibleBeforeLimitCount: eligibleBeforeLimit.length,
    eligible,
    selectedForDeletionCount: eligible.length,
    appliedLimit: limit ?? null,
    reasonCodeCounts,
  };
}

export async function deleteNoStateArticles({
  dryRun,
  limit,
}: DeleteNoStateArticlesOptions): Promise<DeleteNoStateArticlesResult> {
  const preview = await getNoStateDeletionPreview(limit);
  logPreview(preview, dryRun);

  if (dryRun || preview.eligible.length === 0) {
    return { deletedCount: 0, preview };
  }

  let deletedCount = 0;
  let batchNumber = 0;

  for (let i = 0; i < preview.eligible.length; i += DELETE_BATCH_SIZE) {
    batchNumber += 1;
    const batchIds = preview.eligible
      .slice(i, i + DELETE_BATCH_SIZE)
      .map((row) => row.articleId);

    await Article.destroy({ where: { id: { [Op.in]: batchIds } } as any });
    deletedCount += batchIds.length;
    logger.info(
      `Deleted ${deletedCount} of ${preview.selectedForDeletionCount} no-state articles (batch ${batchNumber}).`,
    );
  }

  logger.info(`Deleted ${deletedCount} no-state articles.`);
  return { deletedCount, preview };
}
