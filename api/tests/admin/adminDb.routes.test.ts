import express from "express";
import request from "supertest";

process.env.PATH_PROJECT_RESOURCES =
  process.env.PATH_PROJECT_RESOURCES || "/tmp/newsnexus-project-resources";
process.env.PATH_DB_BACKUPS =
  process.env.PATH_DB_BACKUPS || "/tmp/newsnexus-db-backups";

jest.mock("../../src/modules/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock("../../src/modules/userAuthentication", () => ({
  authenticateToken: (_req: any, _res: any, next: any) => next(),
}));

jest.mock("../../src/middleware/rateLimiting", () => ({
  databaseOperationLimiter: (_req: any, _res: any, next: any) => next(),
}));

jest.mock("../../src/middleware/fileSecurity", () => ({
  safeFileExists: jest.fn().mockReturnValue({
    valid: true,
    path: "/tmp/newsnexus-db-backups/db_backup_test.zip",
  }),
}));

const mockAdminDbModule = {
  createDatabaseBackupZipFile: jest.fn(),
};
jest.mock("../../src/modules/adminDb", () => mockAdminDbModule);

const mockDbManager = {
  importZipFileToDatabase: jest.fn(),
};
jest.mock("@newsnexus/db-manager", () => mockDbManager);

function createModelMock() {
  return {
    findAll: jest.fn().mockResolvedValue([]),
    findByPk: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
  };
}

const modelNames = [
  "AiApproverArticleScore",
  "AiApproverPromptVersion",
  "User",
  "ArticleKeywordContract",
  "EntityWhoCategorizedArticle",
  "ArtificialIntelligence",
  "State",
  "ArticleStateContract",
  "Report",
  "ArticleReportContract",
  "ArticleReviewed",
  "ArticleApproved",
  "ArticleDuplicateAnalysis",
  "NewsApiRequest",
  "ArticleContents02",
  "NewsRssRequest",
  "Keyword",
  "NewsArticleAggregatorSource",
  "Article",
  "EntityWhoFoundArticle",
  "NewsArticleAggregatorSourceStateContract",
  "ArticleIsRelevant",
  "NewsApiRequestWebsiteDomainContract",
  "WebsiteDomain",
  "ArticleEntityWhoCategorizedArticleContract",
  "ArticleEntityWhoCategorizedArticleContracts02",
  "ArticlesApproved02",
  "ArticleStateContract02",
  "Prompt",
] as const;

const dbMock: Record<string, any> = {};
for (const name of modelNames) {
  dbMock[name] = createModelMock();
}

jest.mock("@newsnexus/db-models", () => dbMock);

const adminDbRouter = require("../../src/routes/adminDb");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/admin-db", adminDbRouter);
  return app;
}

describe("adminDb routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("GET /admin-db/table/:tableName returns table data for valid table", async () => {
    dbMock.User.findAll.mockResolvedValue([
      { id: 1, email: "test@example.com" },
    ]);

    const app = buildApp();
    const response = await request(app).get("/admin-db/table/User");

    expect(response.status).toBe(200);
    expect(response.body.result).toBe(true);
    expect(response.body.data).toHaveLength(1);
  });

  test("GET /admin-db/table/:tableName rejects unknown table", async () => {
    const app = buildApp();
    const response = await request(app).get("/admin-db/table/NotARealTable");

    expect(response.status).toBe(400);
    expect(response.body.result).toBe(false);
  });

  test("GET /admin-db/create-database-backup returns backup path", async () => {
    mockAdminDbModule.createDatabaseBackupZipFile.mockResolvedValue(
      "/tmp/newsnexus-db-backups/db_backup_20260222.zip",
    );

    const app = buildApp();
    const response = await request(app).get("/admin-db/create-database-backup");

    expect(response.status).toBe(200);
    expect(response.body.result).toBe(true);
    expect(response.body.backupFile).toContain("db_backup_20260222.zip");
  });

  test("DELETE /admin-db/table/:tableName deletes all rows on valid table", async () => {
    dbMock.Keyword.destroy.mockResolvedValue(1);

    const app = buildApp();
    const response = await request(app).delete("/admin-db/table/Keyword");

    expect(response.status).toBe(200);
    expect(response.body.result).toBe(true);
    expect(dbMock.Keyword.destroy).toHaveBeenCalledWith({
      where: {},
      truncate: true,
    });
  });

  test("GET /admin-db/db-row-counts-by-table includes AI approver tables", async () => {
    dbMock.AiApproverArticleScore.count.mockResolvedValue(7);
    dbMock.AiApproverPromptVersion.count.mockResolvedValue(2);

    const app = buildApp();
    const response = await request(app).get("/admin-db/db-row-counts-by-table");

    expect(response.status).toBe(200);
    expect(response.body.result).toBe(true);
    expect(response.body.arrayRowCountsByTable).toEqual(
      expect.arrayContaining([
        { tableName: "AiApproverArticleScore", rowCount: 7 },
        { tableName: "AiApproverPromptVersion", rowCount: 2 },
      ]),
    );
  });

  test("PUT /admin-db/table-row/:tableName/null creates a new row", async () => {
    dbMock.Keyword.create.mockResolvedValue({ id: 44, name: "battery" });

    const app = buildApp();
    const response = await request(app)
      .put("/admin-db/table-row/Keyword/null")
      .send({ name: "battery" });

    expect(response.status).toBe(200);
    expect(response.body.result).toBe(true);
    expect(dbMock.Keyword.create).toHaveBeenCalledWith({ name: "battery" });
  });

  test("PUT /admin-db/table-row/:tableName/:rowId updates existing row", async () => {
    dbMock.Keyword.update.mockResolvedValue([1]);
    dbMock.Keyword.findByPk.mockResolvedValue({ id: 12, name: "updated" });

    const app = buildApp();
    const response = await request(app)
      .put("/admin-db/table-row/Keyword/12")
      .send({ name: "updated" });

    expect(response.status).toBe(200);
    expect(response.body.result).toBe(true);
    expect(dbMock.Keyword.update).toHaveBeenCalledWith(
      { name: "updated" },
      { where: { id: "12" } },
    );
  });

  test("DELETE /admin-db/table-row/:tableName/:rowId deletes one row", async () => {
    dbMock.Keyword.destroy.mockResolvedValue(1);

    const app = buildApp();
    const response = await request(app).delete("/admin-db/table-row/Keyword/9");

    expect(response.status).toBe(200);
    expect(response.body.result).toBe(true);
    expect(dbMock.Keyword.destroy).toHaveBeenCalledWith({ where: { id: "9" } });
  });

  test("POST /admin-db/import-db-backup returns 400 when file is missing", async () => {
    const app = buildApp();
    const response = await request(app).post("/admin-db/import-db-backup");

    expect(response.status).toBe(400);
    expect(response.body.result).toBe(false);
    expect(response.body.message).toContain("No file uploaded");
  });
});
