#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_OUTPUT_PATH = path.join(
  REPO_ROOT,
  "scripts",
  "output",
  "ai_approver_review_legend_counts.csv",
);

const CATEGORY_ROWS = [
  {
    sortOrder: 1,
    key: "percent_badge",
    portalLabel: "Percent badge",
    meaning: "Eligible completed numeric category score exists",
  },
  {
    sortOrder: 2,
    key: "n/a",
    portalLabel: "N/A",
    meaning: "No eligible category score and no gatekeeper result",
  },
  {
    sortOrder: 3,
    key: "review",
    portalLabel: "Review",
    meaning: "Latest gatekeeper decision is manual_review",
  },
  {
    sortOrder: 4,
    key: "reject",
    portalLabel: "Reject",
    meaning: "Latest gatekeeper decision is reject",
  },
  {
    sortOrder: 5,
    key: "gk",
    portalLabel: "GK",
    meaning: "Gatekeeper result exists without an eligible category score",
  },
  {
    sortOrder: 6,
    key: "err",
    portalLabel: "Err",
    meaning: "Latest gatekeeper result failed, invalid_response, or error",
  },
  {
    sortOrder: 7,
    key: "zero",
    portalLabel: "0",
    meaning: "Category analysis ID exists but no numeric score; normally zero with current API",
  },
];

function parseArgs(argv) {
  const options = {
    outputPath: DEFAULT_OUTPUT_PATH,
    scope: "all",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--output" || arg === "--csv") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${arg} requires a file path`);
      }
      options.outputPath = path.resolve(process.cwd(), value);
      index += 1;
      continue;
    }

    if (arg === "--scope") {
      const value = argv[index + 1];
      if (!["all", "review-defaults"].includes(value)) {
        throw new Error("--scope must be all or review-defaults");
      }
      options.scope = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`
Usage:
  node scripts/ai-approver-review-legend-counts.mjs
  node scripts/ai-approver-review-legend-counts.mjs --output scripts/output/counts.csv
  node scripts/ai-approver-review-legend-counts.mjs --scope review-defaults

Options:
  --output, --csv <path>       CSV path. Defaults to scripts/output/ai_approver_review_legend_counts.csv.
  --scope all                 Count all rows in Articles. This is the default.
  --scope review-defaults     Approximate the review page default approved/relevance filters.
`);
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const withoutExport = trimmed.startsWith("export ")
    ? trimmed.slice("export ".length).trim()
    : trimmed;
  const equalsIndex = withoutExport.indexOf("=");
  if (equalsIndex === -1) {
    return null;
  }

  const key = withoutExport.slice(0, equalsIndex).trim();
  let value = withoutExport.slice(equalsIndex + 1).trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

function loadEnvFiles() {
  const candidates = [
    ".env",
    "api/.env",
    "worker-node/.env",
    "worker-python/.env",
    "db-manager/.env",
    "db-models/.env",
  ];

  const loadedFiles = [];
  for (const relativePath of candidates) {
    const absolutePath = path.join(REPO_ROOT, relativePath);
    if (!fs.existsSync(absolutePath)) {
      continue;
    }

    const contents = fs.readFileSync(absolutePath, "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (!parsed || process.env[parsed.key]) {
        continue;
      }
      process.env[parsed.key] = parsed.value;
    }
    loadedFiles.push(relativePath);
  }

  return loadedFiles;
}

function readEnv(name, fallback = null) {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : fallback;
}

function readFirstEnv(names, fallback = null) {
  for (const name of names) {
    const value = readEnv(name);
    if (value !== null) {
      return value;
    }
  }
  return fallback;
}

