import dotenv from "dotenv";
import { QueryTypes } from "sequelize";
import { DEFAULT_DELETE_DAYS, parseCliArgs } from "./modules/cli";
import { DatabaseStatus } from "./types/status";

dotenv.config();

const { logger } = require("./config/logger") as typeof import("./config/logger");
const { ensureSchemaReady, initModels, sequelize } = require("@newsnexus/db-models") as typeof import("@newsnexus/db-models");

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logStatus(status: DatabaseStatus): void {
  const numberFormatter = new Intl.NumberFormat("en-US");
  const formatCount = (value: number) => numberFormatter.format(value);
  logger.info("Database status summary:");
  logger.info(`- Total articles: ${formatCount(status.totalArticles)}`);
  logger.info(
    `- Articles marked not relevant: ${formatCount(status.irrelevantArticles)}`,
  );
  logger.info(`- Articles approved: ${formatCount(status.approvedArticles)}`);
  logger.info(
    `- Articles older than ${status.cutoffDate}: ${formatCount(status.oldArticles)}`,
  );
  logger.info(
    `- Articles older than ${status.cutoffDate} and eligible for deletion: ${formatCount(status.deletableOldArticles)}`,
  );
}

async function ensureDatabaseExists(): Promise<void> {
  try {
    await ensureSchemaReady(sequelize);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Database schema is missing required table")) {
      throw error;
    }

    logger.info("🆕 Database schema not found. Creating schema with sequelize.sync().");
    await sequelize.sync();
  }
}

async function databaseHasData(): Promise<boolean> {
  const queryInterface = sequelize.getQueryInterface();
  const rawTables = await queryInterface.showAllTables();
  const tables = rawTables.map((table) => ({
    name:
      typeof table === "string"
        ? table
        : String((table as { tableName?: string }).tableName ?? table),
  }));

  for (const { name } of tables) {
    const rows = await sequelize.query(
      `SELECT 1 FROM "${name}" LIMIT 1;`,
      { type: QueryTypes.SELECT },
    );
    if (rows.length > 0) {
      return true;
    }
  }

  return false;
}

