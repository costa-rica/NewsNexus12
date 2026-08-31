import { Op } from "sequelize";
import { ArticleDuplicateAnalysis } from "@newsnexus/db-models";

export const DEFAULT_DUPLICATE_ANALYSIS_BATCH_SIZE = 5000;

export type ClearDuplicateAnalysesResult = {
  command: "clear_duplicate_analyses";
  success: true;
  beforeCount: number;
  deletedCount: number;
  remainingCount: number;
  batchCount: number;
};

export async function clearDuplicateAnalyses(
  batchSize = DEFAULT_DUPLICATE_ANALYSIS_BATCH_SIZE,
): Promise<ClearDuplicateAnalysesResult> {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error("Duplicate-analysis batch size must be a positive integer");
  }

  const beforeCount = await ArticleDuplicateAnalysis.count();
  let deletedCount = 0;
  let batchCount = 0;

  while (true) {
    const rows = await ArticleDuplicateAnalysis.findAll({
      attributes: ["id"],
      order: [["id", "ASC"]],
      limit: batchSize,
      raw: true,
    });
    const ids = rows.map((row) => Number(row.id)).filter(Number.isFinite);
    if (ids.length === 0) {
      break;
    }

    const removed = await ArticleDuplicateAnalysis.destroy({
      where: { id: { [Op.in]: ids } },
    });
    if (removed !== ids.length) {
      throw new Error(
        `Duplicate-analysis cleanup expected to delete ${ids.length} rows but deleted ${removed}`,
      );
    }
    deletedCount += removed;
    batchCount += 1;
  }

  const remainingCount = await ArticleDuplicateAnalysis.count();
  if (remainingCount !== 0 || deletedCount !== beforeCount) {
    throw new Error(
      `Duplicate-analysis cleanup verification failed: before=${beforeCount}, deleted=${deletedCount}, remaining=${remainingCount}`,
    );
  }

  return {
    command: "clear_duplicate_analyses",
    success: true,
    beforeCount,
    deletedCount,
    remainingCount,
    batchCount,
  };
}
