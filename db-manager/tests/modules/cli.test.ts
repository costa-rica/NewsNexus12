import { parseCliArgs, DEFAULT_DELETE_DAYS } from "../../src/modules/cli";

describe("CLI argument parser", () => {
  describe("parseCliArgs()", () => {
    it("returns empty options when no arguments are provided", () => {
      const result = parseCliArgs([]);
      expect(result).toEqual({});
    });

    it("parses --delete_articles with no value and defaults to DEFAULT_DELETE_DAYS", () => {
      const result = parseCliArgs(["--delete_articles"]);
      expect(result.deleteArticlesDays).toBe(DEFAULT_DELETE_DAYS);
      expect(result.deleteArticlesDays).toBe(180);
    });

    it("parses --delete_articles 90 with a space-separated value", () => {
      const result = parseCliArgs(["--delete_articles", "90"]);
      expect(result.deleteArticlesDays).toBe(90);
    });

    it("parses --delete_articles=90 with an equals-separated value", () => {
      const result = parseCliArgs(["--delete_articles=90"]);
      expect(result.deleteArticlesDays).toBe(90);
    });

    it("parses --delete_articles_trim 5 with a space-separated value", () => {
      const result = parseCliArgs(["--delete_articles_trim", "5"]);
      expect(result.deleteArticlesTrimCount).toBe(5);
    });

    it("parses --delete_articles_trim=5 with an equals-separated value", () => {
      const result = parseCliArgs(["--delete_articles_trim=5"]);
      expect(result.deleteArticlesTrimCount).toBe(5);
    });

    it("throws on --delete_articles_trim with no value", () => {
      expect(() => parseCliArgs(["--delete_articles_trim"])).toThrow(
        "--delete_articles_trim requires a count value",
      );
    });

    it("throws on --delete_articles_trim 0 (non-positive)", () => {
      expect(() => parseCliArgs(["--delete_articles_trim", "0"])).toThrow(
        "--delete_articles_trim requires a positive integer",
      );
    });

    it("throws on --delete_articles_trim -5 (negative)", () => {
      expect(() => parseCliArgs(["--delete_articles_trim", "-5"])).toThrow(
        "--delete_articles_trim requires a positive integer",
      );
    });

    it("parses --zip_file /path/to/file.zip with a space-separated value", () => {
      const result = parseCliArgs(["--zip_file", "/path/to/file.zip"]);
      expect(result.zipFilePath).toBe("/path/to/file.zip");
    });

    it("parses --zip_file=/path/to/file.zip with an equals-separated value", () => {
      const result = parseCliArgs(["--zip_file=/path/to/file.zip"]);
      expect(result.zipFilePath).toBe("/path/to/file.zip");
    });

    it("throws on --zip_file with no value", () => {
      expect(() => parseCliArgs(["--zip_file"])).toThrow(
        "--zip_file requires a full path argument",
      );
    });

    it("parses --create_backup as a boolean flag (no value)", () => {
      const result = parseCliArgs(["--create_backup"]);
      expect(result.createBackup).toBe(true);
    });

    it("throws on --create_backup somevalue (does not accept a value)", () => {
      expect(() =>
        parseCliArgs(["--create_backup", "somevalue"]),
      ).toThrow("--create_backup does not take a value");
    });

    it("throws on --create_backup=true (does not accept a value)", () => {
      expect(() => parseCliArgs(["--create_backup=true"])).toThrow(
        "--create_backup does not take a value",
      );
    });

    it("combines multiple flags in one invocation", () => {
      const result = parseCliArgs([
        "--create_backup",
        "--delete_articles",
        "30",
      ]);
      expect(result.createBackup).toBe(true);
      expect(result.deleteArticlesDays).toBe(30);
    });

    it("combines all flags in one invocation", () => {
      const result = parseCliArgs([
        "--create_backup",
        "--delete_articles",
        "45",
        "--delete_articles_trim",
        "10",
        "--zip_file",
        "/backup.zip",
      ]);
      expect(result.createBackup).toBe(true);
      expect(result.deleteArticlesDays).toBe(45);
      expect(result.deleteArticlesTrimCount).toBe(10);
      expect(result.zipFilePath).toBe("/backup.zip");
    });

    it("throws on unknown argument with a suggestion (--delet_articles)", () => {
      expect(() => parseCliArgs(["--delet_articles"])).toThrow(
        "Unknown argument: --delet_articles. Did you mean --delete_articles?",
      );
    });

    it("throws on unknown argument with a suggestion (--delete_articl)", () => {
      expect(() => parseCliArgs(["--delete_articl"])).toThrow(
        "Unknown argument: --delete_articl. Did you mean --delete_articles?",
      );
    });

    it("throws on unknown argument without a suggestion (--foobar_xyz)", () => {
      expect(() => parseCliArgs(["--foobar_xyz"])).toThrow(
        "Unknown argument: --foobar_xyz",
      );
    });

    it("throws on arguments that do not start with --", () => {
      expect(() => parseCliArgs(["delete_articles"])).toThrow(
        "Unexpected argument: delete_articles",
      );
    });

    it("throws on arguments that do not start with -- (single dash)", () => {
      expect(() => parseCliArgs(["-delete_articles"])).toThrow(
        "Unexpected argument: -delete_articles",
      );
    });

    it("throws on invalid number value for --delete_articles", () => {
      expect(() => parseCliArgs(["--delete_articles", "abc"])).toThrow(
        "Invalid value for --delete_articles: abc",
      );
    });

    it("throws on invalid number value for --delete_articles_trim", () => {
      expect(() => parseCliArgs(["--delete_articles_trim", "xyz"])).toThrow(
        "Invalid value for --delete_articles_trim: xyz",
      );
    });
  });

  describe("DEFAULT_DELETE_DAYS constant", () => {
    it("is set to 180", () => {
      expect(DEFAULT_DELETE_DAYS).toBe(180);
    });
  });
});
