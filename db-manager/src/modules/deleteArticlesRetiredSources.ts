import { Op, QueryTypes } from "sequelize";
import { Article, sequelize } from "@newsnexus/db-models";
import { logger } from "../config/logger";

const DELETE_BATCH_SIZE = 5000;
const SAMPLE_SIZE = 20;

export const RETIRED_SOURCE_NAMES = ["NewsAPI", "GNews", "NewsData.IO"] as const;

export type RetiredSourceName = (typeof RETIRED_SOURCE_NAMES)[number];

export type RetiredSourcesEligibleArticle = {
  articleId: number;
  title: string;
  publishedDate: string | null;
  sourceName: RetiredSourceName;
};

export type RetiredSourcesDeletionPreview = {
  totalCandidates: number;
  excludedByProtection: {
    relevant: number;
    approved: number;
    aiApproved: number;
    reportLinked: number;
  };
  totalExcluded: number;
  eligibleBeforeLimitCount: number;
  eligible: RetiredSourcesEligibleArticle[];
  selectedForDeletionCount: number;
  appliedLimit: number | null;
  sourceCounts: Record<RetiredSourceName, number>;
  missingSources: RetiredSourceName[];
};

export type DeleteRetiredSourcesArticlesOptions = {
  dryRun: boolean;
  limit?: number;
};

export type DeleteRetiredSourcesArticlesResult = {
  deletedCount: number;
  preview: RetiredSourcesDeletionPreview;
};

type RetiredSourcesCandidateRow = {
  articleId: number | string;
  title: string | null;
  publishedDate: string | null;
  sourceName: RetiredSourceName;
  isRelevantProtected: boolean | number | string | null;
  isApprovedProtected: boolean | number | string | null;
  isAiApprovedProtected: boolean | number | string | null;
  isReportLinkedProtected: boolean | number | string | null;
};

type SourceNameRow = {
  nameOfOrg: string | null;
};

const RETIRED_SOURCE_SQL_LIST = RETIRED_SOURCE_NAMES.map(
  (sourceName) => `'${sourceName.replace(/'/g, "''")}'`,
).join(", ");

const RETIRED_SOURCE_NAMES_SQL = `
  SELECT nas."nameOfOrg" AS "nameOfOrg"
  FROM "NewsArticleAggregatorSources" nas
  WHERE nas."nameOfOrg" IN (${RETIRED_SOURCE_SQL_LIST})
  ORDER BY nas."nameOfOrg" ASC;
`;

const RETIRED_SOURCES_CANDIDATES_SQL = `
  SELECT
    a."id" AS "articleId",
    COALESCE(a."title", '') AS "title",
    a."publishedDate" AS "publishedDate",
    nas."nameOfOrg" AS "sourceName",
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
  FROM "Articles" a
  INNER JOIN "EntityWhoFoundArticles" ewfa
    ON ewfa."id" = a."entityWhoFoundArticleId"
  INNER JOIN "NewsArticleAggregatorSources" nas
    ON nas."id" = ewfa."newsArticleAggregatorSourceId"
  WHERE nas."nameOfOrg" IN (${RETIRED_SOURCE_SQL_LIST})
  ORDER BY a."id" ASC;
`;

function assertValidLimit(limit?: number): void {
  if (limit === undefined) {
    return;
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(
      "--delete_articles_retired_sources limit requires a positive integer",
    );
  }
}

function isRetiredSourceName(value: string | null): value is RetiredSourceName {
  return RETIRED_SOURCE_NAMES.includes(value as RetiredSourceName);
}

function isTruthyProtectionValue(value: boolean | number | string | null): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function createEmptySourceCounts(): Record<RetiredSourceName, number> {
  return {
    NewsAPI: 0,
    GNews: 0,
    "NewsData.IO": 0,
  };
}

function toCandidate(
  row: RetiredSourcesCandidateRow,
): RetiredSourcesEligibleArticle {
  return {
    articleId: Number(row.articleId),
    title: row.title ?? "",
    publishedDate: row.publishedDate,
    sourceName: row.sourceName,
  };
}

async function getMissingSources(): Promise<RetiredSourceName[]> {
  const rows = await sequelize.query<SourceNameRow>(RETIRED_SOURCE_NAMES_SQL, {
    type: QueryTypes.SELECT,
  });
  const foundNames = new Set(
    rows
      .map((row) => row.nameOfOrg)
      .filter(isRetiredSourceName),
  );

  return RETIRED_SOURCE_NAMES.filter((sourceName) => !foundNames.has(sourceName));
}

function logPreview(
  preview: RetiredSourcesDeletionPreview,
  dryRun: boolean,
): void {
  logger.info(
    `${dryRun ? "Dry run:" : "Execute:"} found ${preview.totalCandidates} retired-source candidates before protections.`,
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
    `Source counts: NewsAPI ${preview.sourceCounts.NewsAPI}, GNews ${preview.sourceCounts.GNews}, NewsData.IO ${preview.sourceCounts["NewsData.IO"]}.`,
  );

  for (const sourceName of preview.missingSources) {
    logger.warn(
      `Retired source "${sourceName}" was not found in NewsArticleAggregatorSources; it contributed zero candidates.`,
    );
  }

  const sampleRows = preview.eligible.slice(0, SAMPLE_SIZE);
  for (const row of sampleRows) {
    logger.info(
      `Sample candidate articleId=${row.articleId} source=${row.sourceName} publishedDate=${row.publishedDate ?? "N/A"} title="${row.title}"`,
    );
  }
}

export async function getRetiredSourcesDeletionPreview(
  limit?: number,
): Promise<RetiredSourcesDeletionPreview> {
  assertValidLimit(limit);

  const missingSources = await getMissingSources();
  const rows = await sequelize.query<RetiredSourcesCandidateRow>(
    RETIRED_SOURCES_CANDIDATES_SQL,
    { type: QueryTypes.SELECT },
  );

  const excludedByProtection = {
    relevant: 0,
    approved: 0,
    aiApproved: 0,
    reportLinked: 0,
  };
  const eligibleBeforeLimit: RetiredSourcesEligibleArticle[] = [];
  const sourceCounts = createEmptySourceCounts();

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
    sourceCounts[candidate.sourceName] += 1;
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
    sourceCounts,
    missingSources,
  };
}

export async function deleteRetiredSourcesArticles({
  dryRun,
  limit,
}: DeleteRetiredSourcesArticlesOptions): Promise<DeleteRetiredSourcesArticlesResult> {
  const preview = await getRetiredSourcesDeletionPreview(limit);
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
      `Deleted ${deletedCount} of ${preview.selectedForDeletionCount} retired-source articles (batch ${batchNumber}).`,
    );
  }

  logger.info(`Deleted ${deletedCount} retired-source articles.`);
  return { deletedCount, preview };
}
