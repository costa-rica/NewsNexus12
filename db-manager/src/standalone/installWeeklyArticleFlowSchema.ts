import dotenv from "dotenv";

dotenv.config();

const { sequelize } =
  require("@newsnexus/db-models") as typeof import("@newsnexus/db-models");
const { logger } =
  require("../config/logger") as typeof import("../config/logger");

async function main(): Promise<number> {
  try {
    const { installWeeklyArticleFlowSchema } = await import(
      "../modules/installWeeklyArticleFlowSchema"
    );
    const result = await installWeeklyArticleFlowSchema();

    logger.info("Weekly article flow schema ready", result);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Weekly article flow schema installation failed: ${message}`, {
      error,
    });
    return 1;
  } finally {
    await sequelize.close();
  }
}

if (require.main === module) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

export { main };
