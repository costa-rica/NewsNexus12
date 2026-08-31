import { parseCliArgs, DEFAULT_DELETE_DAYS } from "../../src/modules/cli";

describe("CLI argument parser", () => {
  describe("parseCliArgs()", () => {
    it("returns empty options when no arguments are provided", () => {
      const result = parseCliArgs([]);
      expect(result).toEqual({});
    });

    it("parses --clear_duplicate_analyses without a value", () => {
      expect(parseCliArgs(["--clear_duplicate_analyses"])).toEqual({
        clearDuplicateAnalyses: true,
      });
    });

    it("rejects a value for --clear_duplicate_analyses", () => {
      expect(() =>
        parseCliArgs(["--clear_duplicate_analyses", "ArticleDuplicateAnalyses"]),
      ).toThrow("--clear_duplicate_analyses does not take a value");
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

    it("parses --delete_articles_trim 100 with a space-separated value", () => {
      const result = parseCliArgs(["--delete_articles_trim", "100"]);
      expect(result.deleteArticlesTrimCount).toBe(100);
    });

    it("parses --delete_articles_trim=100 with an equals-separated value", () => {
      const result = parseCliArgs(["--delete_articles_trim=100"]);
      expect(result.deleteArticlesTrimCount).toBe(100);
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

    it("parses --delete_articles_no_state with no value", () => {
      const result = parseCliArgs(["--delete_articles_no_state"]);
      expect(result.deleteArticlesNoState).toBe(true);
      expect(result.deleteArticlesNoStateLimit).toBeUndefined();
      expect(result.deleteArticlesDays).toBeUndefined();
      expect(result.deleteArticlesTrimCount).toBeUndefined();
    });

    it("parses --delete_articles_no_state 100 with a space-separated value", () => {
      const result = parseCliArgs(["--delete_articles_no_state", "100"]);
      expect(result.deleteArticlesNoState).toBe(true);
      expect(result.deleteArticlesNoStateLimit).toBe(100);
      expect(result.deleteArticlesDays).toBeUndefined();
      expect(result.deleteArticlesTrimCount).toBeUndefined();
    });

    it("parses --delete_articles_no_state=100 with an equals-separated value", () => {
      const result = parseCliArgs(["--delete_articles_no_state=100"]);
      expect(result.deleteArticlesNoState).toBe(true);
      expect(result.deleteArticlesNoStateLimit).toBe(100);
      expect(result.deleteArticlesDays).toBeUndefined();
      expect(result.deleteArticlesTrimCount).toBeUndefined();
    });

    it("throws on --delete_articles_no_state 0 (non-positive)", () => {
      expect(() => parseCliArgs(["--delete_articles_no_state", "0"])).toThrow(
        "--delete_articles_no_state requires a positive integer",
      );
    });

    it("throws on --delete_articles_no_state -5 (negative)", () => {
      expect(() => parseCliArgs(["--delete_articles_no_state", "-5"])).toThrow(
        "Invalid value for --delete_articles_no_state: -5",
      );
    });

    it("throws on invalid number value for --delete_articles_no_state", () => {
      expect(() => parseCliArgs(["--delete_articles_no_state", "abc"])).toThrow(
        "Invalid value for --delete_articles_no_state: abc",
      );
    });

    it("parses --dry_run --delete_articles_no_state without combo validation", () => {
      const result = parseCliArgs(["--dry_run", "--delete_articles_no_state"]);
      expect(result.dryRun).toBe(true);
      expect(result.deleteArticlesNoState).toBe(true);
    });

    it("parses --delete_articles_retired_sources with no value", () => {
      const result = parseCliArgs(["--delete_articles_retired_sources"]);
      expect(result.deleteArticlesRetiredSources).toBe(true);
      expect(result.deleteArticlesRetiredSourcesLimit).toBeUndefined();
      expect(result.deleteArticlesDays).toBeUndefined();
      expect(result.deleteArticlesTrimCount).toBeUndefined();
      expect(result.deleteArticlesNoState).toBeUndefined();
    });

    it("parses --delete_articles_retired_sources 100 with a space-separated value", () => {
      const result = parseCliArgs(["--delete_articles_retired_sources", "100"]);
      expect(result.deleteArticlesRetiredSources).toBe(true);
      expect(result.deleteArticlesRetiredSourcesLimit).toBe(100);
      expect(result.deleteArticlesDays).toBeUndefined();
      expect(result.deleteArticlesTrimCount).toBeUndefined();
      expect(result.deleteArticlesNoState).toBeUndefined();
    });

    it("parses --delete_articles_retired_sources=100 with an equals-separated value", () => {
      const result = parseCliArgs(["--delete_articles_retired_sources=100"]);
      expect(result.deleteArticlesRetiredSources).toBe(true);
      expect(result.deleteArticlesRetiredSourcesLimit).toBe(100);
      expect(result.deleteArticlesDays).toBeUndefined();
      expect(result.deleteArticlesTrimCount).toBeUndefined();
      expect(result.deleteArticlesNoState).toBeUndefined();
    });

    it("throws on --delete_articles_retired_sources 0 (non-positive)", () => {
      expect(() =>
        parseCliArgs(["--delete_articles_retired_sources", "0"]),
      ).toThrow("--delete_articles_retired_sources requires a positive integer");
    });

    it("throws on --delete_articles_retired_sources -5 (negative)", () => {
      expect(() =>
        parseCliArgs(["--delete_articles_retired_sources", "-5"]),
      ).toThrow("Invalid value for --delete_articles_retired_sources: -5");
    });

    it("throws on invalid number value for --delete_articles_retired_sources", () => {
      expect(() =>
        parseCliArgs(["--delete_articles_retired_sources", "abc"]),
      ).toThrow("Invalid value for --delete_articles_retired_sources: abc");
    });

    it("parses --dry_run --delete_articles_retired_sources without combo validation", () => {
      const result = parseCliArgs([
        "--dry_run",
        "--delete_articles_retired_sources",
      ]);
      expect(result.dryRun).toBe(true);
      expect(result.deleteArticlesRetiredSources).toBe(true);
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

    it("parses --dry_run as a boolean flag (no value)", () => {
      const result = parseCliArgs(["--dry_run"]);
      expect(result.dryRun).toBe(true);
    });

    it("parses --drop_db as a boolean flag (no value)", () => {
      const result = parseCliArgs(["--drop_db"]);
      expect(result.dropDb).toBe(true);
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

    it("combines boolean and value flags in one invocation", () => {
      const result = parseCliArgs([
        "--create_backup",
        "--dry_run",
        "--zip_file",
        "/backup.zip",
        "--drop_db",
      ]);
      expect(result.createBackup).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.zipFilePath).toBe("/backup.zip");
      expect(result.dropDb).toBe(true);
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

    it("throws on malformed delete_articles flag with a suggestion", () => {
      expect(() => parseCliArgs(["--delete_articles90"])).toThrow(
        "Unknown argument: --delete_articles90. Did you mean --delete_articles?",
      );
    });

    it("throws on retired-sources typo with a suggestion", () => {
      expect(() => parseCliArgs(["--delete_articles_retired_source"])).toThrow(
        "Unknown argument: --delete_articles_retired_source. Did you mean --delete_articles_retired_sources?",
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
