import { CliOptions } from "../types/cli";

export const DEFAULT_DELETE_DAYS = 180;
const KNOWN_FLAGS = [
  "--delete_articles",
  "--delete_articles_trim",
  "--zip_file",
  "--create_backup",
];

function parseNumber(value: string, flagName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    throw new Error(`Invalid value for ${flagName}: ${value}`);
  }
  return parsed;
}

function levenshtein(a: string, b: string): number {
  const matrix: number[][] = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0),
  );

  for (let i = 0; i <= a.length; i += 1) {
    matrix[i][0] = i;
  }

  for (let j = 0; j <= b.length; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}

function suggestFlag(input: string): string | null {
  let bestMatch: string | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const flag of KNOWN_FLAGS) {
    const score = levenshtein(input, flag);
    if (score < bestScore) {
      bestScore = score;
      bestMatch = flag;
    }
  }

  return bestScore <= 4 ? bestMatch : null;
}

export function parseCliArgs(args: string[]): CliOptions {
  const options: CliOptions = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    if (arg.startsWith("--delete_articles_trim")) {
      let value: string | undefined;

      if (arg.includes("=")) {
        value = arg.split("=")[1];
      } else if (args[i + 1] && !args[i + 1].startsWith("--")) {
        value = args[i + 1];
        i += 1;
      }

      if (!value) {
        throw new Error("--delete_articles_trim requires a count value");
      }

      const count = parseNumber(value, "--delete_articles_trim");
      if (count <= 0) {
        throw new Error("--delete_articles_trim requires a positive integer");
      }

      options.deleteArticlesTrimCount = count;
      continue;
    }

    if (arg.startsWith("--delete_articles")) {
      let value: string | undefined;

      if (arg.includes("=")) {
        value = arg.split("=")[1];
      } else if (args[i + 1] && !args[i + 1].startsWith("--")) {
        value = args[i + 1];
        i += 1;
      }

      if (!value) {
        options.deleteArticlesDays = DEFAULT_DELETE_DAYS;
      } else {
        options.deleteArticlesDays = parseNumber(value, "--delete_articles");
      }

      continue;
    }

    if (arg.startsWith("--zip_file")) {
      let value: string | undefined;

      if (arg.includes("=")) {
        value = arg.split("=")[1];
      } else if (args[i + 1] && !args[i + 1].startsWith("--")) {
        value = args[i + 1];
        i += 1;
      }

      if (!value) {
        throw new Error("--zip_file requires a full path argument");
      }

      options.zipFilePath = value;
      continue;
    }

    if (arg.startsWith("--create_backup")) {
      if (arg.includes("=") || (args[i + 1] && !args[i + 1].startsWith("--"))) {
        throw new Error("--create_backup does not take a value");
      }

      options.createBackup = true;
      continue;
    }

    const suggestion = suggestFlag(arg);
    if (suggestion) {
      throw new Error(`Unknown argument: ${arg}. Did you mean ${suggestion}?`);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}
