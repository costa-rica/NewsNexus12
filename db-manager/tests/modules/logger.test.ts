import fs from "fs";
import os from "os";
import path from "path";

describe("Logger configuration", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let mockExit: jest.SpyInstance;
  let mockStderrWrite: jest.SpyInstance;
  let tempLogsDir: string;

  beforeEach(() => {
    // Save original env
    originalEnv = { ...process.env };

    // Create temp logs directory
    tempLogsDir = fs.mkdtempSync(path.join(os.tmpdir(), "logger-test-"));

    // Mock process.exit and process.stderr.write
    mockExit = jest.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
    mockStderrWrite = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    // Reset modules to clear cached logger
    jest.resetModules();
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;

    // Restore mocks
    mockExit.mockRestore();
    mockStderrWrite.mockRestore();

    // Clean up temp directory
    if (fs.existsSync(tempLogsDir)) {
      fs.rmSync(tempLogsDir, { recursive: true, force: true });
    }
  });

  describe("when all required env vars are set", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "development";
      process.env.NAME_APP = "test-app";
      process.env.PATH_TO_LOGS = tempLogsDir;
    });

    it("creates a Winston logger instance", () => {
      const { logger } = require("../../src/config/logger");
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe("function");
    });

    it("logger has info, warn, error, and debug methods", () => {
      const { logger } = require("../../src/config/logger");
      expect(typeof logger.info).toBe("function");
      expect(typeof logger.warn).toBe("function");
      expect(typeof logger.error).toBe("function");
      expect(typeof logger.debug).toBe("function");
    });
  });

  describe("transport configuration", () => {
    beforeEach(() => {
      process.env.NAME_APP = "test-app";
      process.env.PATH_TO_LOGS = tempLogsDir;
    });

    it("uses console transport in development mode", () => {
      process.env.NODE_ENV = "development";
      const { logger } = require("../../src/config/logger");

      const consoleTransport = logger.transports.find(
        (t: { name?: string }) => t.name === "console",
      );
      expect(consoleTransport).toBeDefined();
    });

    it("uses file transport in production mode", () => {
      process.env.NODE_ENV = "production";
      const { logger } = require("../../src/config/logger");

      const fileTransport = logger.transports.find(
        (t: { name?: string }) => t.name === "file",
      );
      expect(fileTransport).toBeDefined();
    });

    it("uses file transport in testing mode", () => {
      process.env.NODE_ENV = "testing";
      const { logger } = require("../../src/config/logger");

      const fileTransport = logger.transports.find(
        (t: { name?: string }) => t.name === "file",
      );
      expect(fileTransport).toBeDefined();
    });

    it("does not use console transport in production mode", () => {
      process.env.NODE_ENV = "production";
      const { logger } = require("../../src/config/logger");

      const consoleTransport = logger.transports.find(
        (t: { name?: string }) => t.name === "console",
      );
      expect(consoleTransport).toBeUndefined();
    });
  });

  describe("log level configuration", () => {
    beforeEach(() => {
      process.env.NAME_APP = "test-app";
      process.env.PATH_TO_LOGS = tempLogsDir;
    });

    it("uses debug log level in development mode", () => {
      process.env.NODE_ENV = "development";
      const { logger } = require("../../src/config/logger");
      expect(logger.level).toBe("debug");
    });

    it("uses info log level in production mode", () => {
      process.env.NODE_ENV = "production";
      const { logger } = require("../../src/config/logger");
      expect(logger.level).toBe("info");
    });

    it("uses info log level in testing mode", () => {
      process.env.NODE_ENV = "testing";
      const { logger } = require("../../src/config/logger");
      expect(logger.level).toBe("info");
    });
  });

  describe("environment variable validation", () => {
    it("exits with error when NODE_ENV is missing", () => {
      delete process.env.NODE_ENV;
      process.env.NAME_APP = "test-app";
      process.env.PATH_TO_LOGS = tempLogsDir;

      expect(() => {
        require("../../src/config/logger");
      }).toThrow("process.exit called");

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(mockStderrWrite).toHaveBeenCalledWith(
        expect.stringContaining("NODE_ENV"),
      );
    });

    it("exits with error when NAME_APP is missing", () => {
      process.env.NODE_ENV = "development";
      delete process.env.NAME_APP;
      process.env.PATH_TO_LOGS = tempLogsDir;

      expect(() => {
        require("../../src/config/logger");
      }).toThrow("process.exit called");

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(mockStderrWrite).toHaveBeenCalledWith(
        expect.stringContaining("NAME_APP"),
      );
    });

    it("exits with error when PATH_TO_LOGS is missing", () => {
      process.env.NODE_ENV = "development";
      process.env.NAME_APP = "test-app";
      delete process.env.PATH_TO_LOGS;

      expect(() => {
        require("../../src/config/logger");
      }).toThrow("process.exit called");

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(mockStderrWrite).toHaveBeenCalledWith(
        expect.stringContaining("PATH_TO_LOGS"),
      );
    });

    it("exits with error when multiple env vars are missing", () => {
      delete process.env.NODE_ENV;
      delete process.env.NAME_APP;
      delete process.env.PATH_TO_LOGS;

      expect(() => {
        require("../../src/config/logger");
      }).toThrow("process.exit called");

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(mockStderrWrite).toHaveBeenCalledWith(
        expect.stringContaining("NODE_ENV"),
      );
      expect(mockStderrWrite).toHaveBeenCalledWith(
        expect.stringContaining("NAME_APP"),
      );
      expect(mockStderrWrite).toHaveBeenCalledWith(
        expect.stringContaining("PATH_TO_LOGS"),
      );
    });

    it("accepts NEXT_PUBLIC_MODE as alternative to NODE_ENV", () => {
      delete process.env.NODE_ENV;
      process.env.NEXT_PUBLIC_MODE = "development";
      process.env.NAME_APP = "test-app";
      process.env.PATH_TO_LOGS = tempLogsDir;

      expect(() => {
        require("../../src/config/logger");
      }).not.toThrow();
    });

    it("exits with error for invalid NODE_ENV value", () => {
      process.env.NODE_ENV = "invalid_env";
      process.env.NAME_APP = "test-app";
      process.env.PATH_TO_LOGS = tempLogsDir;

      expect(() => {
        require("../../src/config/logger");
      }).toThrow("process.exit called");

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(mockStderrWrite).toHaveBeenCalledWith(
        expect.stringContaining("Invalid NODE_ENV value"),
      );
    });
  });

  describe("logs directory creation", () => {
    it("creates logs directory if it does not exist", () => {
      const newLogsDir = path.join(tempLogsDir, "new-logs");
      process.env.NODE_ENV = "development";
      process.env.NAME_APP = "test-app";
      process.env.PATH_TO_LOGS = newLogsDir;

      expect(fs.existsSync(newLogsDir)).toBe(false);

      require("../../src/config/logger");

      expect(fs.existsSync(newLogsDir)).toBe(true);
    });
  });

  describe("log file configuration", () => {
    beforeEach(() => {
      process.env.NAME_APP = "test-app";
      process.env.PATH_TO_LOGS = tempLogsDir;
    });

    it("uses default max size when LOG_MAX_SIZE is not set", () => {
      process.env.NODE_ENV = "production";
      delete process.env.LOG_MAX_SIZE;

      const { logger } = require("../../src/config/logger");
      const fileTransport = logger.transports.find(
        (t: { name?: string }) => t.name === "file",
      );

      // Default is 5MB = 5 * 1024 * 1024 bytes
      expect(fileTransport.maxsize).toBe(5 * 1024 * 1024);
    });

    it("uses custom max size when LOG_MAX_SIZE is set", () => {
      process.env.NODE_ENV = "production";
      process.env.LOG_MAX_SIZE = "10";

      const { logger } = require("../../src/config/logger");
      const fileTransport = logger.transports.find(
        (t: { name?: string }) => t.name === "file",
      );

      // 10MB = 10 * 1024 * 1024 bytes
      expect(fileTransport.maxsize).toBe(10 * 1024 * 1024);
    });

    it("uses default max files when LOG_MAX_FILES is not set", () => {
      process.env.NODE_ENV = "production";
      delete process.env.LOG_MAX_FILES;

      const { logger } = require("../../src/config/logger");
      const fileTransport = logger.transports.find(
        (t: { name?: string }) => t.name === "file",
      );

      expect(fileTransport.maxFiles).toBe(5);
    });

    it("uses custom max files when LOG_MAX_FILES is set", () => {
      process.env.NODE_ENV = "production";
      process.env.LOG_MAX_FILES = "10";

      const { logger } = require("../../src/config/logger");
      const fileTransport = logger.transports.find(
        (t: { name?: string }) => t.name === "file",
      );

      expect(fileTransport.maxFiles).toBe(10);
    });
  });
});
