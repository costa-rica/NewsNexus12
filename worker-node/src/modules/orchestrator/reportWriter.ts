import path from 'node:path';
import fs from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { sequelize } from '@newsnexus/db-models';
import logger from '../logger';
import type { OrchestratorRunRow, OrchestratorRunStepRow } from './types';
import type { GoogleRssQueryResult } from '../jobs/requestGoogleRssJob';

interface ArticleReportRow {
  articleId: number;
  title: string | null;
  scrapeStatus: string | null;
  aiAssignedState: string | null;
  aiApproverScore: number | null;
  aiGatekeeperDecision: string | null;
  aiGatekeeperConfidence: number | null;
  aiGatekeeperReasonCode: string | null;
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
      gk.decision AS "aiGatekeeperDecision",
      gk.confidence AS "aiGatekeeperConfidence",
      gk."reasonCode" AS "aiGatekeeperReasonCode",
      (
        SELECT MAX(aecc."keywordRating")
        FROM "ArticleEntityWhoCategorizedArticleContracts" AS aecc
        WHERE aecc."articleId" = a.id
      ) AS "semanticRating"
    FROM "Articles" AS a
    LEFT JOIN LATERAL (
      SELECT status FROM "ArticleContents02" WHERE "articleId" = a.id ORDER BY id DESC LIMIT 1
    ) ac ON true
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN asc2."stateId" IS NULL THEN 'No state'
          ELSE st.name
        END AS name
      FROM "ArticleStateContracts02" asc2
      LEFT JOIN "States" st ON st.id = asc2."stateId"
      WHERE asc2."articleId" = a.id
      ORDER BY asc2.id DESC LIMIT 1
    ) s ON true
    LEFT JOIN LATERAL (
      SELECT aas.score
      FROM "AiApproverArticleScores" aas
      LEFT JOIN "AiApproverPromptVersions" apv ON apv.id = aas."promptVersionId"
      WHERE aas."articleId" = a.id
        AND COALESCE(aas."promptRole", apv."promptRole", 'category_score') IN ('category_score', 'legacy_category_score')
        AND aas."resultStatus" = 'completed'
        AND aas.score IS NOT NULL
      ORDER BY aas.score DESC, aas.id ASC
      LIMIT 1
    ) aas ON true
    LEFT JOIN LATERAL (
      SELECT aas.decision, aas.confidence, aas."reasonCode"
      FROM "AiApproverArticleScores" aas
      LEFT JOIN "AiApproverPromptVersions" apv ON apv.id = aas."promptVersionId"
      WHERE aas."articleId" = a.id
        AND COALESCE(aas."promptRole", apv."promptRole", 'category_score') = 'gatekeeper'
      ORDER BY aas.id DESC
      LIMIT 1
    ) gk ON true
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

const isGoogleRssQueryResult = (value: unknown): value is GoogleRssQueryResult => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const row = value as { id?: unknown; status?: unknown };
  return typeof row.id === 'number' && typeof row.status === 'string';
};

const getGoogleRssQueryResults = (value: unknown): GoogleRssQueryResult[] | null => {
  if (value === undefined || value === null) {
    return null;
  }

  if (!Array.isArray(value)) {
    logger.warn('reportWriter: invalid google_rss queryResults shape', {
      reason: 'not_array',
    });
    return null;
  }

  if (value.length === 0) {
    return null;
  }

  if (!value.every(isGoogleRssQueryResult)) {
    logger.warn('reportWriter: invalid google_rss queryResults shape', {
      reason: 'invalid_row',
    });
    return null;
  }

  return value;
};

export const writeReport = async (
  run: OrchestratorRunRow,
  steps: OrchestratorRunStepRow[],
  options: { includeArticles?: boolean } = {}
): Promise<string | null> => {
  const includeArticles = options.includeArticles ?? true;
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

    const googleRssStep = steps.find((step) => step.stepName === 'google_rss');
    const googleRssQueryResults = getGoogleRssQueryResults(googleRssStep?.result?.queryResults);
    if (googleRssQueryResults) {
      const googleRssQueriesSheet = workbook.addWorksheet('Google RSS Queries');
      googleRssQueriesSheet.columns = [
        { header: 'id', key: 'id', width: 8 },
        { header: 'and_keywords', key: 'and_keywords', width: 30 },
        { header: 'and_exact_phrases', key: 'and_exact_phrases', width: 30 },
        { header: 'or_keywords', key: 'or_keywords', width: 30 },
        { header: 'or_exact_phrases', key: 'or_exact_phrases', width: 30 },
        { header: 'time_range', key: 'time_range', width: 12 },
        { header: 'status', key: 'status', width: 12 },
        { header: 'saved_articles', key: 'saved_articles', width: 16 },
        { header: 'note', key: 'note', width: 30 },
      ];

      for (const row of googleRssQueryResults) {
        googleRssQueriesSheet.addRow(row);
      }
    }

    if (includeArticles && run.articleIdMinExclusive !== null && run.articleIdMaxInclusive !== null) {
      const articlesSheet = workbook.addWorksheet('Articles');
      articlesSheet.columns = [
        { header: 'Article ID', key: 'articleId', width: 12 },
        { header: 'Title', key: 'title', width: 60 },
        { header: 'Scrape Status', key: 'scrapeStatus', width: 18 },
        { header: 'AI Assigned State', key: 'aiAssignedState', width: 22 },
        { header: 'AI Approver Score', key: 'aiApproverScore', width: 18 },
        { header: 'AI Gatekeeper Decision', key: 'aiGatekeeperDecision', width: 24 },
        { header: 'AI Gatekeeper Confidence', key: 'aiGatekeeperConfidence', width: 24 },
        { header: 'AI Gatekeeper Reason Code', key: 'aiGatekeeperReasonCode', width: 28 },
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
