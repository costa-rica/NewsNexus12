import path from 'node:path';
import fs from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { sequelize } from '@newsnexus/db-models';
import logger from '../logger';
import type { OrchestratorRunRow, OrchestratorRunStepRow } from './types';

interface ArticleReportRow {
  articleId: number;
  title: string | null;
  scrapeStatus: string | null;
  aiAssignedState: string | null;
  aiApproverScore: number | null;
  semanticRating: number | null;
}

const formatDuration = (startedAt: Date | null, endedAt: Date | null): string => {
  if (!startedAt || !endedAt) return '';
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
};

const getArticleRows = async (
  minExclusive: number,
  maxInclusive: number
): Promise<ArticleReportRow[]> => {
  const [rows] = await sequelize.query(
    `
    SELECT
      a.id AS "articleId",
      a.title,
      ac.status AS "scrapeStatus",
      s.name AS "aiAssignedState",
      aas.score AS "aiApproverScore",
      ak.max_score AS "semanticRating"
    FROM "Articles" AS a
    LEFT JOIN LATERAL (
      SELECT status FROM "ArticleContents02" WHERE "articleId" = a.id ORDER BY id DESC LIMIT 1
    ) ac ON true
    LEFT JOIN LATERAL (
      SELECT st.name FROM "ArticleStateContracts02" asc2
      JOIN "States" st ON st.id = asc2."stateId"
      WHERE asc2."articleId" = a.id
      ORDER BY asc2.id DESC LIMIT 1
    ) s ON true
    LEFT JOIN LATERAL (
      SELECT score FROM "AiApproverArticleScores" WHERE "articleId" = a.id ORDER BY id DESC LIMIT 1
    ) aas ON true
    LEFT JOIN LATERAL (
      SELECT MAX(score) AS max_score FROM "ArticleKeywordContracts" WHERE "articleId" = a.id
    ) ak ON true
    WHERE a.id > :minExclusive AND a.id <= :maxInclusive
    ORDER BY a.id ASC
    `,
    { replacements: { minExclusive, maxInclusive }, raw: true }
  ) as [ArticleReportRow[], unknown];

  return rows;
};

const getOutputPath = (startedAt: Date): string => {
  const utilitiesPath = process.env.PATH_UTILTIES ?? '/tmp';
  const timestamp = startedAt
    .toISOString()
    .replace('T', '-')
    .replace(/:/g, '')
    .replace(/\.\d+Z$/, '');
  return path.join(utilitiesPath, 'orchestrator', 'reports', `${timestamp}-orchestration-report.xlsx`);
};

export const writeReport = async (
  run: OrchestratorRunRow,
  steps: OrchestratorRunStepRow[]
): Promise<string | null> => {
  const outputPath = getOutputPath(run.startedAt);
  const tmpPath = `${outputPath}.tmp`;
  const outputDir = path.dirname(outputPath);

  try {
    await fs.mkdir(outputDir, { recursive: true });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'NewsNexus Orchestrator';
    workbook.created = new Date();

    const jobsSheet = workbook.addWorksheet('Jobs');
    jobsSheet.columns = [
      { header: 'Job Name', key: 'jobName', width: 20 },
      { header: 'Start Time', key: 'startTime', width: 22 },
      { header: 'End Time', key: 'endTime', width: 22 },
      { header: 'Duration', key: 'duration', width: 12 },
      { header: 'Status', key: 'status', width: 30 },
      { header: 'Reason for Ending', key: 'reasonForEnding', width: 50 },
    ];

    for (const step of steps) {
      if (step.stepName === 'report') continue;
      const reasonForEnding =
        step.stepName === 'google_rss' && step.result?.endingMessage
          ? String(step.result.endingMessage)
          : (step.endingMessage ?? step.endingReason ?? '');

      jobsSheet.addRow({
        jobName: step.stepName,
        startTime: step.startedAt ? new Date(step.startedAt).toISOString() : '',
        endTime: step.endedAt ? new Date(step.endedAt).toISOString() : '',
        duration: formatDuration(step.startedAt, step.endedAt),
        status: step.status,
        reasonForEnding,
      });
    }

    if (run.articleIdMinExclusive !== null && run.articleIdMaxInclusive !== null) {
      const articlesSheet = workbook.addWorksheet('Articles');
      articlesSheet.columns = [
        { header: 'Article ID', key: 'articleId', width: 12 },
        { header: 'Title', key: 'title', width: 60 },
        { header: 'Scrape Status', key: 'scrapeStatus', width: 18 },
        { header: 'AI Assigned State', key: 'aiAssignedState', width: 22 },
        { header: 'AI Approver Score', key: 'aiApproverScore', width: 18 },
        { header: 'Semantic Rating', key: 'semanticRating', width: 16 },
      ];

      const articleRows = await getArticleRows(
        run.articleIdMinExclusive,
        run.articleIdMaxInclusive
      );

      for (const row of articleRows) {
        articlesSheet.addRow(row);
      }
    }

    await workbook.xlsx.writeFile(tmpPath);
    await fs.rename(tmpPath, outputPath);

    logger.info('reportWriter: report written', { runId: run.id, outputPath });
    return outputPath;
  } catch (err) {
    logger.error('reportWriter: failed to write report', {
      runId: run.id,
      error: err instanceof Error ? err.message : String(err),
    });
    try {
      await fs.unlink(tmpPath).catch(() => undefined);
    } catch {
      // ignore
    }
    return null;
  }
};
