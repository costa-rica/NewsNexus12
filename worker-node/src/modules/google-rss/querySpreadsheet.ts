import ExcelJS from 'exceljs';

export interface GoogleRssQueryRow {
  id: number;
  and_keywords: string;
  and_exact_phrases: string;
  or_keywords: string;
  or_exact_phrases: string;
  time_range: string;
}

export interface GoogleRssQueryBuildResult {
  query: string;
  andString: string | null;
  orString: string | null;
  timeRange: string;
  timeRangeInvalid: boolean;
}

export interface ExpectedGoogleRssQueryRow {
  rowIndex: number;
  row: GoogleRssQueryRow;
  query: string;
  requestUrl: string | null;
  andString: string | null;
  orString: string | null;
  timeRange: string;
  timeRangeInvalid: boolean;
}

const REQUIRED_HEADERS = [
  'id',
  'and_keywords',
  'and_exact_phrases',
  'or_keywords',
  'or_exact_phrases',
  'time_range',
] as const;

export const getDefaultLimitDays = (): number => {
  const raw = process.env.LIMIT_ARTICLE_AGE_IN_DAYS;
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `LIMIT_ARTICLE_AGE_IN_DAYS is required and must be a positive integer (got: "${raw ?? ''}"). This should have been caught at startup.`
    );
  }
  return parsed;
};

export const getDefaultTimeRange = (): string => `${getDefaultLimitDays()}d`;

export const parseTimeRangeDays = (timeRange: string): number | null => {
  const match = /^(\d+)d$/.exec(timeRange);
  if (!match) {
    return null;
  }
  const days = Number.parseInt(match[1], 10);
  return Number.isFinite(days) && days > 0 ? days : null;
};

const toCellString = (value: ExcelJS.CellValue | null | undefined): string => {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object' && 'text' in value) {
    return String(value.text).trim();
  }
  return String(value).trim();
};

export const splitGoogleRssCsv = (value?: string): string[] => {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
};

export const normalizeGoogleRssTerm = (term: string): string => {
  const trimmed = term.trim();
  if (!trimmed) {
    return '';
  }
  const hasQuotes =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"));
  if (hasQuotes) {
    return trimmed;
  }
  if (trimmed.includes(' ')) {
    return `"${trimmed}"`;
  }
  return trimmed;
};

export const normalizeGoogleRssTimeRange = (
  value?: string
): { timeRange: string; timeRangeInvalid: boolean } => {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    return { timeRange: getDefaultTimeRange(), timeRangeInvalid: false };
  }
  if (!/^\d+d$/.test(trimmed)) {
    return { timeRange: getDefaultTimeRange(), timeRangeInvalid: true };
  }
  const days = Number.parseInt(trimmed.slice(0, -1), 10);
  if (!Number.isFinite(days) || days <= 0) {
    return { timeRange: getDefaultTimeRange(), timeRangeInvalid: true };
  }
  return { timeRange: trimmed, timeRangeInvalid: false };
};

export const combineGoogleRssTermsForDb = (
  keywords?: string,
  exactPhrases?: string
): string | null => {
  const parts = [...splitGoogleRssCsv(keywords), ...splitGoogleRssCsv(exactPhrases)];
  if (parts.length === 0) {
    return null;
  }
  return parts.join(', ');
};

