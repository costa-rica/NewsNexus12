import archiver from "archiver";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { Parser } from "json2csv";
import * as db from "@newsnexus/db-models";
import { logger } from "../config/logger";

type ModelRegistry = Record<string, { findAll: Function }>;

export const BACKUP_MANIFEST_VERSION = 1;

export interface BackupManifestEntry {
  modelName: string;
  csvFilename: string | null;
  rowCount: number;
  byteSize: number | null;
  sha256: string | null;
}

export interface BackupManifest {
  version: number;
  createdAt: string;
  models: BackupManifestEntry[];
}

export interface DatabaseBackupResult {
  backupPath: string;
  byteSize: number;
  sha256: string;
  manifestVersion: number;
}

function getModelRegistry(): ModelRegistry {
  const registry: ModelRegistry = {};
  // Excluded models (e.g. ArticleEmbedding) are regenerated after import, not backed up.
  const excludedModels = new Set<string>(db.BACKUP_EXCLUDED_MODELS ?? []);

  for (const [name, value] of Object.entries(db)) {
    if (excludedModels.has(name)) {
      continue;
    }
    if (value && typeof (value as { findAll?: Function }).findAll === "function") {
      registry[name] = value as { findAll: Function };
    }
  }

  return registry;
}

function getTimestamp(): string {
  return new Date().toISOString().replace(/[-T:.Z]/g, "").slice(0, 15);
}

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const input = fs.createReadStream(filePath);

  return new Promise((resolve, reject) => {
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

export function formatDatabaseBackupResult(result: DatabaseBackupResult): string {
  return JSON.stringify({ event: "database_backup_created", ...result });
}

export async function createDatabaseBackupZipFile(): Promise<DatabaseBackupResult> {
  const backupRoot = process.env.PATH_DB_BACKUPS;

  if (!backupRoot) {
    throw new Error("PATH_DB_BACKUPS is required to create backups");
  }

  const resolvedBackupRoot = path.resolve(backupRoot);
  const timestamp = getTimestamp();
  const backupDir = path.join(resolvedBackupRoot, `db_backup_${timestamp}`);
  const zipFilePath = path.join(resolvedBackupRoot, `db_backup_${timestamp}.zip`);

  logger.info(`Backup directory: ${backupDir}`);
  await fs.promises.mkdir(backupDir, { recursive: true });

  const registry = getModelRegistry();
  let hasData = false;
  const manifest: BackupManifest = {
    version: BACKUP_MANIFEST_VERSION,
    createdAt: new Date().toISOString(),
    models: [],
  };

  try {
    for (const tableName of Object.keys(registry)) {
      const records = await registry[tableName].findAll({ raw: true });
      if (!records || records.length === 0) {
        manifest.models.push({
          modelName: tableName,
          csvFilename: null,
          rowCount: 0,
          byteSize: null,
          sha256: null,
        });
        continue;
      }

      const json2csvParser = new Parser();
      const csvData = json2csvParser.parse(records);
      const filePath = path.join(backupDir, `${tableName}.csv`);
      const csvBuffer = Buffer.from(csvData, "utf8");
      await fs.promises.writeFile(filePath, csvBuffer);
      manifest.models.push({
        modelName: tableName,
        csvFilename: `${tableName}.csv`,
        rowCount: records.length,
        byteSize: csvBuffer.byteLength,
        sha256: crypto.createHash("sha256").update(csvBuffer).digest("hex"),
      });
      hasData = true;
    }

    if (!hasData) {
      await fs.promises.rm(backupDir, { recursive: true, force: true });
      throw new Error("No data found in any tables. Backup skipped.");
    }

    await fs.promises.writeFile(
      path.join(backupDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );

    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(zipFilePath);
      const archive = archiver("zip", { zlib: { level: 9 } });

      output.on("close", () => resolve());
      output.on("error", reject);
      archive.on("error", (error: Error) => reject(error));

      archive.pipe(output);
      archive.directory(backupDir, false);
      archive.finalize();
    });

    await fs.promises.rm(backupDir, { recursive: true, force: true });
    const archiveStats = await fs.promises.stat(zipFilePath);
    if (!archiveStats.isFile() || archiveStats.size <= 0) {
      throw new Error("Database backup archive is not a non-empty regular file");
    }

    const result: DatabaseBackupResult = {
      backupPath: zipFilePath,
      byteSize: archiveStats.size,
      sha256: await sha256File(zipFilePath),
      manifestVersion: BACKUP_MANIFEST_VERSION,
    };
    logger.info(`Backup created: ${zipFilePath}`);
    return result;
  } catch (error) {
    await fs.promises.rm(backupDir, { recursive: true, force: true });
    await fs.promises.rm(zipFilePath, { force: true });
    logger.error("Error creating database backup", { error });
    throw error;
  }
}
