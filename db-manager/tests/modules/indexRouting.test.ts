jest.mock("@newsnexus/db-models", () => ({
  ensureSchemaReady: jest.fn(),
  initModels: jest.fn(),
  sequelize: {
    close: jest.fn(),
    getQueryInterface: jest.fn(() => ({
      showAllTables: jest.fn().mockResolvedValue([]),
    })),
    query: jest.fn(),
    sync: jest.fn(),
  },
}));

jest.mock("../../src/config/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("../../src/modules/status", () => ({
  getDatabaseStatus: jest.fn(),
}));

jest.mock("../../src/modules/deleteArticles", () => ({
  deleteOldUnapprovedArticles: jest.fn(),
  deleteOldestEligibleArticles: jest.fn(),
  formatDeleteOldArticlesResult: jest.fn(),
}));

jest.mock("../../src/modules/backup", () => ({
  createDatabaseBackupZipFile: jest.fn(),
  formatDatabaseBackupResult: jest.fn(),
}));

jest.mock("../../src/modules/deleteArticlesNoState", () => ({
  deleteNoStateArticles: jest.fn(),
}));

jest.mock("../../src/modules/deleteArticlesRetiredSources", () => ({
  deleteRetiredSourcesArticles: jest.fn(),
}));

jest.mock("../../src/modules/zipImport", () => ({
  importZipFileToDatabase: jest.fn(),
  rebuildSchema: jest.fn(),
}));

jest.mock("../../src/modules/dryRunValidator", () => ({
  runDryRunValidator: jest.fn(),
}));

import { ensureSchemaReady, sequelize } from "@newsnexus/db-models";
import { runDbManager } from "../../src/index";
import {
  createDatabaseBackupZipFile,
  formatDatabaseBackupResult,
} from "../../src/modules/backup";
import {
  deleteOldUnapprovedArticles,
  formatDeleteOldArticlesResult,
} from "../../src/modules/deleteArticles";
import { deleteNoStateArticles } from "../../src/modules/deleteArticlesNoState";
import { deleteRetiredSourcesArticles } from "../../src/modules/deleteArticlesRetiredSources";
import { runDryRunValidator } from "../../src/modules/dryRunValidator";
import { getDatabaseStatus } from "../../src/modules/status";

const statusSummary = {
  totalArticles: 10,
  irrelevantArticles: 2,
  approvedArticles: 1,
  cutoffDate: "2026-01-01",
  oldArticles: 4,
  deletableOldArticles: 3,
};

