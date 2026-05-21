import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import logger from '../../../src/modules/logger';
import { writeReport } from '../../../src/modules/orchestrator/reportWriter';
import type {
  OrchestratorRunRow,
  OrchestratorRunStepRow
} from '../../../src/modules/orchestrator/types';

const mockSequelizeQuery = jest.fn();

jest.mock('@newsnexus/db-models', () => ({
  sequelize: {
    query: (...args: unknown[]) => mockSequelizeQuery(...args),
  },
}));

const startedAt = new Date('2026-05-19T12:00:00.000Z');

const makeRun = (): OrchestratorRunRow => ({
  id: 101,
  status: 'completed',
  startedAt,
  endedAt: new Date('2026-05-19T12:05:00.000Z'),
  articleIdMinExclusive: 0,
  articleIdMaxInclusive: 0,
  reportFilePath: null,
  failureReason: null,
  aiApproverEnabled: true,
  semanticScorerEnabled: true,
  userId: null,
});

const makeStep = (
  overrides: Partial<OrchestratorRunStepRow> = {}
): OrchestratorRunStepRow => ({
  id: overrides.id ?? 1,
  orchestratorRunId: overrides.orchestratorRunId ?? 101,
  stepName: overrides.stepName ?? 'google_rss',
  stepOrder: overrides.stepOrder ?? 2,
  enabled: overrides.enabled ?? true,
  status: overrides.status ?? 'completed',
  childJobId: overrides.childJobId ?? null,
  startedAt: overrides.startedAt ?? startedAt,
  endedAt: overrides.endedAt ?? new Date('2026-05-19T12:01:00.000Z'),
  result: overrides.result ?? null,
  endingReason: overrides.endingReason ?? null,
  endingMessage: overrides.endingMessage ?? null,
});

const readWorkbook = async (filePath: string): Promise<ExcelJS.Workbook> => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return workbook;
};

const getHeaderValues = (sheet: ExcelJS.Worksheet): string[] => {
  const headerRow = sheet.getRow(1);
  return Array.from({ length: sheet.columnCount }, (_, index) =>
    String(headerRow.getCell(index + 1).value ?? '')
  );
};

const makeArticleRun = (): OrchestratorRunRow => ({
  ...makeRun(),
  articleIdMinExclusive: 0,
  articleIdMaxInclusive: 100,
});

const makeArticleStep = (): OrchestratorRunStepRow =>
  makeStep({
    stepName: 'state_assigner',
    stepOrder: 3,
    result: null,
  });

describe('reportWriter google rss query sheet', () => {
  let tempDir: string;
  let originalUtilitiesPath: string | undefined;

  beforeEach(async () => {
    mockSequelizeQuery.mockResolvedValue([[], null]);
    originalUtilitiesPath = process.env.PATH_UTILTIES;
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'report-writer-'));
    process.env.PATH_UTILTIES = tempDir;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    mockSequelizeQuery.mockReset();
    if (originalUtilitiesPath === undefined) {
      delete process.env.PATH_UTILTIES;
    } else {
      process.env.PATH_UTILTIES = originalUtilitiesPath;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('adds Google RSS Queries between Jobs and Articles', async () => {
    const reportPath = await writeReport(makeRun(), [
      makeStep({
        result: {
          endingMessage: 'All queries processed successfully.',
          queryResults: [
            {
              id: 1,
              and_keywords: 'cpsc',
              and_exact_phrases: '',
              or_keywords: '',
              or_exact_phrases: '',
              time_range: '30d',
              status: 'success',
              saved_articles: 3,
              note: null,
            },
            {
              id: 2,
              and_keywords: '',
              and_exact_phrases: '',
              or_keywords: '',
              or_exact_phrases: '',
              time_range: '180d',
              status: 'skipped',
              saved_articles: 0,
              note: 'empty_query',
            },
          ],
        },
      }),
    ]);

    expect(reportPath).not.toBeNull();
    const workbook = await readWorkbook(reportPath!);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Jobs',
      'Google RSS Queries',
      'Articles',
    ]);

    const sheet = workbook.getWorksheet('Google RSS Queries');
    expect(sheet).toBeDefined();
    expect(getHeaderValues(sheet!)).toEqual([
      'id',
      'and_keywords',
      'and_exact_phrases',
      'or_keywords',
      'or_exact_phrases',
      'time_range',
      'status',
      'saved_articles',
      'note',
    ]);
    expect(sheet!.rowCount).toBe(3);
    expect(sheet!.getRow(2).getCell(1).value).toBe(1);
    expect(sheet!.getRow(3).getCell(9).value).toBe('empty_query');
  });

  it('skips the sheet when queryResults is missing', async () => {
    const reportPath = await writeReport(makeRun(), [
      makeStep({
        result: {},
      }),
    ]);

    expect(reportPath).not.toBeNull();
    const workbook = await readWorkbook(reportPath!);
    expect(workbook.getWorksheet('Google RSS Queries')).toBeUndefined();
  });

  it('skips malformed queryResults and logs a warning', async () => {
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => logger);

    const reportPath = await writeReport(makeRun(), [
      makeStep({
        result: {
          queryResults: 'not an array',
        },
      }),
    ]);

    expect(reportPath).not.toBeNull();
    const workbook = await readWorkbook(reportPath!);
    expect(workbook.getWorksheet('Google RSS Queries')).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      'reportWriter: invalid google_rss queryResults shape',
      { reason: 'not_array' }
    );
  });

  it('skips the sheet when no google_rss step exists', async () => {
    const reportPath = await writeReport(makeRun(), [
      makeStep({
        stepName: 'state_assigner',
        stepOrder: 3,
        result: null,
      }),
    ]);

    expect(reportPath).not.toBeNull();
    const workbook = await readWorkbook(reportPath!);
    expect(workbook.getWorksheet('Google RSS Queries')).toBeUndefined();
  });
});

