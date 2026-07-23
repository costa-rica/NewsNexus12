import AdmZip from "adm-zip";
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
import { createDatabaseBackupZipFile } from "../../src/modules/backup";

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

      const zipPath = await createDatabaseBackupZipFile();

      expect(zipPath).toMatch(/db_backup_\d{15}\.zip$/);
      expect(fs.existsSync(zipPath)).toBe(true);

      // Verify the file is a zip file (has zip magic bytes)
      const buffer = fs.readFileSync(zipPath);
      expect(buffer[0]).toBe(0x50); // 'P'
      expect(buffer[1]).toBe(0x4b); // 'K'
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

      const zipPath = await createDatabaseBackupZipFile();

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

      const zipPath = await createDatabaseBackupZipFile();

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

      const zipPath = await createDatabaseBackupZipFile();
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

      const zipPath = await createDatabaseBackupZipFile();

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

      const zipPath = await createDatabaseBackupZipFile();

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

      const zipPath = await createDatabaseBackupZipFile();

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
