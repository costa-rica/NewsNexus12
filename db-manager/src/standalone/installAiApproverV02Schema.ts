import dotenv from "dotenv";

dotenv.config();

const { sequelize } =
  require("@newsnexus/db-models") as typeof import("@newsnexus/db-models");
const { logger } =
  require("../config/logger") as typeof import("../config/logger");

async function main(): Promise<number> {
  try {
    const { installAiApproverV02Schema } = await import(
      "../modules/installAiApproverV02Schema"
    );
    const result = await installAiApproverV02Schema();

    for (const tableName of result.createdTables) {
      logger.info(`AI Approver V02 schema created table: ${tableName}`);
    }
    for (const tableName of result.retainedTables) {
      logger.info(`AI Approver V02 schema retained compatible table: ${tableName}`);
    }

    logger.info(
      `AI Approver V02 schema ready: ${result.createdTables.length} created, ${result.retainedTables.length} retained`,
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`AI Approver V02 schema installation failed: ${message}`, {
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
