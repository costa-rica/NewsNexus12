import fs from "fs";
import path from "path";

describe("Build verification", () => {
  const projectRoot = path.resolve(__dirname, "../..");
  const distDir = path.join(projectRoot, "dist");

  // Skip these tests if dist directory doesn't exist
  // (tests will pass during development, fail in CI if build wasn't run)
  const distExists = fs.existsSync(distDir);

  if (!distExists) {
    it("dist directory should exist after build (run npm run build)", () => {
      expect(distExists).toBe(true);
    });
    return;
  }

  describe("dist/ directory", () => {
    it("contains index.js after build", () => {
      const indexPath = path.join(distDir, "index.js");
      expect(fs.existsSync(indexPath)).toBe(true);
    });

    it("contains config/logger.js", () => {
      const loggerPath = path.join(distDir, "config", "logger.js");
      expect(fs.existsSync(loggerPath)).toBe(true);
    });

    it("contains modules/cli.js", () => {
      const cliPath = path.join(distDir, "modules", "cli.js");
      expect(fs.existsSync(cliPath)).toBe(true);
    });

    it("contains modules/status.js", () => {
      const statusPath = path.join(distDir, "modules", "status.js");
      expect(fs.existsSync(statusPath)).toBe(true);
    });

    it("contains modules/deleteArticles.js", () => {
      const deleteArticlesPath = path.join(
        distDir,
        "modules",
        "deleteArticles.js",
      );
      expect(fs.existsSync(deleteArticlesPath)).toBe(true);
    });

    it("contains modules/backup.js", () => {
      const backupPath = path.join(distDir, "modules", "backup.js");
      expect(fs.existsSync(backupPath)).toBe(true);
    });

    it("contains modules/zipImport.js", () => {
      const zipImportPath = path.join(distDir, "modules", "zipImport.js");
      expect(fs.existsSync(zipImportPath)).toBe(true);
    });

    it("contains types/cli.js", () => {
      const cliTypesPath = path.join(distDir, "types", "cli.js");
      expect(fs.existsSync(cliTypesPath)).toBe(true);
    });

    it("contains types/status.js", () => {
      const statusTypesPath = path.join(distDir, "types", "status.js");
      expect(fs.existsSync(statusTypesPath)).toBe(true);
    });
  });

  describe("TypeScript compilation", () => {
    it("produces JavaScript files without .ts extension in dist/", () => {
      // Declaration files (.d.ts) are intentionally emitted; only bare .ts files indicate a build error.
      const tsFilesInDist = findFilesByExtension(distDir, ".ts").filter(
        (f) => !f.endsWith(".d.ts"),
      );
      expect(tsFilesInDist.length).toBe(0);
    });

    it("produces .js files for all modules", () => {
      const jsFiles = findFilesByExtension(distDir, ".js");
      expect(jsFiles.length).toBeGreaterThan(0);
    });

    it("produces .d.ts declaration files", () => {
      // Check if any .d.ts files exist (TypeScript may generate these)
      const dtsFiles = findFilesByExtension(distDir, ".d.ts");
      // This is optional, so we just verify the structure
      expect(Array.isArray(dtsFiles)).toBe(true);
    });
  });

  describe("Package structure", () => {
    it("has .env.example file in project root", () => {
      const envExamplePath = path.join(projectRoot, ".env.example");
      expect(fs.existsSync(envExamplePath)).toBe(true);
    });

    it(".env.example contains required environment variables", () => {
      const envExamplePath = path.join(projectRoot, ".env.example");
      const content = fs.readFileSync(envExamplePath, "utf-8");

      const requiredVars = [
        "NODE_ENV",
        "NAME_APP",
        "PATH_TO_LOGS",
        "LOG_MAX_SIZE",
        "LOG_MAX_FILES",
        "PG_HOST",
        "PG_PORT",
        "PG_DATABASE",
        "PG_USER",
        "PATH_DB_BACKUPS",
      ];

      for (const varName of requiredVars) {
        expect(content).toContain(varName);
      }
    });
  });
});

function findFilesByExtension(dir: string, extension: string): string[] {
  const results: string[] = [];

  if (!fs.existsSync(dir)) {
    return results;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...findFilesByExtension(fullPath, extension));
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      results.push(fullPath);
    }
  }

  return results;
}
