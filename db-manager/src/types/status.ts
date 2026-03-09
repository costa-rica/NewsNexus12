export type DatabaseStatus = {
  totalArticles: number;
  irrelevantArticles: number;
  approvedArticles: number;
  oldArticles: number;
  deletableOldArticles: number;
  cutoffDate: string;
};
