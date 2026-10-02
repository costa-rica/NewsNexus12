export interface ClearDuplicateAnalysesResult {
  rowsDeleted: number;
  cancelledJobs: string[];
  cancellationRequestedJobs: string[];
  timestamp: string;
}

export type ClearDuplicateAnalysesFailure =
  | 'connection'
  | 'http'
  | 'invalid_response'
  | 'timeout';

export class ClearDuplicateAnalysesError extends Error {
  public readonly category: ClearDuplicateAnalysesFailure;
  public readonly httpStatus?: number;

  public constructor(
    category: ClearDuplicateAnalysesFailure,
    message: string,
    options?: { cause?: unknown; httpStatus?: number }
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ClearDuplicateAnalysesError';
    this.category = category;
    this.httpStatus = options?.httpStatus;
  }
}

export type WorkerRequest = (url: URL, init: RequestInit) => Promise<Response>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireStringArray = (value: unknown, field: string): string[] => {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new ClearDuplicateAnalysesError(
      'invalid_response',
      `Worker response field ${field} must be an array of strings`
    );
  }
  return [...value];
};

export const parseClearDuplicateAnalysesResponse = (
  body: unknown
): ClearDuplicateAnalysesResult => {
  if (!isRecord(body)) {
    throw new ClearDuplicateAnalysesError('invalid_response', 'Worker response must be an object');
  }
  if (body.cleared !== true) {
    throw new ClearDuplicateAnalysesError(
      'invalid_response',
      'Worker response must confirm cleared=true'
    );
  }
  if (!Number.isSafeInteger(body.rowsDeleted) || (body.rowsDeleted as number) < 0) {
    throw new ClearDuplicateAnalysesError(
      'invalid_response',
      'Worker response field rowsDeleted must be a non-negative integer'
    );
  }
  if (typeof body.timestamp !== 'string' || !body.timestamp.trim()) {
    throw new ClearDuplicateAnalysesError(
      'invalid_response',
      'Worker response field timestamp must be a non-empty string'
    );
  }

  return {
    rowsDeleted: body.rowsDeleted as number,
    cancelledJobs: requireStringArray(body.cancelledJobs, 'cancelledJobs'),
    cancellationRequestedJobs: requireStringArray(
      body.cancellationRequestedJobs,
      'cancellationRequestedJobs'
    ),
    timestamp: body.timestamp
  };
};

const buildClearEndpoint = (workerPythonBaseUrl: string): URL => {
  const endpoint = new URL(workerPythonBaseUrl);
  endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, '')}/deduper/clear-db-table`;
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint;
};

const conciseWorkerError = (body: unknown): string | undefined => {
  if (!isRecord(body) || typeof body.error !== 'string' || !body.error.trim()) {
    return undefined;
  }
  const limit = 300;
  const value = body.error.trim();
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
};

const readResponseBody = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch (error: unknown) {
    if (!response.ok) return undefined;
    throw new ClearDuplicateAnalysesError(
      'invalid_response',
      'Worker returned malformed JSON for a successful clear request',
      { cause: error }
    );
  }
};

export const requestClearDuplicateAnalyses = async (
  workerPythonBaseUrl: string,
  timeoutSeconds: number,
  request: WorkerRequest = globalThis.fetch
): Promise<ClearDuplicateAnalysesResult> => {
  const endpoint = buildClearEndpoint(workerPythonBaseUrl);
  const signal = AbortSignal.timeout(timeoutSeconds * 1000);
  let response: Response;

  try {
    response = await request(endpoint, { method: 'DELETE', signal });
  } catch (error: unknown) {
    if (signal.aborted || (error instanceof Error && error.name === 'TimeoutError')) {
      throw new ClearDuplicateAnalysesError(
        'timeout',
        `Worker clear request timed out after ${timeoutSeconds} seconds; outcome unverified`,
        { cause: error }
      );
    }
    throw new ClearDuplicateAnalysesError(
      'connection',
      'Worker clear request failed before a response was received',
      { cause: error }
    );
  }

  const body = await readResponseBody(response);
  if (!response.ok) {
    const detail = conciseWorkerError(body);
    throw new ClearDuplicateAnalysesError(
      'http',
      `Worker clear request returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
      { httpStatus: response.status }
    );
  }

  return parseClearDuplicateAnalysesResponse(body);
};
