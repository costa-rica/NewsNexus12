process.env.PG_HOST = "localhost";
process.env.PG_PORT = "5432";
process.env.PG_DATABASE = "newsnexus_test_worker_node";
process.env.PG_USER = "newsnexus_boot";

import { startServer } from "../../src/server";
import {
  loadAppConfig,
  StartupConfigError,
} from "../../src/modules/startup/config";

const requiredEnv = {
  PATH_AND_FILENAME_FOR_QUERY_SPREADSHEET_AUTOMATED: "/tmp/input.xlsx",
  PATH_TO_SEMANTIC_SCORER_DIR: "/tmp/semantic",
  PATH_TO_LOGS: "/tmp/logs",
  NODE_ENV: "testing",
  PATH_TO_STATE_ASSIGNER_FILES: "/tmp/chatgpt",
  NAME_APP: "worker-node",
  PG_HOST: "localhost",
  PG_PORT: "5432",
  PG_DATABASE: "newsnexus_test_worker_node",
  PG_USER: "newsnexus_boot",
  PATH_UTILTIES: "/tmp/utilities",
  URL_BASE_NEWS_NEXUS_WORKER_PYTHON: "http://worker-python",
  LIMIT_ARTICLE_AGE_IN_DAYS: "180",
};

describe("startup config validation", () => {
  it.each([
    ["absent", undefined],
    ["blank", "   "],
  ])(
    "defaults WORKER_HTTP_DIAGNOSTICS_ENABLED to false when %s",
    (_description, value) => {
      const config = loadAppConfig({
        ...requiredEnv,
        ...(value === undefined
          ? {}
          : { WORKER_HTTP_DIAGNOSTICS_ENABLED: value }),
      });

      expect(config.workerHttpDiagnosticsEnabled).toBe(false);
    },
  );

  it.each(["1", "true", "yes", "on", " TRUE ", " YeS "])(
    "parses WORKER_HTTP_DIAGNOSTICS_ENABLED=%p as true",
    (value) => {
      const config = loadAppConfig({
        ...requiredEnv,
        WORKER_HTTP_DIAGNOSTICS_ENABLED: value,
      });

      expect(config.workerHttpDiagnosticsEnabled).toBe(true);
    },
  );

  it.each(["0", "false", "no", "off", " FALSE ", " oFf "])(
    "parses WORKER_HTTP_DIAGNOSTICS_ENABLED=%p as false",
    (value) => {
      const config = loadAppConfig({
        ...requiredEnv,
        WORKER_HTTP_DIAGNOSTICS_ENABLED: value,
      });

      expect(config.workerHttpDiagnosticsEnabled).toBe(false);
    },
  );

  it.each(["enabled", "2", "truthy"])(
    "rejects invalid WORKER_HTTP_DIAGNOSTICS_ENABLED=%p",
    (value) => {
      const loadInvalidConfig = () =>
        loadAppConfig({
          ...requiredEnv,
          WORKER_HTTP_DIAGNOSTICS_ENABLED: value,
        });

      expect(loadInvalidConfig).toThrow(StartupConfigError);
      expect(loadInvalidConfig).toThrow("WORKER_HTTP_DIAGNOSTICS_ENABLED");
    },
  );

  it("loads without KEY_OPEN_AI because state assigner can use codex by default", () => {
    const config = loadAppConfig(requiredEnv);

    expect(config.keyOpenAi).toBeUndefined();
  });

  it("keeps KEY_OPEN_AI when provided for OpenAI API mode", () => {
    const config = loadAppConfig({
      ...requiredEnv,
      KEY_OPEN_AI: "abc123",
    });

    expect(config.keyOpenAi).toBe("abc123");
  });

  it("validates DELETE_ARTICLES_BATCH_SIZE when provided", () => {
    expect(() =>
      loadAppConfig({
        ...requiredEnv,
        DELETE_ARTICLES_BATCH_SIZE: "zero",
      }),
    ).toThrow("DELETE_ARTICLES_BATCH_SIZE");
  });

  it("fails when LIMIT_ARTICLE_AGE_IN_DAYS is missing", () => {
    const { LIMIT_ARTICLE_AGE_IN_DAYS: _omit, ...envWithout } = requiredEnv;
    expect(() => loadAppConfig(envWithout)).toThrow(
      "LIMIT_ARTICLE_AGE_IN_DAYS",
    );
  });

  it("fails when LIMIT_ARTICLE_AGE_IN_DAYS is not a positive integer", () => {
    expect(() =>
      loadAppConfig({
        ...requiredEnv,
        LIMIT_ARTICLE_AGE_IN_DAYS: "zero",
      }),
    ).toThrow("LIMIT_ARTICLE_AGE_IN_DAYS");
  });

  it("fails startup and exits when required env vars are missing", async () => {
    const stderrSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const exitMock = jest.fn((code: number): never => {
      throw new Error(`EXIT_${code}`);
    });

    const envWithMissingVar = {
      ...requiredEnv,
      PATH_TO_LOGS: "",
    };

    await expect(
      startServer({
        env: envWithMissingVar,
        exit: exitMock,
        exitDelayMs: 0,
      }),
    ).rejects.toThrow("EXIT_1");

    expect(exitMock).toHaveBeenCalledWith(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("Missing required environment variables"),
    );
    expect(stderrSpy).not.toHaveBeenCalledWith(expect.stringContaining("KEY_OPEN_AI"));

    stderrSpy.mockRestore();
  });
});
