import { sequelize } from '@newsnexus/db-models';
import logger from '../logger';

interface ActiveRunCache {
  runId: number | null;
  fetchedAt: number;
}

const CACHE_TTL_MS = 2000;

let cache: ActiveRunCache | null = null;

export const getActiveOrchestratorRunId = async (): Promise<number | null> => {
  const now = Date.now();

  if (cache !== null && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.runId;
  }

  try {
    const [rows] = await sequelize.query(
      `SELECT id FROM "OrchestratorRuns" WHERE status = 'running' LIMIT 1`,
      { raw: true }
    ) as [Array<{ id: number }>, unknown];

    const runId = rows.length > 0 ? rows[0].id : null;
    cache = { runId, fetchedAt: now };
    return runId;
  } catch (err) {
    logger.warn('activeRunGuard: failed to query active orchestrator run', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
};

export const invalidateActiveRunCache = (): void => {
  cache = null;
};
