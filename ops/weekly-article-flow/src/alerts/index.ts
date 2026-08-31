export interface WeeklyFlowAlert {
  runId: number;
  status: string;
  message: string;
  occurredAt: string;
}

export const formatWeeklyFlowAlert = (alert: WeeklyFlowAlert): string => [
  '# NewsNexus12 weekly flow alert',
  '',
  `- run ID: ${alert.runId}`,
  `- status: ${alert.status}`,
  `- occurred at: ${alert.occurredAt}`,
  `- message: ${alert.message}`,
  ''
].join('\n');
