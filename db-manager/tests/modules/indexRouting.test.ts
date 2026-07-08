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
  createDatabaseBackupZipFile: jest.fn(),
}));

jest.mock("../../src/modules/deleteArticlesNoState", () => ({
  deleteNoStateArticles: jest.fn(),
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

  beforeEach(() => {
    jest.clearAllMocks();
    (ensureSchemaReady as jest.Mock).mockResolvedValue(undefined);
    (sequelize.close as jest.Mock).mockResolvedValue(undefined);
    (deleteNoStateArticles as jest.Mock).mockResolvedValue({
      deletedCount: 0,
      preview: {},
    });
    (runDryRunValidator as jest.Mock).mockResolvedValue({ success: true });
    (getDatabaseStatus as jest.Mock).mockResolvedValue(statusSummary);
    stderrWriteSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stderrWriteSpy.mockRestore();
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

  it("keeps --dry_run alone invalid", async () => {
    const exitCode = await runDbManager(["--dry_run"]);

    expect(exitCode).toBe(1);
    expect(stderrWriteSpy).toHaveBeenCalledWith(
      "--dry_run requires --zip_file <path> or --delete_articles_no_state\n",
    );
    expect(deleteNoStateArticles).not.toHaveBeenCalled();
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
  });
});