export const buildGoogleRssQuery = (row: GoogleRssQueryRow): GoogleRssQueryBuildResult => {
  const andKeywords = splitGoogleRssCsv(row.and_keywords);
  const andExact = splitGoogleRssCsv(row.and_exact_phrases);
  const orKeywords = splitGoogleRssCsv(row.or_keywords);
  const orExact = splitGoogleRssCsv(row.or_exact_phrases);

  const andTerms = [...andKeywords, ...andExact].map(normalizeGoogleRssTerm).filter(Boolean);
  const orTerms = [...orKeywords, ...orExact].map(normalizeGoogleRssTerm).filter(Boolean);

  const queryParts: string[] = [];
  if (andTerms.length > 0) {
    queryParts.push(andTerms.join(' '));
  }
  if (orTerms.length > 0) {
    const orExpression = orTerms.join(' OR ');
    queryParts.push(andTerms.length > 0 && orTerms.length > 1 ? `(${orExpression})` : orExpression);
  }

  const { timeRange, timeRangeInvalid } = normalizeGoogleRssTimeRange(row.time_range);
  if (andTerms.length === 0 && orTerms.length === 0) {
    return {
      query: '',
      andString: combineGoogleRssTermsForDb(row.and_keywords, row.and_exact_phrases),
      orString: combineGoogleRssTermsForDb(row.or_keywords, row.or_exact_phrases),
      timeRange,
      timeRangeInvalid,
    };
  }

  queryParts.push(`when:${timeRange}`);

  return {
    query: queryParts.join(' ').trim(),
    andString: combineGoogleRssTermsForDb(row.and_keywords, row.and_exact_phrases),
    orString: combineGoogleRssTermsForDb(row.or_keywords, row.or_exact_phrases),
    timeRange,
    timeRangeInvalid,
  };
};

export const buildGoogleRssUrl = (query: string): string => {
  const baseUrl = 'https://news.google.com/rss/search';
  const params = new URLSearchParams({ q: query });

  const hl = process.env.GOOGLE_RSS_HL || 'en-US';
  const gl = process.env.GOOGLE_RSS_GL || 'US';
  const ceid = process.env.GOOGLE_RSS_CEID || 'US:en';

  params.set('hl', hl);
  params.set('gl', gl);
  params.set('ceid', ceid);

  return `${baseUrl}?${params.toString()}`;
};

export const readGoogleRssQuerySpreadsheet = async (
  filePath: string
): Promise<GoogleRssQueryRow[]> => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('Spreadsheet has no worksheets.');
  }

  const headerRow = worksheet.getRow(1);
  const headerMap = new Map<string, number>();

  headerRow.eachCell((cell, colNumber) => {
    const header = toCellString(cell.value).toLowerCase();
    if (header) {
      headerMap.set(header, colNumber);
    }
  });

  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headerMap.has(header));
  if (missingHeaders.length > 0) {
    throw new Error(`Spreadsheet missing required columns: ${missingHeaders.join(', ')}`);
  }

  const rows: GoogleRssQueryRow[] = [];
  for (let rowIndex = 2; rowIndex <= worksheet.rowCount; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    const rowValues = {
      id: toCellString(row.getCell(headerMap.get('id')!).value),
      and_keywords: toCellString(row.getCell(headerMap.get('and_keywords')!).value),
      and_exact_phrases: toCellString(row.getCell(headerMap.get('and_exact_phrases')!).value),
      or_keywords: toCellString(row.getCell(headerMap.get('or_keywords')!).value),
      or_exact_phrases: toCellString(row.getCell(headerMap.get('or_exact_phrases')!).value),
      time_range: toCellString(row.getCell(headerMap.get('time_range')!).value),
    };

    const hasAnyValue = Object.values(rowValues).some((value) => value);
    if (!hasAnyValue) {
      continue;
    }

    const idNumber = Number.parseInt(rowValues.id, 10);
    if (Number.isNaN(idNumber) || !rowValues.id) {
      throw new Error(
        `Missing or invalid id in row ${rowIndex}. All rows must have a valid numeric id.`
      );
    }

    rows.push({
      id: idNumber,
      and_keywords: rowValues.and_keywords,
      and_exact_phrases: rowValues.and_exact_phrases,
      or_keywords: rowValues.or_keywords,
      or_exact_phrases: rowValues.or_exact_phrases,
      time_range: rowValues.time_range,
    });
  }

  return rows;
};

export const buildExpectedGoogleRssQueryRows = (
  rows: GoogleRssQueryRow[]
): ExpectedGoogleRssQueryRow[] =>
  rows.map((row, rowIndex) => {
    const queryResult = buildGoogleRssQuery(row);
    return {
      rowIndex,
      row,
      query: queryResult.query,
      requestUrl: queryResult.query ? buildGoogleRssUrl(queryResult.query) : null,
      andString: queryResult.andString,
      orString: queryResult.orString,
      timeRange: queryResult.timeRange,
      timeRangeInvalid: queryResult.timeRangeInvalid,
    };
  });
