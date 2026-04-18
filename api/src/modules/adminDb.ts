import fs from "fs";
import path from "path";
import logger from "./logger";
import * as db from "@newsnexus/db-models";

import { promisify } from "util";
import archiver from "archiver";
import { Parser } from "json2csv";
const mkdirAsync = promisify(fs.mkdir);
const writeFileAsync = promisify(fs.writeFile);

type ModelRegistry = Record<string, { findAll: Function; bulkCreate: Function }>;

function getModelRegistry(): ModelRegistry {
  const registry: ModelRegistry = {};

  for (const [name, value] of Object.entries(db)) {
    if (
      value &&
      typeof (value as { findAll?: Function }).findAll === "function" &&
      typeof (value as { bulkCreate?: Function }).bulkCreate === "function"
    ) {
      registry[name] = value as { findAll: Function; bulkCreate: Function };
    }
  }

  return registry;
}

async function createDatabaseBackupZipFile(suffix = ""): Promise<string> {
  logger.info(`suffix: ${suffix}`);
  try {
    const backupsDir = process.env.PATH_DB_BACKUPS;
    if (!backupsDir) {
      throw new Error("PATH_DB_BACKUPS is not configured");
    }

    const timestamp = new Date()
      .toISOString()
      .replace(/[-T:.Z]/g, "")
      .slice(0, 15);

    const backupDir = path.join(backupsDir, `db_backup_${timestamp}${suffix}`);
    logger.info(`Backup directory: ${backupDir}`);
    await mkdirAsync(backupDir, { recursive: true });

    let hasData = false;
    const models = getModelRegistry();

    for (const tableName in models) {
      if (models.hasOwnProperty(tableName)) {
        const records = await models[tableName].findAll({ raw: true });
        if (records.length === 0) continue;

        const json2csvParser = new Parser();
        const csvData = json2csvParser.parse(records);

        const filePath = path.join(backupDir, `${tableName}.csv`);
        await writeFileAsync(filePath, csvData);
        hasData = true;
      }
    }

    if (!hasData) {
      await fs.promises.rmdir(backupDir, { recursive: true });
      throw new Error("No data found in any tables. Backup skipped.");
    }

    const zipFileName = `db_backup_${timestamp}${suffix}.zip`;
    const zipFilePath = path.join(backupsDir, zipFileName);
    const output = fs.createWriteStream(zipFilePath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    return new Promise((resolve, reject) => {
      output.on("close", () => resolve(zipFilePath));
      archive.on("error", reject);
      archive.pipe(output);
      archive.directory(backupDir, false);
      archive.finalize().then(() => {
        fs.promises.rmdir(backupDir, { recursive: true });
      });
    });
  } catch (error: any) {
    logger.error("Error creating database backup:", error);
    throw error;
  }
}

export { createDatabaseBackupZipFile };
