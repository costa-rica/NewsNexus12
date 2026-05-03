import {
  Article,
  ArticleApproved,
  ArticleIsRelevant,
  sequelize
} from '@newsnexus/db-models';
import ensureDbReady from '../db/ensureDbReady';
import logger from '../logger';
import { QueueExecutionContext } from '../queue/queueEngine';

const DEFAULT_DELETE_BATCH_SIZE = 1000;
const DELETE_SAMPLE_SIZE = 1000;
const DEFAULT_DAYS_OLD_THRESHOLD = 180;

export interface DeleteArticlesJobInput {
  daysOld?: number;
  trimCount?: number;
  batchSize?: number;
}

export interface DeleteArticlesJobResult {
  deletedCount: number;
  cutoffDate?: string;
  trimRequested?: number;
  trimFound?: number;
  batchSize: number;
}

const parsePositiveInteger = (value: string | undefined): number | undefined => {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const resolveDeleteBatchSize = (inputBatchSize?: number): number =>
  inputBatchSize ??
  parsePositiveInteger(process.env.DELETE_ARTICLES_BATCH_SIZE) ??
  DEFAULT_DELETE_BATCH_SIZE;

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function getProtectedIds(): Promise<number[]> {
  const [relevantRows, approvedRows] = await Promise.all([
    ArticleIsRelevant.findAll({ attributes: ['articleId'], raw: true }),
    ArticleApproved.findAll({ attributes: ['articleId'], raw: true })
  ]);

  const protectedIds = new Set<number>();
  for (const row of relevantRows) {
    const id = Number((row as { articleId?: number }).articleId);
    if (Number.isFinite(id)) protectedIds.add(id);
  }
  for (const row of approvedRows) {
    const id = Number((row as { articleId?: number }).articleId);
    if (Number.isFinite(id)) protectedIds.add(id);
  }
  return Array.from(protectedIds);
}

async function deleteOldUnapprovedArticles(
  daysOldThreshold: number,
  batchSize: number,
  signal: AbortSignal
): Promise<{ deletedCount: number; cutoffDate: string }> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOldThreshold);
  const cutoffDateOnly = toDateOnly(cutoffDate);

  const protectedIds = await getProtectedIds();
  const protectedClause =
    protectedIds.length > 0
      ? `AND "Article"."id" NOT IN (${protectedIds.join(',')})`
      : '';

  const [[countRow]] = await sequelize.query(
    `SELECT COUNT(*) AS count FROM "Articles" AS "Article"
     WHERE "Article"."publishedDate" < :cutoff ${protectedClause}`,
    { replacements: { cutoff: cutoffDateOnly }, raw: true }
  ) as [Array<Record<string, unknown>>, unknown];

  const totalToDelete = Number((countRow as { count?: unknown }).count ?? 0);

  logger.info(`Found ${totalToDelete} articles eligible for deletion (before ${cutoffDateOnly}).`);

  if (totalToDelete === 0) {
    return { deletedCount: 0, cutoffDate: cutoffDateOnly };
  }

  let deletedCount = 0;
  let lastId = 0;
  let batchNumber = 0;
  let didSampleEstimate = false;

  while (deletedCount < totalToDelete) {
    if (signal.aborted) break;
    batchNumber += 1;
    const currentBatchSize =
      !didSampleEstimate && totalToDelete > batchSize ? Math.min(DELETE_SAMPLE_SIZE, batchSize) : batchSize;

    const rows = await Article.findAll({
      attributes: ['id'],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      where: sequelize.and(
        sequelize.literal(`"Article"."publishedDate" < '${cutoffDateOnly}'`),
        sequelize.literal(`"Article"."id" > ${lastId}`),
        ...(protectedIds.length > 0 ? [sequelize.literal(`"Article"."id" NOT IN (${protectedIds.join(',')})`)] : [])
      ) as unknown as any,
      order: [['id', 'ASC']],
      limit: currentBatchSize,
      raw: true
    });

    if (rows.length === 0) break;

    const ids = rows
      .map((row) => Number((row as { id?: number }).id))
      .filter((id) => Number.isFinite(id));

    if (ids.length === 0) break;

    const batchStart = Date.now();
    await Article.destroy({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      where: sequelize.literal(`"id" IN (${ids.join(',')})`) as unknown as any
    });
    const batchDurationMs = Date.now() - batchStart;
    deletedCount += ids.length;
    lastId = ids[ids.length - 1];

    if (!didSampleEstimate && currentBatchSize === DELETE_SAMPLE_SIZE) {
      didSampleEstimate = true;
      const perItemMs = batchDurationMs / ids.length;
      const remaining = totalToDelete - deletedCount;
      const estimateMinutes = Math.round((perItemMs * remaining) / 60000 * 10) / 10;
      logger.info(
        `Estimated time remaining: ~${estimateMinutes} minutes based on ${ids.length} deletions.`
      );
    }

    logger.info(`Deleted ${deletedCount} of ${totalToDelete} articles (batch ${batchNumber}).`);
  }

  return { deletedCount, cutoffDate: cutoffDateOnly };
}

