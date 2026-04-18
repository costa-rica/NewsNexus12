import { sequelize } from "@newsnexus/db-models";
import { QueryTypes } from "sequelize";
import logger from "../logger";

const sequelizeAny = sequelize as any;

type StateAssignerSqlOptions = {
  includeNullState?: boolean;
  targetArticleThresholdDaysOld?: number;
};

/**
 * Query articles with their state assignments from ArticleStateContracts02
 * @param {Object} params - Query parameters
 * @param {boolean} params.includeNullState - If true, return articles with null stateId; if false, return only non-null
 * @param {number} params.targetArticleThresholdDaysOld - Filter articles published within the last N days
 * @returns {Promise<Array>} Array of articles with state assignment data
 */
async function sqlQueryArticlesWithStateAssignments({
  includeNullState,
  targetArticleThresholdDaysOld,
}: StateAssignerSqlOptions): Promise<Array<Record<string, any>>> {
  const replacements: Record<string, unknown> = {};
  const whereClauses = [];

  // Filter based on includeNullState parameter
  if (includeNullState === true) {
    whereClauses.push(`asc02."stateId" IS NULL`);
  } else {
    whereClauses.push(`asc02."stateId" IS NOT NULL`);
  }

  // Filter based on targetArticleThresholdDaysOld parameter
  if (
    targetArticleThresholdDaysOld !== undefined &&
    targetArticleThresholdDaysOld !== null
  ) {
    const targetDate = new Date();
    targetDate.setUTCDate(
      targetDate.getUTCDate() - targetArticleThresholdDaysOld,
    );

    whereClauses.push(
      `a."publishedDate" > :targetPublishedDate`,
    );
    replacements.targetPublishedDate = targetDate.toISOString();
  }

  const whereString =
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const sql = `
    SELECT
      a.id AS "articleId",
      a.title,
      a.description,
      a.url,
      a."createdAt",
      a."publishedDate",
      asc02."promptId",
      asc02."isHumanApproved",
      asc02."isDeterminedToBeError",
      asc02."occuredInTheUS",
      asc02."reasoning",
      asc02."stateId",
      s.name AS "stateName"
    FROM "Articles" a
    INNER JOIN "ArticleStateContracts02" asc02 ON asc02."articleId" = a.id
    LEFT JOIN "States" s ON s.id = asc02."stateId"
    ${whereString}
    ORDER BY a."createdAt" DESC;
  `;

  logger.info(
    `Executing sqlQueryArticlesWithStateAssignments with includeNullState: ${includeNullState}, targetArticleThresholdDaysOld: ${targetArticleThresholdDaysOld ?? "not provided"}`,
  );

  const results = await sequelizeAny.query(sql, {
    replacements,
    type: QueryTypes.SELECT,
  });

  logger.info(`Found ${results.length} articles with state assignments`);

  return results;
}

export { sqlQueryArticlesWithStateAssignments };
