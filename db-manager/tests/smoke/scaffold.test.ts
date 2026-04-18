import fs from "fs";
import path from "path";

describe("Phase 1: Package scaffolding", () => {
  const projectRoot = path.resolve(__dirname, "../..");

  describe("package.json", () => {
    it("can be read and has correct name", () => {
      const packageJsonPath = path.join(projectRoot, "package.json");
      expect(fs.existsSync(packageJsonPath)).toBe(true);

      const packageJson = JSON.parse(
        fs.readFileSync(packageJsonPath, "utf-8"),
      );
      expect(packageJson.name).toBe("@newsnexus/db-manager");
    });

    it("has correct main entry point", () => {
      const packageJsonPath = path.join(projectRoot, "package.json");
      const packageJson = JSON.parse(
        fs.readFileSync(packageJsonPath, "utf-8"),
      );
      expect(packageJson.main).toBe("dist/lib.js");
    });

    it("has required scripts", () => {
      const packageJsonPath = path.join(projectRoot, "package.json");
      const packageJson = JSON.parse(
        fs.readFileSync(packageJsonPath, "utf-8"),
      );
      expect(packageJson.scripts).toHaveProperty("build");
      expect(packageJson.scripts).toHaveProperty("start");
      expect(packageJson.scripts).toHaveProperty("test");
    });

    it("has dependency on @newsnexus/db-models", () => {
      const packageJsonPath = path.join(projectRoot, "package.json");
      const packageJson = JSON.parse(
        fs.readFileSync(packageJsonPath, "utf-8"),
      );
      expect(packageJson.dependencies).toHaveProperty("@newsnexus/db-models");
      expect(packageJson.dependencies["@newsnexus/db-models"]).toBe(
        "file:../db-models",
      );
    });
  });

  describe("tsconfig.json", () => {
    it("can be read and has strict mode enabled", () => {
      const tsconfigPath = path.join(projectRoot, "tsconfig.json");
      expect(fs.existsSync(tsconfigPath)).toBe(true);

      const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf-8"));
      expect(tsconfig.compilerOptions.strict).toBe(true);
    });

    it("has correct compiler target and module", () => {
      const tsconfigPath = path.join(projectRoot, "tsconfig.json");
      const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf-8"));
      expect(tsconfig.compilerOptions.target).toBe("ES2022");
      expect(tsconfig.compilerOptions.module).toBe("CommonJS");
    });

    it("has correct output directory", () => {
      const tsconfigPath = path.join(projectRoot, "tsconfig.json");
      const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf-8"));
      expect(tsconfig.compilerOptions.outDir).toBe("dist");
      expect(tsconfig.compilerOptions.rootDir).toBe("src");
    });
  });

  describe("src/ directory structure", () => {
    it("has config directory", () => {
      const configDir = path.join(projectRoot, "src", "config");
      expect(fs.existsSync(configDir)).toBe(true);
      expect(fs.statSync(configDir).isDirectory()).toBe(true);
    });

    it("has modules directory", () => {
      const modulesDir = path.join(projectRoot, "src", "modules");
      expect(fs.existsSync(modulesDir)).toBe(true);
      expect(fs.statSync(modulesDir).isDirectory()).toBe(true);
    });

    it("has types directory", () => {
      const typesDir = path.join(projectRoot, "src", "types");
      expect(fs.existsSync(typesDir)).toBe(true);
      expect(fs.statSync(typesDir).isDirectory()).toBe(true);
    });
  });

  describe("tests/ directory structure", () => {
    it("has smoke directory", () => {
      const smokeDir = path.join(projectRoot, "tests", "smoke");
      expect(fs.existsSync(smokeDir)).toBe(true);
      expect(fs.statSync(smokeDir).isDirectory()).toBe(true);
    });

    it("has modules directory", () => {
      const modulesDir = path.join(projectRoot, "tests", "modules");
      expect(fs.existsSync(modulesDir)).toBe(true);
      expect(fs.statSync(modulesDir).isDirectory()).toBe(true);
    });
  });
});