export async function runDbManager(
  args: string[] = process.argv.slice(2),
): Promise<number> {
  try {
    const options = parseCliArgs(args);
    const machineResults: Record<string, unknown>[] = [];

    if (options.dryRun) {
      const dryRunTargetCount = [
        options.zipFilePath,
        options.deleteArticlesNoState,
        options.deleteArticlesRetiredSources,
      ].filter(Boolean).length;

      if (dryRunTargetCount > 1) {
        process.stderr.write(
          "--dry_run cannot combine --zip_file, --delete_articles_no_state, and --delete_articles_retired_sources\n",
        );
        return 1;
      }

      if (options.zipFilePath) {
        const { runDryRunValidator } = await import("./modules/dryRunValidator");
        const result = await runDryRunValidator(options.zipFilePath);
        return result.success ? 0 : 1;
      }

      if (dryRunTargetCount === 0) {
        process.stderr.write(
          "--dry_run requires --zip_file <path>, --delete_articles_no_state, or --delete_articles_retired_sources\n",
        );
        return 1;
      }
    }

    initModels();

    const { getDatabaseStatus } = await import("./modules/status");
    const {
      deleteOldUnapprovedArticles,
      deleteOldestEligibleArticles,
    } = await import("./modules/deleteArticles");
    const { createDatabaseBackupZipFile } = await import("./modules/backup");
    const { BACKUP_MANIFEST_VERSION } = await import("./modules/backup");
    const { clearDuplicateAnalyses } = await import("./modules/clearDuplicateAnalyses");
    const { deleteNoStateArticles } = await import("./modules/deleteArticlesNoState");
    const { deleteRetiredSourcesArticles } = await import("./modules/deleteArticlesRetiredSources");
    const { importZipFileToDatabase, rebuildSchema } = await import("./modules/zipImport");

    if (options.dropDb) {
      logger.warn("--drop_db: wiping all data and rebuilding empty schema. This cannot be undone.");
      await rebuildSchema();
      logger.info("--drop_db: schema rebuilt successfully. All tables are empty.");
      await sequelize.close();
      return 0;
    }

    // --zip_file and --drop_db both call rebuildSchema() which creates the schema from
    // scratch, so ensureDatabaseExists() is both unnecessary and actively harmful for
    // those paths (it fails when the schema has been dropped). All other paths need a
    // healthy schema before they can run.
    if (!options.zipFilePath) {
      await ensureDatabaseExists();
    }

    if (options.dryRun && options.deleteArticlesNoState) {
      logger.info("Dry running no-state article deletion");
      await deleteNoStateArticles({
        dryRun: true,
        limit: options.deleteArticlesNoStateLimit,
      });
      await sequelize.close();
      return 0;
    }

    if (options.dryRun && options.deleteArticlesRetiredSources) {
      logger.info("Dry running retired-source article deletion");
      await deleteRetiredSourcesArticles({
        dryRun: true,
        limit: options.deleteArticlesRetiredSourcesLimit,
      });
      await sequelize.close();
      return 0;
    }

    if (options.clearDuplicateAnalyses) {
      logger.info("Clearing ArticleDuplicateAnalyses rows");
      machineResults.push(await clearDuplicateAnalyses());
    }

    if (options.createBackup) {
      logger.info("Creating database backup zip file");
      const backupPath = await createDatabaseBackupZipFile();
      logger.info(`Backup created at: ${backupPath}`);
      machineResults.push({
        command: "create_backup",
        success: true,
        archivePath: backupPath,
        manifestVersion: BACKUP_MANIFEST_VERSION,
      });
    }

    if (options.zipFilePath) {
      const hasData = await databaseHasData();
      if (hasData) {
        logger.warn(
          "Database already contains data. Import will rebuild the schema before restoring the zip.",
        );
      }

      logger.info(
        `Importing database updates from zip: ${options.zipFilePath}`,
      );
      const result = await importZipFileToDatabase(options.zipFilePath);
      logger.info(
        `Imported ${result.totalRecords} records across ${result.importedTables.length} tables`,
      );
      if (result.skippedFiles.length > 0) {
        logger.warn(
          `Skipped files with no matching model: ${result.skippedFiles.join(", ")}`,
        );
      }
    }

    if (options.deleteArticlesTrimCount !== undefined) {
      logger.info(
        `Trimming ${options.deleteArticlesTrimCount} oldest eligible articles without relevance or approval`,
      );
      const result = await deleteOldestEligibleArticles(
        options.deleteArticlesTrimCount,
      );
      logger.info(
        `Trimmed ${result.deletedCount} of ${result.foundCount} eligible articles (requested ${result.requestedCount}).`,
      );
    }

    if (options.deleteArticlesDays !== undefined) {
      const days = options.deleteArticlesDays ?? DEFAULT_DELETE_DAYS;
      logger.info(
        `Deleting articles older than ${days} days without relevance or approval`,
      );
      const result = await deleteOldUnapprovedArticles(days);
      logger.info(
        `Deleted ${result.deletedCount} articles older than ${result.cutoffDate}`,
      );
      machineResults.push({
        command: "delete_articles",
        success: true,
        foundCount: result.foundCount,
        deletedCount: result.deletedCount,
        cutoffDate: result.cutoffDate,
      });
    }

    if (options.deleteArticlesNoState) {
      const limitLabel =
        options.deleteArticlesNoStateLimit === undefined
          ? "all eligible"
          : `${options.deleteArticlesNoStateLimit}`;
      logger.info(`Deleting ${limitLabel} no-state articles`);
      const result = await deleteNoStateArticles({
        dryRun: false,
        limit: options.deleteArticlesNoStateLimit,
      });
      logger.info(`Deleted ${result.deletedCount} no-state articles.`);
    }

    if (options.deleteArticlesRetiredSources) {
      const limitLabel =
        options.deleteArticlesRetiredSourcesLimit === undefined
          ? "all eligible"
          : `${options.deleteArticlesRetiredSourcesLimit}`;
      logger.info(`Deleting ${limitLabel} retired-source articles`);
      const result = await deleteRetiredSourcesArticles({
        dryRun: false,
        limit: options.deleteArticlesRetiredSourcesLimit,
      });
      logger.info(`Deleted ${result.deletedCount} retired-source articles.`);
    }

    const status = await getDatabaseStatus();
    logStatus(status);

    for (const result of machineResults) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    }

    await sequelize.close();
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Fatal error: ${message}`, { error });
    console.error(message);
    await delay(100);
    return 1;
  }
}

if (require.main === module) {
  runDbManager().then((exitCode) => {
    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  });
}
