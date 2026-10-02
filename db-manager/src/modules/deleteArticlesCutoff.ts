export function calculateOldArticleCutoffDate(
  daysOldThreshold: number,
  now: Date = new Date(),
): string {
  const cutoffDate = new Date(now.getTime());
  cutoffDate.setDate(cutoffDate.getDate() - daysOldThreshold);
  return cutoffDate.toISOString().slice(0, 10);
}
