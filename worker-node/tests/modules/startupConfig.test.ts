process.env.PG_HOST = "localhost";
process.env.PG_PORT = "5432";
process.env.PG_DATABASE = "newsnexus_test_worker_node";
process.env.PG_USER = "nick";

import { startServer } from "../../src/server";

const requiredEnv = {
  PATH_AND_FILENAME_FOR_QUERY_SPREADSHEET_AUTOMATED: "/tmp/input.xlsx",
  PATH_TO_SEMANTIC_SCORER_DIR: "/tmp/semantic",
  PATH_TO_LOGS: "/tmp/logs",
  NODE_ENV: "testing",
  KEY_OPEN_AI: "abc123",
  PATH_TO_STATE_ASSIGNER_FILES: "/tmp/chatgpt",
  NAME_APP: "worker-node",
  PG_HOST: "localhost",
  PG_PORT: "5432",
  PG_DATABASE: "newsnexus_test_worker_node",
  PG_USER: "nick",
  PATH_UTILTIES: "/tmp/utilities",
};

describe("startup config validation", () => {
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

    stderrSpy.mockRestore();
  });
});