function readBooleanEnv(name, fallback = false) {
  const value = readEnv(name);
  if (value === null) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function buildClientConfig() {
  const connectionString = readEnv("DATABASE_URL");
  if (connectionString) {
    return {
      connectionString,
      ssl: readBooleanEnv("PG_SSL") ? { rejectUnauthorized: false } : undefined,
    };
  }

  const host = readFirstEnv(["PG_HOST", "PGHOST"]);
  const database = readFirstEnv(["PG_DATABASE", "PGDATABASE"]);
  const user = readFirstEnv(["PG_USER", "PGUSER"]);
  const password = readFirstEnv(["PG_PASSWORD", "PGPASSWORD"], "");
  const port = readFirstEnv(["PG_PORT", "PGPORT"], "5432");

  const missing = [
    ["PG_HOST", host],
    ["PG_DATABASE", database],
    ["PG_USER", user],
  ].filter(([, value]) => value === null);

  if (missing.length > 0) {
    throw new Error(
      `Missing database env vars: ${missing.map(([name]) => name).join(", ")}. Set them or add them to api/.env.`,
    );
  }

  return {
    host,
    port: Number(port),
    database,
    user,
    password,
    ssl: readBooleanEnv("PG_SSL") ? { rejectUnauthorized: false } : undefined,
  };
}

function scopeWhereClause(scope) {
  if (scope !== "review-defaults") {
    return "";
  }

  return `
    WHERE NOT EXISTS (
      SELECT 1
      FROM "ArticleApproveds" aa
      WHERE aa."articleId" = a.id
        AND aa."isApproved" = true
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "ArticleIsRelevants" air
      WHERE air."articleId" = a.id
        AND air."isRelevant" IS NOT NULL
    )
  `;
}

function buildQuery(scope) {
  return `
    WITH article_scope AS (
      SELECT a.id
      FROM "Articles" a
      ${scopeWhereClause(scope)}
    ),
    eligible_category_scores AS (
      SELECT *
      FROM (
        SELECT
          aas.id,
          aas."articleId",
          aas.score,
          ROW_NUMBER() OVER (
            PARTITION BY aas."articleId"
            ORDER BY aas.score DESC, aas.id ASC
          ) AS row_number
        FROM "AiApproverArticleScores" aas
        LEFT JOIN "AiApproverPromptVersions" apv
          ON apv.id = aas."promptVersionId"
        WHERE COALESCE(aas."promptRole", apv."promptRole", 'category_score') <> 'gatekeeper'
          AND aas."isHumanApproved" IS DISTINCT FROM false
          AND aas."resultStatus" = 'completed'
          AND aas.score IS NOT NULL
      ) ranked_category_scores
      WHERE row_number = 1
    ),
    latest_gatekeeper_scores AS (
      SELECT *
      FROM (
        SELECT
          aas.id,
          aas."articleId",
          aas."resultStatus",
          aas.decision,
          ROW_NUMBER() OVER (
            PARTITION BY aas."articleId"
            ORDER BY aas.id DESC
          ) AS row_number
        FROM "AiApproverArticleScores" aas
        LEFT JOIN "AiApproverPromptVersions" apv
          ON apv.id = aas."promptVersionId"
        WHERE COALESCE(aas."promptRole", apv."promptRole", 'category_score') = 'gatekeeper'
      ) ranked_gatekeeper_scores
      WHERE row_number = 1
    ),
    classified_articles AS (
      SELECT
        article_scope.id,
        CASE
          WHEN eligible_category_scores.id IS NOT NULL THEN 'percent_badge'
          WHEN latest_gatekeeper_scores.id IS NULL THEN 'n/a'
          WHEN latest_gatekeeper_scores."resultStatus" IN ('failed', 'invalid_response')
            OR latest_gatekeeper_scores.decision = 'error' THEN 'err'
          WHEN latest_gatekeeper_scores.decision = 'manual_review' THEN 'review'
          WHEN latest_gatekeeper_scores.decision = 'reject' THEN 'reject'
          ELSE 'gk'
        END AS category_key
      FROM article_scope
      LEFT JOIN eligible_category_scores
        ON eligible_category_scores."articleId" = article_scope.id
      LEFT JOIN latest_gatekeeper_scores
        ON latest_gatekeeper_scores."articleId" = article_scope.id
    ),
    category_counts AS (
      SELECT category_key, COUNT(*)::int AS article_count
      FROM classified_articles
      GROUP BY category_key
    )
    SELECT category_key, article_count
    FROM category_counts
    ORDER BY category_key;
  `;
}

function csvEscape(value) {
  const stringValue = String(value ?? "");
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function buildCsv(rows, scope) {
  const header = ["sort_order", "portal_label", "category_key", "article_count", "scope", "meaning"];
  const lines = [header.join(",")];

  for (const row of rows) {
    lines.push(
      [
        row.sortOrder,
        row.portalLabel,
        row.key,
        row.articleCount,
        scope,
        row.meaning,
      ]
        .map(csvEscape)
        .join(","),
    );
  }

  return `${lines.join("\n")}\n`;
}

function mergeCategoryCounts(queryRows) {
  const counts = new Map(
    queryRows.map((row) => [String(row.category_key), Number(row.article_count)]),
  );

  return CATEGORY_ROWS.map((category) => ({
    ...category,
    articleCount: category.key === "zero" ? 0 : counts.get(category.key) ?? 0,
  }));
}

function printTerminalSummary(rows, scope, outputPath, databaseName) {
  const total = rows.reduce((sum, row) => sum + row.articleCount, 0);
  const labelWidth = Math.max(...rows.map((row) => row.portalLabel.length), 12);

  console.log(`AI Approver review legend counts`);
  console.log(`Database: ${databaseName}`);
  console.log(`Scope: ${scope}`);
  console.log("");
  console.log(`${"Portal label".padEnd(labelWidth)}  Articles`);
  console.log(`${"-".repeat(labelWidth)}  --------`);
  for (const row of rows) {
    console.log(`${row.portalLabel.padEnd(labelWidth)}  ${row.articleCount}`);
  }
  console.log("");
  console.log(`Classified article total: ${total}`);
  console.log(`CSV written: ${outputPath}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  loadEnvFiles();
  const clientConfig = buildClientConfig();
  const client = new Client(clientConfig);

  await client.connect();
  try {
    const result = await client.query(buildQuery(options.scope));
    const rows = mergeCategoryCounts(result.rows);
    fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
    fs.writeFileSync(options.outputPath, buildCsv(rows, options.scope), "utf8");
    printTerminalSummary(
      rows,
      options.scope,
      options.outputPath,
      clientConfig.database || "DATABASE_URL",
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
