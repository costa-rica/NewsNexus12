import AdmZip from "adm-zip";
import csvParser from "csv-parser";
import fs from "fs";
import os from "os";
import path from "path";
import { DataTypes, Transaction } from "sequelize";
import * as db from "@newsnexus/db-models";
import { MODEL_LOAD_ORDER, resetAllSequences, sequelize } from "@newsnexus/db-models";
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

function isForeignKeyViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  // Postgres error code 23503 — foreign_key_violation
  return (
    message.includes("violates foreign key constraint") ||
    message.includes("23503")
  );
}

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

function getBooleanFields(model: { rawAttributes?: Record<string, unknown> }): string[] {
  if (!model.rawAttributes) {
    return [];
  }

  return Object.entries(model.rawAttributes)
    .filter(([, attribute]) => {
      const type = (attribute as { type?: { key?: string; constructor?: { name?: string } } }).type;
      const key = type?.key ?? type?.constructor?.name;
      return key === DataTypes.BOOLEAN.key;
    })
    .map(([field]) => field);
}

function getIntegerFields(model: { rawAttributes?: Record<string, unknown> }): string[] {
  if (!model.rawAttributes) {
    return [];
  }

  return Object.entries(model.rawAttributes)
    .filter(([, attribute]) => {
      const type = (attribute as { type?: { key?: string; constructor?: { name?: string } } }).type;
      const key = type?.key ?? type?.constructor?.name;
      return (
        key === DataTypes.INTEGER.key ||
        key === DataTypes.BIGINT.key ||
        key === DataTypes.SMALLINT.key
      );
    })
    .map(([field]) => field);
}