async function trimOldestEligibleArticles(
  requestedCount: number,
  batchSize: number,
  signal: AbortSignal
): Promise<{ trimRequested: number; trimFound: number; deletedCount: number }> {
  const protectedIds = await getProtectedIds();
  const protectedClause =
    protectedIds.length > 0
      ? `AND "Article"."id" NOT IN (${protectedIds.join(',')})`
      : '';

  const rows = await Article.findAll({
    attributes: ['id'],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    where: sequelize.and(
      sequelize.literal('"Article"."publishedDate" IS NOT NULL'),
      ...(protectedIds.length > 0 ? [sequelize.literal(`"Article"."id" NOT IN (${protectedIds.join(',')})`)] : [])
    ) as unknown as any,
    order: [['publishedDate', 'ASC'], ['id', 'ASC']],
    limit: requestedCount,
    raw: true
  });

  void protectedClause;

  const ids = rows
    .map((row) => Number((row as { id?: number }).id))
    .filter((id) => Number.isFinite(id));

  const trimFound = ids.length;
  logger.info(`Found ${trimFound} eligible articles for trim (requested ${requestedCount}).`);

  if (trimFound === 0) {
    return { trimRequested: requestedCount, trimFound: 0, deletedCount: 0 };
  }

  let deletedCount = 0;
  let batchNumber = 0;

  for (let i = 0; i < ids.length; i += batchSize) {
    if (signal.aborted) break;
    batchNumber += 1;
    const batchIds = ids.slice(i, i + batchSize);
    await Article.destroy({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      where: sequelize.literal(`"id" IN (${batchIds.join(',')})`) as unknown as any
    });
    deletedCount += batchIds.length;
    logger.info(`Deleted ${deletedCount} of ${trimFound} trim articles (batch ${batchNumber}).`);
  }

  return { trimRequested: requestedCount, trimFound, deletedCount };
}

export const createDeleteArticlesJobHandler = (input: DeleteArticlesJobInput) => {
  return async (queueContext: QueueExecutionContext): Promise<void> => {
    const { signal } = queueContext;
    const daysOld = input.daysOld ?? DEFAULT_DAYS_OLD_THRESHOLD;
    const batchSize = resolveDeleteBatchSize(input.batchSize);

    logger.info('Delete articles job started', {
      jobId: queueContext.jobId,
      daysOld,
      trimCount: input.trimCount,
      batchSize
    });

    await ensureDbReady();

    const result: DeleteArticlesJobResult = { deletedCount: 0, batchSize };

    if (input.trimCount !== undefined && input.trimCount > 0) {
      const trimResult = await trimOldestEligibleArticles(input.trimCount, batchSize, signal);
      result.deletedCount = trimResult.deletedCount;
      result.trimRequested = trimResult.trimRequested;
      result.trimFound = trimResult.trimFound;
    } else {
      const deleteResult = await deleteOldUnapprovedArticles(daysOld, batchSize, signal);
      result.deletedCount = deleteResult.deletedCount;
      result.cutoffDate = deleteResult.cutoffDate;
    }

    await queueContext.updateResult({
      deletedCount: result.deletedCount,
      daysOldThreshold: daysOld,
      batchSize,
      ...(result.cutoffDate !== undefined ? { cutoffDate: result.cutoffDate } : {}),
      ...(result.trimRequested !== undefined ? { trimRequested: result.trimRequested } : {}),
      ...(result.trimFound !== undefined ? { trimFound: result.trimFound } : {})
    });

    logger.info('Delete articles job completed', {
      jobId: queueContext.jobId,
      ...result
    });
  };
};
