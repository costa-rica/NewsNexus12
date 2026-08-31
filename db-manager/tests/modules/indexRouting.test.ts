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
}));

jest.mock("../../src/modules/backup", () => ({
  BACKUP_MANIFEST_VERSION: 1,
  createDatabaseBackupZipFile: jest.fn(),
}));

jest.mock("../../src/modules/clearDuplicateAnalyses", () => ({
  clearDuplicateAnalyses: jest.fn(),
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
import { deleteNoStateArticles } from "../../src/modules/deleteArticlesNoState";
import { deleteRetiredSourcesArticles } from "../../src/modules/deleteArticlesRetiredSources";
import { runDryRunValidator } from "../../src/modules/dryRunValidator";
import { getDatabaseStatus } from "../../src/modules/status";
import { clearDuplicateAnalyses } from "../../src/modules/clearDuplicateAnalyses";
import { deleteOldUnapprovedArticles } from "../../src/modules/deleteArticles";
import { createDatabaseBackupZipFile } from "../../src/modules/backup";

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
    (clearDuplicateAnalyses as jest.Mock).mockResolvedValue({
      command: "clear_duplicate_analyses",
      success: true,
      beforeCount: 3,
      deletedCount: 3,
      remainingCount: 0,
      batchCount: 1,
    });
    (deleteOldUnapprovedArticles as jest.Mock).mockResolvedValue({
      foundCount: 2,
      deletedCount: 2,
      cutoffDate: "2026-03-04",
    });
    (createDatabaseBackupZipFile as jest.Mock).mockResolvedValue(
      "/tmp/db_backup.zip",
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

  it("runs duplicate cleanup before backup and emits stable summaries", async () => {
    const exitCode = await runDbManager([
      "--clear_duplicate_analyses",
      "--create_backup",
    ]);

    expect(exitCode).toBe(0);
    expect(clearDuplicateAnalyses).toHaveBeenCalledTimes(1);
    expect(createDatabaseBackupZipFile).toHaveBeenCalledTimes(1);
    expect(
      (clearDuplicateAnalyses as jest.Mock).mock.invocationCallOrder[0],
    ).toBeLessThan(
      (createDatabaseBackupZipFile as jest.Mock).mock.invocationCallOrder[0],
    );
    expect(stdoutWriteSpy).toHaveBeenCalledWith(
      expect.stringContaining('"command":"clear_duplicate_analyses"'),
    );
    expect(stdoutWriteSpy).toHaveBeenCalledWith(
      expect.stringContaining('"manifestVersion":1'),
    );
  });

  it("keeps the default 180-day deletion and emits its result", async () => {
    const exitCode = await runDbManager(["--delete_articles"]);

    expect(exitCode).toBe(0);
    expect(deleteOldUnapprovedArticles).toHaveBeenCalledWith(180);
    expect(stdoutWriteSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '"command":"delete_articles","success":true,"foundCount":2,"deletedCount":2',
      ),
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