function getFloatFields(model: { rawAttributes?: Record<string, unknown> }): string[] {
  if (!model.rawAttributes) {
    return [];
  }

  return Object.entries(model.rawAttributes)
    .filter(([, attribute]) => {
      const type = (attribute as { type?: { key?: string; constructor?: { name?: string } } }).type;
      const key = type?.key ?? type?.constructor?.name;
      return (
        key === DataTypes.FLOAT.key ||
        key === DataTypes.DOUBLE.key ||
        key === DataTypes.DECIMAL.key ||
        key === DataTypes.REAL.key
      );
    })
    .map(([field]) => field);
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

export function sanitizeIntegerFields(
  records: Record<string, string | null>[],
  integerFields: string[],
): number {
  if (integerFields.length === 0 || records.length === 0) {
    return 0;
  }

  let sanitizedCount = 0;

  for (const record of records) {
    for (const field of integerFields) {
      if (!(field in record)) {
        continue;
      }
      if (record[field] === "") {
        record[field] = null;
        sanitizedCount += 1;
      }
    }
  }

  return sanitizedCount;
}

export function sanitizeFloatFields(
  records: Record<string, string | null>[],
  floatFields: string[],
): number {
  if (floatFields.length === 0 || records.length === 0) {
    return 0;
  }

  let sanitizedCount = 0;

  for (const record of records) {
    for (const field of floatFields) {
      if (!(field in record)) {
        continue;
      }
      if (record[field] === "") {
        record[field] = null;
        sanitizedCount += 1;
      }
    }
  }

  return sanitizedCount;
}

export function sanitizeBooleanFields(
  records: Record<string, string | null>[],
  booleanFields: string[],
): number {
  if (booleanFields.length === 0 || records.length === 0) {
    return 0;
  }

  let normalizedCount = 0;

  for (const record of records) {
    for (const field of booleanFields) {
      if (!(field in record)) {
        continue;
      }

      if (record[field] === "1") {
        record[field] = "true";
        normalizedCount += 1;
      } else if (record[field] === "0") {
        record[field] = "false";
        normalizedCount += 1;
      } else if (record[field] === "") {
        // Empty string is not a valid boolean; treat as null.
        record[field] = null;
        normalizedCount += 1;
      }
    }
  }

  return normalizedCount;
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
): Promise<{ importedCount: number; sanitizedDates: number; sanitizedBooleans: number; sanitizedIntegers: number; sanitizedFloats: number; skippedFkCount: number }> {
  const dateFields = getDateFields(model);
  const booleanFields = getBooleanFields(model);
  const integerFields = getIntegerFields(model);
  const floatFields = getFloatFields(model);
  let importedCount = 0;
  let sanitizedDates = 0;
  let sanitizedBooleans = 0;
  let sanitizedIntegers = 0;
  let sanitizedFloats = 0;
  let skippedFkCount = 0;
  let batch: Record<string, string | null>[] = [];
  let nextProgressLogAt = INITIAL_PROGRESS_LOG_THRESHOLD;

  const flushBatch = async (): Promise<void> => {
    if (batch.length === 0) {
      return;
    }

    sanitizedDates += sanitizeDateFields(batch, dateFields);
    sanitizedBooleans += sanitizeBooleanFields(batch, booleanFields);
    sanitizedIntegers += sanitizeIntegerFields(batch, integerFields);
    sanitizedFloats += sanitizeFloatFields(batch, floatFields);

    try {
      await sequelize.transaction(async (transaction: Transaction) => {
        await model.bulkCreate(batch, { ignoreDuplicates: true, transaction });
      });
      importedCount += batch.length;
    } catch (batchError) {
      if (!isForeignKeyViolation(batchError)) {
        throw batchError;
      }
      // Batch contains at least one orphaned FK reference (data integrity issue
      // carried over from SQLite, which did not enforce foreign keys). Fall back
      // to row-by-row so we can skip only the bad records.
      for (const record of batch) {
        try {
          await sequelize.transaction(async (transaction: Transaction) => {
            await model.bulkCreate([record], { ignoreDuplicates: true, transaction });
          });
          importedCount += 1;
        } catch (rowError) {
          if (isForeignKeyViolation(rowError)) {
            skippedFkCount += 1;
          } else {
            throw rowError;
          }
        }
      }
    }

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

  return { importedCount, sanitizedDates, sanitizedBooleans, sanitizedIntegers, sanitizedFloats, skippedFkCount };
}

async function rebuildSchema(): Promise<void> {
  await sequelize.query("DROP SCHEMA IF EXISTS public CASCADE;");
  await sequelize.query("CREATE SCHEMA public;");
  await sequelize.sync();

  // Re-apply runtime grants if PG_APP_ROLE is configured.
  // DROP SCHEMA CASCADE wipes ALTER DEFAULT PRIVILEGES that were set during
  // initial setup, so the app role would otherwise lose access to every table
  // created by sync().
  const appRole = process.env.PG_APP_ROLE?.trim();
  if (appRole) {
    // Identifier comes from a controlled env var, not user input; quoting it
    // with double-quotes guards against reserved words but not injection —
    // treat PG_APP_ROLE as a trusted deployment configuration value.
    const quotedRole = `"${appRole}"`;
    await sequelize.query(`GRANT USAGE ON SCHEMA public TO ${quotedRole};`);
    await sequelize.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quotedRole};`,
    );
    await sequelize.query(
      `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${quotedRole};`,
    );
    await sequelize.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quotedRole};`,
    );
    await sequelize.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${quotedRole};`,
    );
    logger.info(`Re-granted public schema access to app role: ${appRole}`);
  }
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

    await rebuildSchema();

    const csvFileMap = new Map(
      csvFiles.map((csvFile) => [path.basename(csvFile, ".csv"), csvFile] as const),
    );

    for (const tableName of MODEL_LOAD_ORDER) {
      const csvFile = csvFileMap.get(tableName);
      const model = registry[tableName];

      if (!csvFile) {
        continue;
      }

      if (!model) {
        skippedFiles.push(path.basename(csvFile));
        continue;
      }

      const { importedCount, sanitizedDates, sanitizedBooleans, sanitizedIntegers, sanitizedFloats, skippedFkCount } = await importCsvFileInBatches(
        csvFile,
        tableName,
        model,
      );

      if (importedCount === 0 && skippedFkCount === 0) {
        continue;
      }

      if (sanitizedDates > 0) {
        logger.warn(
          `Sanitized ${sanitizedDates} invalid date values to null for ${tableName}`,
        );
      }
      if (sanitizedBooleans > 0) {
        logger.warn(
          `Sanitized ${sanitizedBooleans} SQLite boolean values for ${tableName}`,
        );
      }
      if (sanitizedIntegers > 0) {
        logger.warn(
          `Sanitized ${sanitizedIntegers} empty-string integer values to null for ${tableName}`,
        );
      }
      if (sanitizedFloats > 0) {
        logger.warn(
          `Sanitized ${sanitizedFloats} empty-string float values to null for ${tableName}`,
        );
      }
      if (skippedFkCount > 0) {
        logger.warn(
          `Skipped ${skippedFkCount} orphaned records in ${tableName} (foreign key references missing parent rows — SQLite legacy data integrity issue)`,
        );
      }

      totalRecords += importedCount;
      if (!importedTables.includes(tableName)) {
        importedTables.push(tableName);
      }
    }

    for (const csvFile of csvFiles) {
      const tableName = path.basename(csvFile, ".csv");
      if (!MODEL_LOAD_ORDER.includes(tableName)) {
        skippedFiles.push(path.basename(csvFile));
      }
    }

    await resetAllSequences(sequelize);

    return { totalRecords, importedTables, skippedFiles };
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}
