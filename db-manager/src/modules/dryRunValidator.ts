import { execFileSync, spawnSync } from "child_process";
import path from "path";

export type DryRunResult = {
  scratchDb: string;
  totalRecords: number;
  importedTableCount: number;
  skippedFiles: string[];
  warnings: string[];
  errors: string[];
  sanitizedDates: number;
  sanitizedBooleans: number;
  sanitizedIntegers: number;
  sanitizedFloats: number;
  skippedFkRows: number;
  success: boolean;
};

const PG_BIN_SEARCH_PATHS = [
  "/opt/homebrew/opt/postgresql@16/bin",
  "/opt/homebrew/opt/postgresql@15/bin",
  "/usr/lib/postgresql/16/bin",
  "/usr/lib/postgresql/15/bin",
  "/usr/bin",
  "/usr/local/bin",
];

function resolvePgBin(tool: string): string {
  for (const dir of PG_BIN_SEARCH_PATHS) {
    const candidate = path.join(dir, tool);
    try {
      execFileSync("test", ["-x", candidate], { stdio: "ignore" });
      return candidate;
    } catch {
      // not found here, try next
    }
  }
  // Fall back to bare name and let the OS resolve it
  return tool;
}

function pgEnv(): NodeJS.ProcessEnv {
  return {
    PGHOST: process.env.PG_HOST ?? "localhost",
    PGPORT: process.env.PG_PORT ?? "5432",
    PGUSER: process.env.PG_USER ?? "",
    PGPASSWORD: process.env.PG_PASSWORD ?? "",
  };
}

