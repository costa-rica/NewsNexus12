import AdmZip from "adm-zip";
import fs from "fs";
import os from "os";
import path from "path";

// Mock @newsnexus/db-models before importing the module under test
jest.mock("@newsnexus/db-models", () => ({
  Article: {
    bulkCreate: jest.fn(),
    rawAttributes: {
      publishedDate: { type: { key: "DATEONLY" } },
      createdAt: { type: { key: "DATE" } },
    },
  },
  User: {
    bulkCreate: jest.fn(),
    rawAttributes: {
      createdAt: { type: { key: "DATE" } },
    },
  },
  sequelize: {
    query: jest.fn(),
  },
  // Non-model exports
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
  importZipFileToDatabase,
  normalizeDateValue,
  sanitizeDateFields,
} from "../../src/modules/zipImport";

describe("Zip import module", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (db.Article.bulkCreate as jest.Mock).mockReset();
    (db.User.bulkCreate as jest.Mock).mockReset();
    (db.sequelize.query as jest.Mock).mockReset();
  });

  describe("normalizeDateValue()", () => {
    it("returns ISO string for a valid date string with DATE type", () => {
      const result = normalizeDateValue("2024-03-15T10:30:00Z", "DATE");
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(result).toContain("2024-03-15");
    });

    it("returns YYYY-MM-DD for a valid date string with DATEONLY type", () => {
      const result = normalizeDateValue("2024-03-15T10:30:00Z", "DATEONLY");
      expect(result).toBe("2024-03-15");
    });

    it("returns null for empty string", () => {
      const result = normalizeDateValue("", "DATE");
      expect(result).toBeNull();
    });

    it("returns null for whitespace-only string", () => {
      const result = normalizeDateValue("   ", "DATE");
      expect(result).toBeNull();
    });

    it("returns null for null input", () => {
      const result = normalizeDateValue(null, "DATE");
      expect(result).toBeNull();
    });

    it("returns null for undefined input", () => {
      const result = normalizeDateValue(undefined, "DATE");
      expect(result).toBeNull();
    });

    it("returns null for an unparseable date string", () => {
      const result = normalizeDateValue("not-a-date", "DATE");
      expect(result).toBeNull();
    });

    it("handles numeric timestamps", () => {
      const timestamp = 1710499800000; // 2024-03-15T10:30:00.000Z
      const result = normalizeDateValue(timestamp, "DATE");
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it("normalizes different date formats to ISO", () => {
      const result1 = normalizeDateValue("March 15, 2024", "DATE");
      const result2 = normalizeDateValue("2024/03/15", "DATE");
      const result3 = normalizeDateValue("15-Mar-2024", "DATE");

      expect(result1).toMatch(/2024-03-15/);
      expect(result2).toMatch(/2024-03-15/);
      expect(result3).toMatch(/2024-03-15/);
    });
  });

  describe("sanitizeDateFields()", () => {
    it("returns 0 when no date fields exist", () => {
      const records = [{ id: 1, name: "Test" }] as any;
      const dateFields: any[] = [];

      const result = sanitizeDateFields(records, dateFields);

      expect(result).toBe(0);
      expect(records[0]).toEqual({ id: 1, name: "Test" });
    });

    it("returns 0 when records are empty", () => {
      const records: any[] = [];
      const dateFields = [{ field: "createdAt", typeKey: "DATE" as const }];

      const result = sanitizeDateFields(records, dateFields);

      expect(result).toBe(0);
    });

    it("normalizes valid date strings in-place", () => {
      const records = [
        { id: 1, createdAt: "2024-03-15T10:30:00Z" },
        { id: 2, createdAt: "2024-03-16T12:00:00Z" },
      ] as any;
      const dateFields = [{ field: "createdAt", typeKey: "DATE" as const }];

      const result = sanitizeDateFields(records, dateFields);

      expect(result).toBe(0); // No invalid dates
      expect(records[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(records[1].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("sets invalid date values to null and returns the sanitized count", () => {
      const records = [
        { id: 1, createdAt: "not-a-date" },
        { id: 2, createdAt: "2024-03-15T10:30:00Z" },
        { id: 3, createdAt: "invalid" },
      ] as any;
      const dateFields = [{ field: "createdAt", typeKey: "DATE" as const }];

      const result = sanitizeDateFields(records, dateFields);

      expect(result).toBe(2); // Two invalid dates
      expect(records[0].createdAt).toBeNull();
      expect(records[1].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(records[2].createdAt).toBeNull();
    });

    it("handles multiple date fields in the same record", () => {
      const records = [
        {
          id: 1,
          publishedDate: "2024-03-15",
          createdAt: "not-a-date",
        },
      ] as any;
      const dateFields = [
        { field: "publishedDate", typeKey: "DATEONLY" as const },
        { field: "createdAt", typeKey: "DATE" as const },
      ];

      const result = sanitizeDateFields(records, dateFields);

      expect(result).toBe(1); // Only createdAt is invalid
      expect(records[0].publishedDate).toBe("2024-03-15");
      expect(records[0].createdAt).toBeNull();
    });

    it("does not count null values that were already null", () => {
      const records = [
        { id: 1, createdAt: null },
        { id: 2, createdAt: "not-a-date" },
      ] as any;
      const dateFields = [{ field: "createdAt", typeKey: "DATE" as const }];

      const result = sanitizeDateFields(records, dateFields);

      expect(result).toBe(1); // Only the second one was sanitized
      expect(records[0].createdAt).toBeNull();
      expect(records[1].createdAt).toBeNull();
    });
  });

  describe("importZipFileToDatabase()", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zipimport-test-"));
    });

    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("throws when the zip file path does not exist", async () => {
      const nonExistentPath = path.join(tempDir, "does-not-exist.zip");

      await expect(importZipFileToDatabase(nonExistentPath)).rejects.toThrow();
    });

    it("throws 'No CSV files found' when the zip contains no CSV files", async () => {
      const zipPath = path.join(tempDir, "empty.zip");
      const zip = new AdmZip();
      zip.addFile("readme.txt", Buffer.from("No CSV here"));
      zip.writeZip(zipPath);

      await expect(importZipFileToDatabase(zipPath)).rejects.toThrow(
        "No CSV files found inside the zip file",
      );
    });

    it("imports CSV records into matching models via bulkCreate", async () => {
      const zipPath = path.join(tempDir, "data.zip");
      const zip = new AdmZip();

      // Add Article CSV
      const articleCsv = "id,title,publishedDate\n1,Article 1,2024-03-15\n2,Article 2,2024-03-16";
      zip.addFile("Article.csv", Buffer.from(articleCsv));

      // Add User CSV
      const userCsv = "id,email,createdAt\n1,user1@example.com,2024-03-15T10:00:00Z";
      zip.addFile("User.csv", Buffer.from(userCsv));

      zip.writeZip(zipPath);

      (db.Article.bulkCreate as jest.Mock).mockResolvedValue(null);
      (db.User.bulkCreate as jest.Mock).mockResolvedValue(null);
      (db.sequelize.query as jest.Mock).mockResolvedValue(null);

      const result = await importZipFileToDatabase(zipPath);

      expect(result.totalRecords).toBe(3); // 2 articles + 1 user
      expect(result.importedTables).toContain("Article");
      expect(result.importedTables).toContain("User");
      expect(db.Article.bulkCreate).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: "1", title: "Article 1" }),
          expect.objectContaining({ id: "2", title: "Article 2" }),
        ]),
        { ignoreDuplicates: true },
      );
      expect(db.User.bulkCreate).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: "1", email: "user1@example.com" }),
        ]),
        { ignoreDuplicates: true },
      );
    });

    it("reports skipped files when CSV filenames do not match any model", async () => {
      const zipPath = path.join(tempDir, "data.zip");
      const zip = new AdmZip();

      zip.addFile("Article.csv", Buffer.from("id,title\n1,Article 1"));
      zip.addFile("UnknownModel.csv", Buffer.from("id,name\n1,Test"));

      zip.writeZip(zipPath);

      (db.Article.bulkCreate as jest.Mock).mockResolvedValue(null);
      (db.sequelize.query as jest.Mock).mockResolvedValue(null);

      const result = await importZipFileToDatabase(zipPath);

      expect(result.skippedFiles).toContain("UnknownModel.csv");
      expect(result.importedTables).not.toContain("UnknownModel");
    });

    it("disables and re-enables foreign keys around the import", async () => {
      const zipPath = path.join(tempDir, "data.zip");
      const zip = new AdmZip();
      zip.addFile("Article.csv", Buffer.from("id,title\n1,Article 1"));
      zip.writeZip(zipPath);

      (db.Article.bulkCreate as jest.Mock).mockResolvedValue(null);
      (db.sequelize.query as jest.Mock).mockResolvedValue(null);

      await importZipFileToDatabase(zipPath);

      expect(db.sequelize.query).toHaveBeenCalledWith(
        "PRAGMA foreign_keys = OFF;",
      );
      expect(db.sequelize.query).toHaveBeenCalledWith(
        "PRAGMA foreign_keys = ON;",
      );
    });

    it("re-enables foreign keys even when an error occurs during import", async () => {
      const zipPath = path.join(tempDir, "data.zip");
      const zip = new AdmZip();
      zip.addFile("Article.csv", Buffer.from("id,title\n1,Article 1"));
      zip.writeZip(zipPath);

      (db.Article.bulkCreate as jest.Mock).mockRejectedValue(
        new Error("Database error"),
      );
      (db.sequelize.query as jest.Mock).mockResolvedValue(null);

      await expect(importZipFileToDatabase(zipPath)).rejects.toThrow(
        "Database error",
      );

      // Verify foreign keys were re-enabled in the catch block
      const calls = (db.sequelize.query as jest.Mock).mock.calls;
      const fkOnCalls = calls.filter((call) =>
        call[0].includes("PRAGMA foreign_keys = ON"),
      );
      expect(fkOnCalls.length).toBeGreaterThanOrEqual(1);
    });

    it("cleans up the temporary extraction directory after import", async () => {
      const zipPath = path.join(tempDir, "data.zip");
      const zip = new AdmZip();
      zip.addFile("Article.csv", Buffer.from("id,title\n1,Article 1"));
      zip.writeZip(zipPath);

      const tempDirsBefore = new Set(
        fs
          .readdirSync(os.tmpdir())
          .filter((name) => name.startsWith("newsnexus-db-import-")),
      );

      (db.Article.bulkCreate as jest.Mock).mockResolvedValue(null);
      (db.sequelize.query as jest.Mock).mockResolvedValue(null);

      await importZipFileToDatabase(zipPath);

      // Check that no temp directories with the prefix remain
      const tmpDirContents = fs.readdirSync(os.tmpdir());
      const newsnexusTempDirs = tmpDirContents.filter((name) =>
        name.startsWith("newsnexus-db-import-"),
      );

      const newTempDirs = newsnexusTempDirs.filter((name) => !tempDirsBefore.has(name));
      expect(newTempDirs).toEqual([]);
    });

    it("logs progress during import", async () => {
      const zipPath = path.join(tempDir, "data.zip");
      const zip = new AdmZip();
      zip.addFile("Article.csv", Buffer.from("id,title\n1,Article 1"));
      zip.writeZip(zipPath);

      (db.Article.bulkCreate as jest.Mock).mockResolvedValue(null);
      (db.sequelize.query as jest.Mock).mockResolvedValue(null);

      await importZipFileToDatabase(zipPath);

      expect(logger.info).toHaveBeenCalledWith(
        "Disabling foreign key constraints for import",
      );
      expect(logger.info).toHaveBeenCalledWith(
        "Re-enabling foreign key constraints after import",
      );
    });

    it("sanitizes invalid dates and logs warnings", async () => {
      const zipPath = path.join(tempDir, "data.zip");
      const zip = new AdmZip();

      const articleCsv =
        "id,title,publishedDate\n1,Article 1,invalid-date\n2,Article 2,2024-03-15";
      zip.addFile("Article.csv", Buffer.from(articleCsv));
      zip.writeZip(zipPath);

      (db.Article.bulkCreate as jest.Mock).mockResolvedValue(null);
      (db.sequelize.query as jest.Mock).mockResolvedValue(null);

      await importZipFileToDatabase(zipPath);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Sanitized 1 invalid date values"),
      );
    });
  });
});
