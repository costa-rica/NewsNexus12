export const SEMANTIC_SCORER_ENDPOINT_NAME = '/semantic-scorer/start-job';

export type SemanticScorerJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled';

export interface SemanticScorerStartResult {
  jobId: string;
  status: 'queued';
  endpointName: typeof SEMANTIC_SCORER_ENDPOINT_NAME;
}

export interface SemanticScorerJob {
  jobId: string;
  endpointName: typeof SEMANTIC_SCORER_ENDPOINT_NAME;
  status: SemanticScorerJobStatus;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  failureReason?: string;
}

export type SemanticScorerClientErrorCategory =
  | 'transient_request'
  | 'permanent_request'
  | 'malformed_response'
  | 'unavailable_job'
  | 'cancellation_failure';

export class SemanticScorerClientError extends Error {
  constructor(
    public readonly category: SemanticScorerClientErrorCategory,
    message: string,
    public readonly httpStatus?: number,
    options?: { cause?: unknown }
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'SemanticScorerClientError';
  }
}

export type SemanticScorerRequest = (url: URL, init: RequestInit) => Promise<Response>;

export interface SemanticScorerClientSettings {
  baseUrl: string;
  requestTimeoutSeconds: number;
}

export interface SemanticScorerStatusContext {
  expectedJobId: string;
  phaseStartedAt: Date;
}

const statuses = new Set<SemanticScorerJobStatus>([
  'queued', 'running', 'completed', 'failed', 'canceled'
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SemanticScorerClientError('malformed_response', `${field} must be a non-empty string`);
  }
  return value.trim();
};

const requireTimestamp = (value: unknown, field: string): string => {
  const timestamp = requireString(value, field);
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new SemanticScorerClientError('malformed_response', `${field} must be a valid timestamp`);
  }
  return timestamp;
};

