import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import morgan from "morgan";
import path from "path";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { env } from "./config/env";

const app = express();
let databaseInitialization: Promise<void> | null = null;
let legacyRoutersMounted = false;

function resolveAssetPath(distRelativePath: string, srcRelativePath: string): string {
  const distPath = path.join(__dirname, distRelativePath);
  if (existsSync(distPath)) {
    return distPath;
  }
  return path.join(__dirname, srcRelativePath);
}

const publicPath = resolveAssetPath("public", "../src/public");
const homeTemplatePath = resolveAssetPath(
  "templates/index.html",
  "../src/templates/index.html",
);

app.use(
  cors({
    credentials: true,
  }),
);
app.use(morgan("dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());
app.use(express.static(publicPath));

app.get("/", (_req, res) => {
  res.sendFile(homeTemplatePath);
});

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "newsnexus12api" });
});

export function mountLegacyRouters(): void {
  if (legacyRoutersMounted) {
    return;
  }

  const legacyRoutersEnabled = env.loadLegacyRouters;
  if (!legacyRoutersEnabled) {
    legacyRoutersMounted = true;
    return;
  }

  const mounts: Array<{ prefix: string; modulePath: string }> = [
    { prefix: "/", modulePath: "./routes/index" },
    { prefix: "/users", modulePath: "./routes/users" },
    { prefix: "/admin-db", modulePath: "./routes/adminDb" },
    { prefix: "/keywords", modulePath: "./routes/keywords" },
    { prefix: "/gnews", modulePath: "./routes/newsOrgs/gNews" },
    { prefix: "/news-aggregators", modulePath: "./routes/newsAggregators" },
    { prefix: "/news-api", modulePath: "./routes/newsOrgs/newsApi" },
    { prefix: "/articles", modulePath: "./routes/articles" },
    { prefix: "/articles-approveds", modulePath: "./routes/articlesApproveds" },
    { prefix: "/states", modulePath: "./routes/state" },
    { prefix: "/website-domains", modulePath: "./routes/websiteDomains" },
    { prefix: "/reports", modulePath: "./routes/reports" },
    { prefix: "/automations", modulePath: "./routes/newsOrgs/automations" },
    {
      prefix: "/artificial-intelligence",
      modulePath: "./routes/artificialIntelligence",
    },
    { prefix: "/news-data-io", modulePath: "./routes/newsOrgs/newsDataIo" },
    { prefix: "/google-rss", modulePath: "./routes/newsOrgs/googleRss" },
    {
      prefix: "/analysis/approved-articles",
      modulePath: "./routes/analysis/approvedArticles",
    },
    { prefix: "/analysis/deduper", modulePath: "./routes/analysis/deduper" },
    {
      prefix: "/analysis/ai-approver",
      modulePath: "./routes/analysis/ai-approver",
    },
    { prefix: "/analysis/llm01", modulePath: "./routes/analysis/llm01" },
    { prefix: "/analysis/llm02", modulePath: "./routes/analysis/llm02" },
    { prefix: "/downloads", modulePath: "./routes/downloads" },
    { prefix: "/analysis/llm04", modulePath: "./routes/analysis/llm04" },
    {
      prefix: "/analysis/state-assigner",
      modulePath: "./routes/analysis/state-assigner",
    },
  ];

  mounts.forEach(({ prefix, modulePath }) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const router = require(modulePath);
      app.use(prefix, router);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to load legacy router "${modulePath}" (${prefix}): ${message}`,
      );
    }
  });

  legacyRoutersMounted = true;
}

export async function initializeDatabase(): Promise<void> {
  if (!env.loadLegacyRouters) {
    return;
  }

  if (databaseInitialization) {
    return databaseInitialization;
  }

  databaseInitialization = (async () => {
    const dbDir = process.env.PATH_DATABASE;
    if (dbDir && dbDir.trim() !== "") {
      await mkdir(dbDir, { recursive: true });
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { initModels, sequelize, dropLegacyArticleContentsTable } = require("@newsnexus/db-models");

    initModels();
    await sequelize.authenticate();
    await sequelize.sync();
    await dropLegacyArticleContentsTable();
  })();

  return databaseInitialization;
}

export default app;
