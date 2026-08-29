import { ensureSchemaReady, initModels, sequelize } from '@newsnexus/db-models';

const REQUIRED_TABLES = [
  'Articles',
  'Users',
  'States',
] as const;

const REBUILD_INSTRUCTIONS =
  'If these tables are missing, run the DB rebuild: ' +
  '(1) db-manager --create_backup, (2) cd db-models && npm run build, ' +
  '(3) db-manager --zip_file <path>. The ZIP import rebuilds the schema.';

let dbReadyPromise: Promise<void> | null = null;

export const ensureDbReady = async (): Promise<void> => {
  if (dbReadyPromise) {
    return dbReadyPromise;
  }

  dbReadyPromise = (async () => {
    initModels();
    try {
      await ensureSchemaReady(sequelize, REQUIRED_TABLES);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`${message} ${REBUILD_INSTRUCTIONS}`);
    }
  })();

  return dbReadyPromise;
};

export default ensureDbReady;
