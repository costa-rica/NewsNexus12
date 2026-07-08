export type CliOptions = {
  deleteArticlesDays?: number;
  deleteArticlesTrimCount?: number;
  deleteArticlesNoState?: boolean;
  deleteArticlesNoStateLimit?: number;
  zipFilePath?: string;
  createBackup?: boolean;
  dryRun?: boolean;
  dropDb?: boolean;
};
