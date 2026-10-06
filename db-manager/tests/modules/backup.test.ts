import AdmZip from "adm-zip";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

// Mock @newsnexus/db-models before importing the module under test
jest.mock("@newsnexus/db-models", () => ({
  Article: {
    findAll: jest.fn(),
  },
  ArticleApproved: {
    findAll: jest.fn(),
  },
  User: {
    findAll: jest.fn(),
  },
  AiApproverPromptVersionV02: {
    findAll: jest.fn(),
  },
  AiApproverRunV02: {
    findAll: jest.fn(),
  },
  AiApproverArticlePredictionV02: {
    findAll: jest.fn(),
  },
  // Excluded from backups through BACKUP_EXCLUDED_MODELS
  ArticleEmbedding: {
    findAll: jest.fn(),
  },
  BACKUP_EXCLUDED_MODELS: ["ArticleEmbedding"],
  // Add a non-model export to test filtering
  sequelize: {},
  initModels: jest.fn(),
}));

// Mock logger
jest.mock("../../src/config/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import * as db from "@newsnexus/db-models";
import { logger } from "../../src/config/logger";
import {
  BACKUP_MANIFEST_VERSION,
  createDatabaseBackupZipFile,
  formatDatabaseBackupResult,
  type BackupManifest,
} from "../../src/modules/backup";

function readManifest(zipPath: string): BackupManifest {
  const manifestEntry = new AdmZip(zipPath).getEntry("manifest.json");
  if (!manifestEntry) {
    throw new Error("manifest.json was not found in test backup");
  }
  return JSON.parse(manifestEntry.getData().toString("utf8")) as BackupManifest;
}

describe("Backup module", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let tempBackupDir: string;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tempBackupDir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-test-"));
    process.env.PATH_DB_BACKUPS = tempBackupDir;

    jest.clearAllMocks();
    (db.Article.findAll as jest.Mock).mockReset();
    (db.ArticleApproved.findAll as jest.Mock).mockReset();
    (db.User.findAll as jest.Mock).mockReset();
    (db.AiApproverPromptVersionV02.findAll as jest.Mock).mockReset();
    (db.AiApproverRunV02.findAll as jest.Mock).mockReset();
    (db.AiApproverArticlePredictionV02.findAll as jest.Mock).mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;

    if (fs.existsSync(tempBackupDir)) {
      fs.rmSync(tempBackupDir, { recursive: true, force: true });
    }
  });

  describe("createDatabaseBackupZipFile()", () => {
    it("throws when PATH_DB_BACKUPS env var is not set", async () => {
      delete process.env.PATH_DB_BACKUPS;

      await expect(createDatabaseBackupZipFile()).rejects.toThrow(
        "PATH_DB_BACKUPS is required to create backups",
      );
    });

    it("creates a .zip file at the expected path when tables have data", async () => {
      (db.Article.findAll as jest.Mock).mockResolvedValue([
        { id: 1, title: "Article 1" },
        { id: 2, title: "Article 2" },
      ]);
      (db.ArticleApproved.findAll as jest.Mock).mockResolvedValue([
        { articleId: 1 },
      ]);
      (db.User.findAll as jest.Mock).mockResolvedValue([
        { id: 1, email: "user@example.com" },
      ]);

      const result = await createDatabaseBackupZipFile();
      const zipPath = result.backupPath;

      expect(zipPath).toMatch(/db_backup_\d{15}\.zip$/);
      expect(path.isAbsolute(zipPath)).toBe(true);
      expect(fs.existsSync(zipPath)).toBe(true);
      expect(result.byteSize).toBe(fs.statSync(zipPath).size);
      expect(result.byteSize).toBeGreaterThan(0);
      expect(result.sha256).toBe(
        crypto.createHash("sha256").update(fs.readFileSync(zipPath)).digest("hex"),
      );
      expect(result.manifestVersion).toBe(BACKUP_MANIFEST_VERSION);

      // Verify the file is a zip file (has zip magic bytes)
      const buffer = fs.readFileSync(zipPath);
      expect(buffer[0]).toBe(0x50); // 'P'
      expect(buffer[1]).toBe(0x4b); // 'K'
    });

    it("resolves a relative backup root and reports an absolute path", async () => {
      process.env.PATH_DB_BACKUPS = path.relative(process.cwd(), tempBackupDir);
      (db.Article.findAll as jest.Mock).mockResolvedValue([{ id: 1 }]);

      const result = await createDatabaseBackupZipFile();

      expect(path.isAbsolute(result.backupPath)).toBe(true);
      expect(path.dirname(result.backupPath)).toBe(tempBackupDir);
    });

    it("throws 'No data found in any tables' when all model findAll calls return empty arrays", async () => {
      (db.Article.findAll as jest.Mock).mockResolvedValue([]);
      (db.ArticleApproved.findAll as jest.Mock).mockResolvedValue([]);
      (db.User.findAll as jest.Mock).mockResolvedValue([]);

      await expect(createDatabaseBackupZipFile()).rejects.toThrow(
        "No data found in any tables. Backup skipped.",
      );
    });

    it("cleans up the temporary backup directory after creating the zip", async () => {
      (db.Article.findAll as jest.Mock).mockResolvedValue([
        { id: 1, title: "Article 1" },
      ]);
      (db.ArticleApproved.findAll as jest.Mock).mockResolvedValue([]);
      (db.User.findAll as jest.Mock).mockResolvedValue([]);

      const { backupPath: zipPath } = await createDatabaseBackupZipFile();

      // Extract the backup directory name from the zip path
      const zipFileName = path.basename(zipPath, ".zip");
      const backupDir = path.join(tempBackupDir, zipFileName);

      // Backup directory should not exist (it should be cleaned up)
      expect(fs.existsSync(backupDir)).toBe(false);
    });

    it("includes CSV files for each model that returned data", async () => {
      (db.Article.findAll as jest.Mock).mockResolvedValue([
        { id: 1, title: "Article 1", content: "Content 1" },
        { id: 2, title: "Article 2", content: "Content 2" },
      ]);
      (db.ArticleApproved.findAll as jest.Mock).mockResolvedValue([
        { articleId: 1, approvedBy: "admin" },
      ]);
      (db.User.findAll as jest.Mock).mockResolvedValue([]);

      const { backupPath: zipPath } = await createDatabaseBackupZipFile();

      // Extract the zip to verify contents
      const AdmZip = require("adm-zip");
      const zip = new AdmZip(zipPath);
      const zipEntries = zip.getEntries();

      const entryNames = zipEntries.map((entry: any) => entry.entryName);

      // Should include CSV files for Article and ArticleApproved, but not User
      expect(entryNames).toContain("Article.csv");
      expect(entryNames).toContain("ArticleApproved.csv");
      expect(entryNames).not.toContain("User.csv");
    });

    it("writes a manifest for nonempty and empty registered models", async () => {
      (db.Article.findAll as jest.Mock).mockResolvedValue([
        { id: 1, title: "Article 1" },
        { id: 2, title: "Article 2" },
      ]);
      (db.ArticleApproved.findAll as jest.Mock).mockResolvedValue([]);
      (db.User.findAll as jest.Mock).mockResolvedValue([]);

      const { backupPath } = await createDatabaseBackupZipFile();
      const zip = new AdmZip(backupPath);
      const manifest = readManifest(backupPath);
      const articleEntry = manifest.models.find(
        (entry) => entry.modelName === "Article",
      );
      const userEntry = manifest.models.find((entry) => entry.modelName === "User");
      const articleCsv = zip.getEntry("Article.csv")?.getData();

      expect(manifest.version).toBe(BACKUP_MANIFEST_VERSION);
      expect(Number.isNaN(Date.parse(manifest.createdAt))).toBe(false);
      expect(manifest.models).toHaveLength(6);
      expect(articleCsv).toBeDefined();
      expect(articleEntry).toEqual({
        modelName: "Article",
        csvFilename: "Article.csv",
        rowCount: 2,
        byteSize: articleCsv?.byteLength,
        sha256: crypto
          .createHash("sha256")
          .update(articleCsv ?? Buffer.alloc(0))
          .digest("hex"),
      });
      expect(userEntry).toEqual({
        modelName: "User",
        csvFilename: null,
        rowCount: 0,
        byteSize: null,
        sha256: null,
      });
    });

    it("skips models listed in BACKUP_EXCLUDED_MODELS", async () => {
      (db.Article.findAll as jest.Mock).mockResolvedValue([{ id: 1, title: "Article 1" }]);
      (db.ArticleApproved.findAll as jest.Mock).mockResolvedValue([]);
      (db.User.findAll as jest.Mock).mockResolvedValue([]);
      (db.ArticleEmbedding.findAll as jest.Mock).mockResolvedValue([
        { id: 1, articleId: 1, embedding: Buffer.from([1, 2, 3]) },
      ]);

      const { backupPath } = await createDatabaseBackupZipFile();
      const entryNames = new AdmZip(backupPath).getEntries().map((entry) => entry.entryName);
      const manifest = readManifest(backupPath);

      expect(db.ArticleEmbedding.findAll).not.toHaveBeenCalled();
      expect(entryNames.some((name) => name.endsWith("ArticleEmbedding.csv"))).toBe(false);
      expect(manifest.models.map((entry) => entry.modelName)).not.toContain("ArticleEmbedding");
    });

    it("includes AI Approver V02 models discovered through package exports", async () => {
      (db.Article.findAll as jest.Mock).mockResolvedValue([]);
      (db.ArticleApproved.findAll as jest.Mock).mockResolvedValue([]);
      (db.User.findAll as jest.Mock).mockResolvedValue([]);
      (db.AiApproverPromptVersionV02.findAll as jest.Mock).mockResolvedValue([
        { id: 1, promptInMarkdown: "Prompt" },
      ]);
      (db.AiApproverRunV02.findAll as jest.Mock).mockResolvedValue([
        { id: 2, activePromptVersionId: 1 },
      ]);
      (db.AiApproverArticlePredictionV02.findAll as jest.Mock).mockResolvedValue([
        { id: 3, articleId: 4, runId: 2 },
      ]);

      const { backupPath: zipPath } = await createDatabaseBackupZipFile();
      const zip = new AdmZip(zipPath);
      const entryNames = zip.getEntries().map((entry) => entry.entryName);

      expect(entryNames).toEqual(
        expect.arrayContaining([
          "AiApproverPromptVersionV02.csv",
          "AiApproverRunV02.csv",
          "AiApproverArticlePredictionV02.csv",
        ]),
      );
    });

    it("logs backup directory and creation messages", async () => {
      (db.Article.findAll as jest.Mock).mockResolvedValue([{ id: 1 }]);
      (db.ArticleApproved.findAll as jest.Mock).mockResolvedValue([]);
      (db.User.findAll as jest.Mock).mockResolvedValue([]);

      const { backupPath: zipPath } = await createDatabaseBackupZipFile();

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Backup directory:"),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(`Backup created: ${zipPath}`),
      );
    });

    it("logs error when backup fails", async () => {
      (db.Article.findAll as jest.Mock).mockRejectedValue(
        new Error("Database connection failed"),
      );

      await expect(createDatabaseBackupZipFile()).rejects.toThrow(
        "Database connection failed",
      );

      expect(logger.error).toHaveBeenCalledWith(
        "Error creating database backup",
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });

    it("cleans up backup directory when no data is found", async () => {
      (db.Article.findAll as jest.Mock).mockResolvedValue([]);
      (db.ArticleApproved.findAll as jest.Mock).mockResolvedValue([]);
      (db.User.findAll as jest.Mock).mockResolvedValue([]);

      await expect(createDatabaseBackupZipFile()).rejects.toThrow(
        "No data found in any tables",
      );

      // Verify no backup directories remain
      const contents = fs.readdirSync(tempBackupDir);
      const backupDirs = contents.filter((name) =>
        name.startsWith("db_backup_"),
      );
      expect(backupDirs.length).toBe(0);
    });

    it("creates CSV with correct structure", async () => {
      (db.Article.findAll as jest.Mock).mockResolvedValue([
        { id: 1, title: "Article 1", views: 100 },
        { id: 2, title: "Article 2", views: 200 },
      ]);
      (db.ArticleApproved.findAll as jest.Mock).mockResolvedValue([]);
      (db.User.findAll as jest.Mock).mockResolvedValue([]);

      const { backupPath: zipPath } = await createDatabaseBackupZipFile();

      // Extract and verify CSV content
      const AdmZip = require("adm-zip");
      const zip = new AdmZip(zipPath);
      const articleEntry = zip
        .getEntries()
        .find((e: any) => e.entryName === "Article.csv");

      expect(articleEntry).toBeDefined();

      const csvContent = articleEntry.getData().toString("utf8");
      const lines = csvContent.split("\n");

      // Check header
      expect(lines[0]).toContain("id");
      expect(lines[0]).toContain("title");
      expect(lines[0]).toContain("views");

      // Check data rows
      expect(lines[1]).toContain("1");
      expect(lines[1]).toContain("Article 1");
      expect(lines[1]).toContain("100");
    });

    it("formats one stable machine-readable success line", () => {
      const result = {
        backupPath: "/tmp/db_backup_202610022200000.zip",
        byteSize: 123,
        sha256: "a".repeat(64),
        manifestVersion: 1,
      };

      expect(JSON.parse(formatDatabaseBackupResult(result))).toEqual({
        event: "database_backup_created",
        ...result,
      });
    });
  });

  describe("getModelRegistry() (tested indirectly)", () => {
    it("only includes exports that have a findAll method", async () => {
      // This is tested indirectly through createDatabaseBackupZipFile
      // The mock setup includes sequelize and initModels which don't have findAll
      // Only Article, ArticleApproved, and User should be processed

      (db.Article.findAll as jest.Mock).mockResolvedValue([{ id: 1 }]);
      (db.ArticleApproved.findAll as jest.Mock).mockResolvedValue([
        { articleId: 1 },
      ]);
      (db.User.findAll as jest.Mock).mockResolvedValue([{ id: 1 }]);

      const { backupPath: zipPath } = await createDatabaseBackupZipFile();

      const AdmZip = require("adm-zip");
      const zip = new AdmZip(zipPath);
      const entryNames = zip.getEntries().map((e: any) => e.entryName);

      // Should only have CSV files for models with findAll
      expect(entryNames).toContain("Article.csv");
      expect(entryNames).toContain("ArticleApproved.csv");
      expect(entryNames).toContain("User.csv");

      // Should NOT have CSV files for non-model exports
      expect(entryNames).not.toContain("sequelize.csv");
      expect(entryNames).not.toContain("initModels.csv");
    });
  });
});
