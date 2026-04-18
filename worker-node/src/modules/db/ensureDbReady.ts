import { ensureSchemaReady, initModels, sequelize } from '@newsnexus/db-models';

let dbReadyPromise: Promise<void> | null = null;

export const ensureDbReady = async (): Promise<void> => {
  if (dbReadyPromise) {
    return dbReadyPromise;
  }

  dbReadyPromise = (async () => {
    initModels();
    await ensureSchemaReady(sequelize);
  })();

  return dbReadyPromise;
};

export default ensureDbReady;
