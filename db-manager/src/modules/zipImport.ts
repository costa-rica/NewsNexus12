import AdmZip from "adm-zip";
import csvParser from "csv-parser";
import fs from "fs";
import os from "os";
import path from "path";
import { DataTypes } from "sequelize";
import * as db from "@newsnexus/db-models";
import { sequelize } from "@newsnexus/db-models";
import { logger } from "../config/logger";

type ImportZipResult = {
  totalRecords: number;
  importedTables: string[];
  skippedFiles: string[];
};

type ModelRegistry = Record<string, { bulkCreate: Function; rawAttributes?: Record<string, unknown> }>;

function getModelRegistry(): ModelRegistry {
  const registry: ModelRegistry = {};

  for (const [name, value] of Object.entries(db)) {
    if (value && typeof (value as { bulkCreate?: Function }).bulkCreate === "function") {
      registry[name] = value as { bulkCreate: Function };
    }
  }

  return registry;
}

type DateFieldInfo = {
  field: string;
  typeKey: "DATE" | "DATEONLY";
};

const IMPORT_BATCH_SIZE = 1000;
const INITIAL_PROGRESS_LOG_THRESHOLD = 1000;
const LARGE_PROGRESS_LOG_INTERVAL = 100000;

function getDateFields(model: { rawAttributes?: Record<string, unknown> }): DateFieldInfo[] {
  if (!model.rawAttributes) {
    return [];
  }

  const results: DateFieldInfo[] = [];

  for (const [field, attribute] of Object.entries(model.rawAttributes)) {
    const type = (attribute as { type?: { key?: string; constructor?: { name?: string } } }).type;
    const key = type?.key ?? type?.constructor?.name;

    if (key === DataTypes.DATE.key || key === DataTypes.DATEONLY.key) {
      const typeKey = key === DataTypes.DATE.key ? "DATE" : "DATEONLY";
      results.push({ field, typeKey });
    }
  }

  return results;
}

export function normalizeDateValue(value: unknown, typeKey: "DATE" | "DATEONLY"): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Date.parse(trimmed);
    if (Number.isNaN(parsed)) {
      return null;
    }

    const iso = new Date(parsed).toISOString();
    return typeKey === "DATEONLY" ? iso.slice(0, 10) : iso;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    const iso = new Date(value).toISOString();
    return typeKey === "DATEONLY" ? iso.slice(0, 10) : iso;
  }

  const parsed = Date.parse(String(value));
  if (Number.isNaN(parsed)) {
    return null;
  }

  const iso = new Date(parsed).toISOString();
  return typeKey === "DATEONLY" ? iso.slice(0, 10) : iso;
}

export function sanitizeDateFields(
  records: Record<string, string | null>[],
  dateFields: DateFieldInfo[],
): number {
  if (dateFields.length === 0 || records.length === 0) {
    return 0;
  }

  let sanitizedCount = 0;

  for (const record of records) {
    for (const { field, typeKey } of dateFields) {
      if (!(field in record)) {
        continue;
      }

      const normalized = normalizeDateValue(record[field], typeKey);
      if (normalized === null && record[field] !== null) {
        sanitizedCount += 1;
      }
      record[field] = normalized;
    }
  }

  return sanitizedCount;
}

async function collectCsvFiles(rootDir: string): Promise<string[]> {
  const entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectCsvFiles(fullPath)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".csv")) {
      results.push(fullPath);
    }
  }

  return results;
}

async function readCsvFile(filePath: string): Promise<Record<string, string | null>[]> {
  const records: Record<string, string | null>[] = [];

  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csvParser())
      .on("data", (row) => records.push(row))
      .on("end", () => resolve())
      .on("error", (error) => reject(error));
  });

  return records;
}

async function importCsvFileInBatches(
  filePath: string,
  tableName: string,
  model: { bulkCreate: Function; rawAttributes?: Record<string, unknown> },
): Promise<{ importedCount: number; sanitizedDates: number }> {
  const dateFields = getDateFields(model);
  let importedCount = 0;
  let sanitizedDates = 0;
  let batch: Record<string, string | null>[] = [];
  let nextProgressLogAt = INITIAL_PROGRESS_LOG_THRESHOLD;

  const flushBatch = async (): Promise<void> => {
    if (batch.length === 0) {
      return;
    }

    sanitizedDates += sanitizeDateFields(batch, dateFields);
    await model.bulkCreate(batch, { ignoreDuplicates: true });
    importedCount += batch.length;
    batch = [];
  };

  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath).pipe(csvParser());

    const handleError = (error: unknown): void => {
      reject(error);
    };

    stream.on("data", (row) => {
      stream.pause();
      batch.push(row);

      void (async () => {
        try {
          if (batch.length >= IMPORT_BATCH_SIZE) {
            await flushBatch();
            if (importedCount >= nextProgressLogAt) {
              logger.info(
                `Imported ${importedCount.toLocaleString("en-US")} records into ${tableName}`,
              );
              nextProgressLogAt =
                nextProgressLogAt === INITIAL_PROGRESS_LOG_THRESHOLD
                  ? LARGE_PROGRESS_LOG_INTERVAL
                  : nextProgressLogAt + LARGE_PROGRESS_LOG_INTERVAL;
            }
          }
          stream.resume();
        } catch (error) {
          stream.destroy(error as Error);
        }
      })();
    });

    stream.on("end", () => {
      void (async () => {
        try {
          await flushBatch();
          resolve();
        } catch (error) {
          reject(error);
        }
      })();
    });

    stream.on("error", handleError);
  });

  return { importedCount, sanitizedDates };
}

export async function importZipFileToDatabase(
  zipFilePath: string,
): Promise<ImportZipResult> {
  const registry = getModelRegistry();
  const resolvedPath = path.resolve(zipFilePath);

  await fs.promises.access(resolvedPath, fs.constants.R_OK);

  const tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "newsnexus-db-import-"),
  );

  const skippedFiles: string[] = [];
  const importedTables: string[] = [];
  let totalRecords = 0;

  try {
    const zip = new AdmZip(resolvedPath);
    zip.extractAllTo(tempDir, true);

    const csvFiles = await collectCsvFiles(tempDir);

    if (csvFiles.length === 0) {
      throw new Error("No CSV files found inside the zip file");
    }

    logger.info("Disabling foreign key constraints for import");
    await sequelize.query("PRAGMA foreign_keys = OFF;");

    for (const csvFile of csvFiles) {
      const tableName = path.basename(csvFile, ".csv");
      const model = registry[tableName];

      if (!model) {
        skippedFiles.push(path.basename(csvFile));
        continue;
      }

      const { importedCount, sanitizedDates } = await importCsvFileInBatches(
        csvFile,
        tableName,
        model,
      );

      if (importedCount === 0) {
        continue;
      }

      if (sanitizedDates > 0) {
        logger.warn(
          `Sanitized ${sanitizedDates} invalid date values to null for ${tableName}`,
        );
      }

      totalRecords += importedCount;
      if (!importedTables.includes(tableName)) {
        importedTables.push(tableName);
      }
    }

    logger.info("Re-enabling foreign key constraints after import");
    await sequelize.query("PRAGMA foreign_keys = ON;");

    return { totalRecords, importedTables, skippedFiles };
  } catch (error) {
    await sequelize.query("PRAGMA foreign_keys = ON;");
    throw error;
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}