describe("db-manager index routing", () => {
  let stderrWriteSpy: jest.SpyInstance;
  let stdoutWriteSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    (ensureSchemaReady as jest.Mock).mockResolvedValue(undefined);
    (sequelize.close as jest.Mock).mockResolvedValue(undefined);
    (deleteNoStateArticles as jest.Mock).mockResolvedValue({
      deletedCount: 0,
      preview: {},
    });
    (deleteRetiredSourcesArticles as jest.Mock).mockResolvedValue({
      deletedCount: 0,
      preview: {},
    });
    (runDryRunValidator as jest.Mock).mockResolvedValue({ success: true });
    (getDatabaseStatus as jest.Mock).mockResolvedValue(statusSummary);
    (createDatabaseBackupZipFile as jest.Mock).mockResolvedValue({
      backupPath: "/tmp/backup.zip",
      byteSize: 123,
      sha256: "a".repeat(64),
      manifestVersion: 1,
    });
    (formatDatabaseBackupResult as jest.Mock).mockReturnValue(
      '{"event":"database_backup_created"}',
    );
    (deleteOldUnapprovedArticles as jest.Mock).mockResolvedValue({
      daysOldThreshold: 180,
      cutoffDate: "2026-04-05",
      eligibleCount: 3,
      processedCount: 3,
      deletedCount: 3,
    });
    (formatDeleteOldArticlesResult as jest.Mock).mockReturnValue(
      '{"event":"old_articles_deleted"}',
    );
    stderrWriteSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    stdoutWriteSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stderrWriteSpy.mockRestore();
    stdoutWriteSpy.mockRestore();
  });

  it("emits the stable backup result before completing the command", async () => {
    const exitCode = await runDbManager(["--create_backup"]);

    expect(exitCode).toBe(0);
    expect(formatDatabaseBackupResult).toHaveBeenCalledWith(
      expect.objectContaining({ backupPath: "/tmp/backup.zip" }),
    );
    expect(stdoutWriteSpy).toHaveBeenCalledWith(
      '{"event":"database_backup_created"}\n',
    );
    expect(getDatabaseStatus).toHaveBeenCalled();
  });

  it("returns failure after emitting a backup result when status fails", async () => {
    (getDatabaseStatus as jest.Mock).mockRejectedValueOnce(
      new Error("status unavailable"),
    );

    const exitCode = await runDbManager(["--create_backup"]);

    expect(exitCode).toBe(1);
    expect(stdoutWriteSpy).toHaveBeenCalledWith(
      '{"event":"database_backup_created"}\n',
    );
  });

  it("emits exactly one stable result after successful old-article deletion", async () => {
    const exitCode = await runDbManager(["--delete_articles"]);

    expect(exitCode).toBe(0);
    expect(deleteOldUnapprovedArticles).toHaveBeenCalledWith(180);
    expect(formatDeleteOldArticlesResult).toHaveBeenCalledWith(
      expect.objectContaining({ daysOldThreshold: 180 }),
    );
    expect(stdoutWriteSpy).toHaveBeenCalledTimes(1);
    expect(stdoutWriteSpy).toHaveBeenCalledWith(
      '{"event":"old_articles_deleted"}\n',
    );
  });

  it("does not emit a result when old-article deletion fails", async () => {
    (deleteOldUnapprovedArticles as jest.Mock).mockRejectedValueOnce(
      new Error("delete failed"),
    );

    const exitCode = await runDbManager(["--delete_articles"]);

    expect(exitCode).toBe(1);
    expect(formatDeleteOldArticlesResult).not.toHaveBeenCalled();
    expect(stdoutWriteSpy).not.toHaveBeenCalled();
  });

  it("returns failure after emitting a deletion result when status fails", async () => {
    (getDatabaseStatus as jest.Mock).mockRejectedValueOnce(
      new Error("status unavailable"),
    );

    const exitCode = await runDbManager(["--delete_articles"]);

    expect(exitCode).toBe(1);
    expect(stdoutWriteSpy).toHaveBeenCalledWith(
      '{"event":"old_articles_deleted"}\n',
    );
  });

  it("routes --delete_articles_no_state execute path to the no-state module", async () => {
    const exitCode = await runDbManager(["--delete_articles_no_state", "100"]);

    expect(exitCode).toBe(0);
    expect(deleteNoStateArticles).toHaveBeenCalledWith({
      dryRun: false,
      limit: 100,
    });
    expect(getDatabaseStatus).toHaveBeenCalled();
  });

  it("routes --dry_run --delete_articles_no_state to the preview path", async () => {
    const exitCode = await runDbManager([
      "--dry_run",
      "--delete_articles_no_state",
    ]);

    expect(exitCode).toBe(0);
    expect(deleteNoStateArticles).toHaveBeenCalledWith({
      dryRun: true,
      limit: undefined,
    });
    expect(getDatabaseStatus).not.toHaveBeenCalled();
  });

  it("routes --delete_articles_retired_sources execute path to the retired-sources module", async () => {
    const exitCode = await runDbManager([
      "--delete_articles_retired_sources",
      "100",
    ]);

    expect(exitCode).toBe(0);
    expect(deleteRetiredSourcesArticles).toHaveBeenCalledWith({
      dryRun: false,
      limit: 100,
    });
    expect(getDatabaseStatus).toHaveBeenCalled();
  });

  it("routes --dry_run --delete_articles_retired_sources to the preview path", async () => {
    const exitCode = await runDbManager([
      "--dry_run",
      "--delete_articles_retired_sources",
    ]);

    expect(exitCode).toBe(0);
    expect(deleteRetiredSourcesArticles).toHaveBeenCalledWith({
      dryRun: true,
      limit: undefined,
    });
    expect(deleteNoStateArticles).not.toHaveBeenCalled();
    expect(getDatabaseStatus).not.toHaveBeenCalled();
  });

  it("keeps --dry_run alone invalid", async () => {
    const exitCode = await runDbManager(["--dry_run"]);

    expect(exitCode).toBe(1);
    expect(stderrWriteSpy).toHaveBeenCalledWith(
      "--dry_run requires --zip_file <path>, --delete_articles_no_state, or --delete_articles_retired_sources\n",
    );
    expect(deleteNoStateArticles).not.toHaveBeenCalled();
    expect(deleteRetiredSourcesArticles).not.toHaveBeenCalled();
    expect(runDryRunValidator).not.toHaveBeenCalled();
  });

  it("keeps --dry_run --zip_file routed to the zip validator", async () => {
    const exitCode = await runDbManager([
      "--dry_run",
      "--zip_file",
      "/tmp/backup.zip",
    ]);

    expect(exitCode).toBe(0);
    expect(runDryRunValidator).toHaveBeenCalledWith("/tmp/backup.zip");
    expect(deleteNoStateArticles).not.toHaveBeenCalled();
    expect(deleteRetiredSourcesArticles).not.toHaveBeenCalled();
  });

  it("rejects dry-run with multiple dry-runnable targets", async () => {
    const exitCode = await runDbManager([
      "--dry_run",
      "--zip_file",
      "/tmp/backup.zip",
      "--delete_articles_retired_sources",
    ]);

    expect(exitCode).toBe(1);
    expect(stderrWriteSpy).toHaveBeenCalledWith(
      "--dry_run cannot combine --zip_file, --delete_articles_no_state, and --delete_articles_retired_sources\n",
    );
    expect(runDryRunValidator).not.toHaveBeenCalled();
    expect(deleteRetiredSourcesArticles).not.toHaveBeenCalled();
  });

  it("runs no-state deletion before retired-sources deletion", async () => {
    const exitCode = await runDbManager([
      "--delete_articles_no_state",
      "10",
      "--delete_articles_retired_sources",
      "20",
    ]);

    expect(exitCode).toBe(0);
    expect(deleteNoStateArticles).toHaveBeenCalledWith({
      dryRun: false,
      limit: 10,
    });
    expect(deleteRetiredSourcesArticles).toHaveBeenCalledWith({
      dryRun: false,
      limit: 20,
    });
    expect(
      (deleteNoStateArticles as jest.Mock).mock.invocationCallOrder[0],
    ).toBeLessThan(
      (deleteRetiredSourcesArticles as jest.Mock).mock.invocationCallOrder[0],
    );
  });
});