const buildUrl = (baseUrl: string, route: string): URL => {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}${route}`;
  url.search = '';
  url.hash = '';
  return url;
};

const isTransientStatus = (status: number): boolean =>
  status === 408 || status === 425 || status === 429 || status >= 500;

const readBody = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch (error) {
    if (!response.ok) return undefined;
    throw new SemanticScorerClientError(
      'malformed_response',
      'Worker-node returned malformed JSON for a successful request',
      undefined,
      { cause: error }
    );
  }
};

const requestWorker = async (
  settings: SemanticScorerClientSettings,
  route: string,
  init: Omit<RequestInit, 'signal'>,
  request: SemanticScorerRequest,
  operation: string,
  allowNotFound = false
): Promise<{ body: unknown; notFound: boolean }> => {
  const signal = AbortSignal.timeout(settings.requestTimeoutSeconds * 1000);
  let response: Response;
  try {
    response = await request(buildUrl(settings.baseUrl, route), { ...init, signal });
  } catch (error) {
    throw new SemanticScorerClientError(
      'transient_request',
      signal.aborted
        ? `${operation} timed out after ${settings.requestTimeoutSeconds} seconds`
        : `${operation} failed before a response was received`,
      undefined,
      { cause: error }
    );
  }
  const body = await readBody(response);
  if (allowNotFound && response.status === 404) return { body, notFound: true };
  if (!response.ok) {
    throw new SemanticScorerClientError(
      isTransientStatus(response.status) ? 'transient_request' : 'permanent_request',
      `${operation} returned HTTP ${response.status}`,
      response.status
    );
  }
  return { body, notFound: false };
};

export const parseSemanticScorerStartResponse = (body: unknown): SemanticScorerStartResult => {
  if (!isRecord(body)) {
    throw new SemanticScorerClientError('malformed_response', 'Semantic scorer start response must be an object');
  }
  const jobId = requireString(body.jobId, 'jobId');
  if (body.status !== 'queued' || body.endpointName !== SEMANTIC_SCORER_ENDPOINT_NAME) {
    throw new SemanticScorerClientError('malformed_response', 'Semantic scorer start response identity is invalid');
  }
  return { jobId, status: 'queued', endpointName: SEMANTIC_SCORER_ENDPOINT_NAME };
};

export const parseSemanticScorerStatusResponse = (
  body: unknown,
  context: SemanticScorerStatusContext
): SemanticScorerJob => {
  if (!isRecord(body) || !isRecord(body.job)) {
    throw new SemanticScorerClientError('malformed_response', 'Semantic scorer status response must contain a job object');
  }
  const raw = body.job;
  const jobId = requireString(raw.jobId, 'job.jobId');
  if (jobId !== context.expectedJobId || raw.endpointName !== SEMANTIC_SCORER_ENDPOINT_NAME) {
    throw new SemanticScorerClientError('unavailable_job', 'Saved semantic scorer job identity does not match');
  }
  if (!statuses.has(raw.status as SemanticScorerJobStatus)) {
    throw new SemanticScorerClientError('malformed_response', 'Semantic scorer job status is invalid');
  }
  const status = raw.status as SemanticScorerJobStatus;
  const createdAt = requireTimestamp(raw.createdAt, 'job.createdAt');
  if (Date.parse(createdAt) < context.phaseStartedAt.getTime()) {
    throw new SemanticScorerClientError('unavailable_job', 'Saved semantic scorer job predates Phase 5');
  }

  let startedAt: string | undefined;
  let endedAt: string | undefined;
  if (status === 'running' || status === 'completed') {
    startedAt = requireTimestamp(raw.startedAt, 'job.startedAt');
  } else if (raw.startedAt !== undefined) {
    startedAt = requireTimestamp(raw.startedAt, 'job.startedAt');
  }
  if (status === 'completed' || status === 'failed' || status === 'canceled') {
    endedAt = requireTimestamp(raw.endedAt, 'job.endedAt');
  } else if (raw.endedAt !== undefined) {
    endedAt = requireTimestamp(raw.endedAt, 'job.endedAt');
  }
  const createdMs = Date.parse(createdAt);
  if (startedAt && Date.parse(startedAt) < createdMs) {
    throw new SemanticScorerClientError('malformed_response', 'job.startedAt cannot be before job.createdAt');
  }
  if (endedAt && Date.parse(endedAt) < (startedAt ? Date.parse(startedAt) : createdMs)) {
    throw new SemanticScorerClientError('malformed_response', 'job.endedAt is not chronological');
  }
  return {
    jobId,
    endpointName: SEMANTIC_SCORER_ENDPOINT_NAME,
    status,
    createdAt,
    ...(startedAt ? { startedAt } : {}),
    ...(endedAt ? { endedAt } : {}),
    ...(raw.failureReason === undefined ? {} : { failureReason: requireString(raw.failureReason, 'job.failureReason') })
  };
};

export const startSemanticScorerJob = async (
  settings: SemanticScorerClientSettings,
  request: SemanticScorerRequest = globalThis.fetch
): Promise<SemanticScorerStartResult> => {
  const { body } = await requestWorker(
    settings,
    SEMANTIC_SCORER_ENDPOINT_NAME,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) },
    request,
    'Semantic scorer start request'
  );
  return parseSemanticScorerStartResponse(body);
};

export const getSemanticScorerJobStatus = async (
  settings: SemanticScorerClientSettings,
  context: SemanticScorerStatusContext,
  request: SemanticScorerRequest = globalThis.fetch
): Promise<SemanticScorerJob> => {
  const { body, notFound } = await requestWorker(
    settings,
    `/queue-info/check-status/${encodeURIComponent(context.expectedJobId)}`,
    { method: 'GET' },
    request,
    'Semantic scorer status request',
    true
  );
  if (notFound) {
    throw new SemanticScorerClientError('unavailable_job', 'Semantic scorer status returned HTTP 404', 404);
  }
  return parseSemanticScorerStatusResponse(body, context);
};

export const cancelSemanticScorerJob = async (
  settings: SemanticScorerClientSettings,
  jobId: string,
  request: SemanticScorerRequest = globalThis.fetch
): Promise<'canceled' | 'cancel_requested' | 'not_found'> => {
  const { body, notFound } = await requestWorker(
    settings,
    `/queue-info/cancel_job/${encodeURIComponent(jobId)}`,
    { method: 'POST' },
    request,
    'Semantic scorer cancellation request',
    true
  );
  if (notFound) return 'not_found';
  if (!isRecord(body) || body.jobId !== jobId || !['canceled', 'cancel_requested'].includes(String(body.outcome))) {
    throw new SemanticScorerClientError('cancellation_failure', 'Semantic scorer cancellation response is invalid');
  }
  return body.outcome as 'canceled' | 'cancel_requested';
};