describe('reportWriter articles sheet state column', () => {
  let tempDir: string;
  let originalUtilitiesPath: string | undefined;

  beforeEach(async () => {
    mockSequelizeQuery.mockResolvedValue([[], null]);
    originalUtilitiesPath = process.env.PATH_UTILTIES;
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'report-writer-'));
    process.env.PATH_UTILTIES = tempDir;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    mockSequelizeQuery.mockReset();
    if (originalUtilitiesPath === undefined) {
      delete process.env.PATH_UTILTIES;
    } else {
      process.env.PATH_UTILTIES = originalUtilitiesPath;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('renders the state name when the latest assignment has a non-null stateId', async () => {
    mockSequelizeQuery.mockResolvedValueOnce([
      [
        {
          articleId: 1,
          title: 't',
          scrapeStatus: 'completed',
          aiAssignedState: 'California',
          aiApproverScore: null,
          aiGatekeeperDecision: null,
          aiGatekeeperConfidence: null,
          aiGatekeeperReasonCode: null,
          semanticRating: null,
        },
      ],
      null,
    ]);

    const reportPath = await writeReport(makeArticleRun(), [makeArticleStep()]);

    expect(reportPath).not.toBeNull();
    const workbook = await readWorkbook(reportPath!);
    const sheet = workbook.getWorksheet('Articles');
    expect(sheet).toBeDefined();
    expect(sheet!.getRow(2).getCell(4).value).toBe('California');
  });

  it('renders "No state" when the latest assignment has stateId = NULL', async () => {
    mockSequelizeQuery.mockResolvedValueOnce([
      [
        {
          articleId: 1,
          title: 't',
          scrapeStatus: 'completed',
          aiAssignedState: 'No state',
          aiApproverScore: null,
          aiGatekeeperDecision: null,
          aiGatekeeperConfidence: null,
          aiGatekeeperReasonCode: null,
          semanticRating: null,
        },
      ],
      null,
    ]);

    const reportPath = await writeReport(makeArticleRun(), [makeArticleStep()]);

    expect(reportPath).not.toBeNull();
    const workbook = await readWorkbook(reportPath!);
    const sheet = workbook.getWorksheet('Articles');
    expect(sheet).toBeDefined();
    expect(sheet!.getRow(2).getCell(4).value).toBe('No state');
  });

  it('leaves the AI Assigned State cell empty when no assignment row exists', async () => {
    mockSequelizeQuery.mockResolvedValueOnce([
      [
        {
          articleId: 1,
          title: 't',
          scrapeStatus: 'completed',
          aiAssignedState: null,
          aiApproverScore: null,
          aiGatekeeperDecision: null,
          aiGatekeeperConfidence: null,
          aiGatekeeperReasonCode: null,
          semanticRating: null,
        },
      ],
      null,
    ]);

    const reportPath = await writeReport(makeArticleRun(), [makeArticleStep()]);

    expect(reportPath).not.toBeNull();
    const workbook = await readWorkbook(reportPath!);
    const sheet = workbook.getWorksheet('Articles');
    expect(sheet).toBeDefined();
    expect(sheet!.getRow(2).getCell(4).value == null).toBe(true);
  });

  it('emits a null-state-preserving lateral subquery for the article state', async () => {
    mockSequelizeQuery.mockResolvedValueOnce([
      [
        {
          articleId: 1,
          title: 't',
          scrapeStatus: 'completed',
          aiAssignedState: 'California',
          aiApproverScore: null,
          aiGatekeeperDecision: null,
          aiGatekeeperConfidence: null,
          aiGatekeeperReasonCode: null,
          semanticRating: null,
        },
      ],
      null,
    ]);

    const reportPath = await writeReport(makeArticleRun(), [makeArticleStep()]);

    expect(reportPath).not.toBeNull();
    const articleCall = mockSequelizeQuery.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('"ArticleStateContracts02"')
    );
    expect(articleCall).toBeDefined();
    const sql = articleCall![0] as string;
    expect(sql).toContain('LEFT JOIN LATERAL');
    expect(sql).toContain('LEFT JOIN "States"');
    expect(sql).toContain('asc2."stateId" IS NULL');
    expect(sql).toContain("'No state'");
    expect(sql).not.toMatch(/(?<!LEFT\s)JOIN\s+"States"/i);
  });
});