function createScratchDb(dbName: string): void {
  execFileSync(resolvePgBin("createdb"), [dbName], {
    env: { ...process.env, ...pgEnv() },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function dropScratchDb(dbName: string): void {
  execFileSync(resolvePgBin("dropdb"), ["--if-exists", dbName], {
    env: { ...process.env, ...pgEnv() },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const SANITIZED_DATES_RE = /Sanitized (\d+) invalid date/i;
const SANITIZED_BOOLEANS_RE = /Sanitized (\d+) SQLite boolean/i;
const SANITIZED_INTEGERS_RE = /Sanitized (\d+) empty-string integer/i;
const SANITIZED_FLOATS_RE = /Sanitized (\d+) empty-string float/i;
const SKIPPED_FK_RE = /Skipped (\d+) orphaned records in (\S+)/i;
const IMPORTED_RE = /Imported (\d+) records across (\d+) tables/i;
const SKIPPED_FILES_RE = /Skipped files with no matching model: (.+)/i;

function parseOutput(lines: string[]): Partial<DryRunResult> {
  const result: Partial<DryRunResult> = {
    warnings: [],
    errors: [],
    importedTableCount: 0,
    skippedFiles: [],
    sanitizedDates: 0,
    sanitizedBooleans: 0,
    sanitizedIntegers: 0,
    sanitizedFloats: 0,
    skippedFkRows: 0,
    totalRecords: 0,
  };

  for (const line of lines) {
    const isWarn = /\[warn\]/i.test(line);
    const isError = /\[error\]/i.test(line);

    if (isError) {
      result.errors!.push(line.trim());
    } else if (isWarn) {
      result.warnings!.push(line.trim());

      const datesMatch = SANITIZED_DATES_RE.exec(line);
      if (datesMatch) result.sanitizedDates! += Number(datesMatch[1]);

      const booleansMatch = SANITIZED_BOOLEANS_RE.exec(line);
      if (booleansMatch) result.sanitizedBooleans! += Number(booleansMatch[1]);

      const integersMatch = SANITIZED_INTEGERS_RE.exec(line);
      if (integersMatch) result.sanitizedIntegers! += Number(integersMatch[1]);

      const floatsMatch = SANITIZED_FLOATS_RE.exec(line);
      if (floatsMatch) result.sanitizedFloats! += Number(floatsMatch[1]);

      const fkMatch = SKIPPED_FK_RE.exec(line);
      if (fkMatch) result.skippedFkRows! += Number(fkMatch[1]);

      const skippedFilesMatch = SKIPPED_FILES_RE.exec(line);
      if (skippedFilesMatch) {
        result.skippedFiles!.push(...skippedFilesMatch[1].split(",").map((s) => s.trim()));
      }
    } else {
      const importedMatch = IMPORTED_RE.exec(line);
      if (importedMatch) {
        result.totalRecords = Number(importedMatch[1]);
        result.importedTableCount = Number(importedMatch[2]);
      }
    }
  }

  return result;
}

function printReport(result: DryRunResult): void {
  const sep = "─".repeat(60);
  process.stdout.write(`\n${sep}\nDRY-RUN VALIDATOR REPORT\n${sep}\n`);
  process.stdout.write(`Scratch database: ${result.scratchDb}\n`);
  process.stdout.write(`Status:           ${result.success ? "PASSED" : "FAILED"}\n`);
  process.stdout.write(`\nImport summary\n`);
  process.stdout.write(`  Records imported:  ${result.totalRecords.toLocaleString("en-US")}\n`);
  process.stdout.write(`  Tables imported:   ${result.importedTableCount}\n`);
  if (result.skippedFiles.length > 0) {
    process.stdout.write(`  Skipped files:     ${result.skippedFiles.join(", ")}\n`);
  }

  if (result.sanitizedDates > 0 || result.sanitizedBooleans > 0 || result.sanitizedIntegers > 0 || result.sanitizedFloats > 0 || result.skippedFkRows > 0) {
    process.stdout.write(`\nData coercion\n`);
    if (result.sanitizedDates > 0)    process.stdout.write(`  Invalid dates → null:   ${result.sanitizedDates.toLocaleString("en-US")}\n`);
    if (result.sanitizedBooleans > 0) process.stdout.write(`  SQLite booleans coerced: ${result.sanitizedBooleans.toLocaleString("en-US")}\n`);
    if (result.sanitizedIntegers > 0) process.stdout.write(`  Empty integer → null:   ${result.sanitizedIntegers.toLocaleString("en-US")}\n`);
    if (result.sanitizedFloats > 0)   process.stdout.write(`  Empty float → null:     ${result.sanitizedFloats.toLocaleString("en-US")}\n`);
    if (result.skippedFkRows > 0)     process.stdout.write(`  Orphaned FK rows skipped: ${result.skippedFkRows.toLocaleString("en-US")}\n`);
  }

  if (result.warnings.length > 0) {
    process.stdout.write(`\nWarnings (${result.warnings.length})\n`);
    for (const w of result.warnings) {
      process.stdout.write(`  ${w}\n`);
    }
  }

  if (result.errors.length > 0) {
    process.stdout.write(`\nErrors (${result.errors.length})\n`);
    for (const e of result.errors) {
      process.stdout.write(`  ${e}\n`);
    }
  }

  process.stdout.write(`${sep}\n`);
}

export async function runDryRunValidator(zipFilePath: string): Promise<DryRunResult> {
  const timestamp = Date.now();
  const scratchDb = `newsnexus_dry_run_${timestamp}`;

  process.stdout.write(`Creating scratch database: ${scratchDb}\n`);
  createScratchDb(scratchDb);

  let success = false;
  let rawOutput = "";

  try {
    // Re-use the same entry point and runtime flags (e.g. ts-node registers)
    // so the child works whether the caller used `ts-node src/index.ts` or
    // `node dist/index.js`.
    const entryPoint = process.argv[1];
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PG_DATABASE: scratchDb,
    };

    const proc = spawnSync(
      process.execPath,
      [...process.execArgv, entryPoint, "--zip_file", zipFilePath],
      {
        env: childEnv,
        encoding: "utf8",
        maxBuffer: 50 * 1024 * 1024,
      },
    );

    rawOutput = [proc.stdout ?? "", proc.stderr ?? ""].join("\n");
    const lines = rawOutput.split("\n").filter((l) => l.trim() !== "");

    const parsed = parseOutput(lines);

    const result: DryRunResult = {
      scratchDb,
      success: proc.status === 0,
      totalRecords: parsed.totalRecords ?? 0,
      importedTableCount: parsed.importedTableCount ?? 0,
      skippedFiles: parsed.skippedFiles ?? [],
      warnings: parsed.warnings ?? [],
      errors: parsed.errors ?? [],
      sanitizedDates: parsed.sanitizedDates ?? 0,
      sanitizedBooleans: parsed.sanitizedBooleans ?? 0,
      sanitizedIntegers: parsed.sanitizedIntegers ?? 0,
      sanitizedFloats: parsed.sanitizedFloats ?? 0,
      skippedFkRows: parsed.skippedFkRows ?? 0,
    };

    if (!result.success && proc.error) {
      result.errors.unshift(`Process error: ${proc.error.message}`);
    }

    success = result.success;
    printReport(result);
    return result;
  } finally {
    process.stdout.write(`Dropping scratch database: ${scratchDb}\n`);
    try {
      dropScratchDb(scratchDb);
    } catch (cleanupError) {
      const msg = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      process.stderr.write(`Warning: failed to drop scratch database ${scratchDb}: ${msg}\n`);
    }
    if (!success) {
      process.stderr.write(`\nRaw child output:\n${rawOutput}\n`);
    }
  }
}
