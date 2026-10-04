export const GOOGLE_NEWS_RSS_ENDPOINT_NAME = '/request-google-rss/start-job';

export type GoogleNewsRssJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'canceled';

export type GoogleNewsRssEndingReason =
  | 'queries_exhausted'
  | 'target_articles_collected'
  | 'rate_limited'
  | 'error'
  | 'canceled'
  | 'aborted';

export interface GoogleNewsRssStartResult {
  jobId: string;
  status: 'queued';
  endpointName: typeof GOOGLE_NEWS_RSS_ENDPOINT_NAME;
}

export interface GoogleNewsRssResult {
  endingReason: GoogleNewsRssEndingReason;
  endingMessage: string;
  articlesAddedCount: number;
}

export interface GoogleNewsRssJob {
  jobId: string;
  endpointName: typeof GOOGLE_NEWS_RSS_ENDPOINT_NAME;
  status: GoogleNewsRssJobStatus;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  failureReason?: string;
  result?: GoogleNewsRssResult;
}

export type GoogleNewsRssClientErrorCategory =
  | 'transient_request'
  | 'permanent_request'
  | 'malformed_response'
  | 'unsuccessful_result'
  | 'job_timeout'
  | 'cancellation_failure'
  | 'unverified_outcome'
  | 'unavailable_job';

export class GoogleNewsRssClientError extends Error {
  public readonly category: GoogleNewsRssClientErrorCategory;
  public readonly httpStatus?: number;

  public constructor(
    category: GoogleNewsRssClientErrorCategory,
    message: string,
    options?: { cause?: unknown; httpStatus?: number }
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'GoogleNewsRssClientError';
    this.category = category;
    this.httpStatus = options?.httpStatus;
  }
}

export type WorkerNodeRequest = (url: URL, init: RequestInit) => Promise<Response>;
export type PhaseFourClock = () => Date;
export type PhaseFourDelay = (milliseconds: number) => Promise<void>;

export interface GoogleNewsRssStatusContext {
  expectedJobId: string;
  phaseStartedAt: Date;
}

export interface GoogleNewsRssClientSettings {
  baseUrl: string;
  requestTimeoutSeconds: number;
}

export type GoogleNewsRssJobAssessment =
  | { kind: 'active'; job: GoogleNewsRssJob }
  | { kind: 'verified_success'; job: GoogleNewsRssJob; result: GoogleNewsRssResult }
  | { kind: 'unsuccessful'; job: GoogleNewsRssJob; reason: string }
  | { kind: 'timed_out'; job: GoogleNewsRssJob };

export interface MonitorGoogleNewsRssJobOptions {
  getStatus: () => Promise<GoogleNewsRssJob>;
  pollIntervalMilliseconds: number;
  toleratedConsecutiveFailures: number;
  jobTimeoutMilliseconds: number;
  now?: PhaseFourClock;
  delay?: PhaseFourDelay;
}

export type GoogleNewsRssCancellationConfirmation =
  | { kind: 'confirmed_inactive'; via: 'canceled' | 'terminal_status'; job?: GoogleNewsRssJob }
  | { kind: 'unavailable'; via: 'status_404' };

export interface ConfirmGoogleNewsRssCancellationOptions {
  cancel: () => Promise<'canceled' | 'cancel_requested' | 'not_found'>;
  getStatus: () => Promise<GoogleNewsRssJob>;
  pollIntervalMilliseconds: number;
  delay?: PhaseFourDelay;
}

const terminalStatuses = new Set<GoogleNewsRssJobStatus>([
  'completed',
  'failed',
  'canceled'
]);

const endingReasons = new Set<GoogleNewsRssEndingReason>([
  'queries_exhausted',
  'target_articles_collected',
  'rate_limited',
  'error',
  'canceled',
  'aborted'
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireNonemptyString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new GoogleNewsRssClientError(
      'malformed_response',
      `Worker response field ${field} must be a non-empty string`
    );
  }
  return value.trim();
};

const requireTimestamp = (value: unknown, field: string): string => {
  const timestamp = requireNonemptyString(value, field);
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new GoogleNewsRssClientError(
      'malformed_response',
      `Worker response field ${field} must be a valid timestamp`
    );
  }
  return timestamp;
};

const optionalTimestamp = (value: unknown, field: string): string | undefined =>
  value === undefined ? undefined : requireTimestamp(value, field);

const requireNonnegativeInteger = (value: unknown, field: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new GoogleNewsRssClientError(
      'malformed_response',
      `Worker response field ${field} must be a non-negative safe integer`
    );
  }
  return value as number;
};

const buildEndpoint = (baseUrl: string, path: string): URL => {
  const endpoint = new URL(baseUrl);
  endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, '')}${path}`;
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint;
};

const conciseWorkerError = (body: unknown): string | undefined => {
  if (!isRecord(body)) return undefined;
  const candidate = typeof body.message === 'string' ? body.message : body.error;
  if (typeof candidate !== 'string' || candidate.trim() === '') return undefined;
  const value = candidate.trim();
  return value.length <= 300 ? value : `${value.slice(0, 300)}…`;
};

const readResponseBody = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch (error: unknown) {
    if (!response.ok) return undefined;
    throw new GoogleNewsRssClientError(
      'malformed_response',
      'Worker-node returned malformed JSON for a successful request',
      { cause: error }
    );
  }
};

const isTransientHttpStatus = (status: number): boolean =>
  status === 408 || status === 425 || status === 429 || status >= 500;

const requestWorkerNode = async (
  settings: GoogleNewsRssClientSettings,
  path: string,
  init: Omit<RequestInit, 'signal'>,
  request: WorkerNodeRequest,
  operation: string,
  allowNotFound = false
): Promise<{ body: unknown; notFound: boolean }> => {
  const signal = AbortSignal.timeout(settings.requestTimeoutSeconds * 1000);
  let response: Response;

  try {
    response = await request(buildEndpoint(settings.baseUrl, path), { ...init, signal });
  } catch (error: unknown) {
    throw new GoogleNewsRssClientError(
      'transient_request',
      signal.aborted
        ? `${operation} timed out after ${settings.requestTimeoutSeconds} seconds`
        : `${operation} failed before a response was received`,
      { cause: error }
    );
  }

  const body = await readResponseBody(response);
  if (allowNotFound && response.status === 404) return { body, notFound: true };
  if (!response.ok) {
    const detail = conciseWorkerError(body);
    throw new GoogleNewsRssClientError(
      isTransientHttpStatus(response.status) ? 'transient_request' : 'permanent_request',
      `${operation} returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
      { httpStatus: response.status }
    );
  }

  return { body, notFound: false };
};

export const parseGoogleNewsRssStartResponse = (body: unknown): GoogleNewsRssStartResult => {
  if (!isRecord(body)) {
    throw new GoogleNewsRssClientError('malformed_response', 'RSS start response must be an object');
  }
  const jobId = requireNonemptyString(body.jobId, 'jobId');
  if (body.status !== 'queued') {
    throw new GoogleNewsRssClientError(
      'malformed_response',
      'RSS start response field status must be queued'
    );
  }
  if (body.endpointName !== GOOGLE_NEWS_RSS_ENDPOINT_NAME) {
    throw new GoogleNewsRssClientError(
      'malformed_response',
      `RSS start response field endpointName must be ${GOOGLE_NEWS_RSS_ENDPOINT_NAME}`
    );
  }
  return { jobId, status: 'queued', endpointName: GOOGLE_NEWS_RSS_ENDPOINT_NAME };
};

const parseGoogleNewsRssResult = (value: unknown): GoogleNewsRssResult => {
  if (!isRecord(value) || !endingReasons.has(value.endingReason as GoogleNewsRssEndingReason)) {
    throw new GoogleNewsRssClientError(
      'malformed_response',
      'Completed RSS job must contain a recognized endingReason'
    );
  }
  return {
    endingReason: value.endingReason as GoogleNewsRssEndingReason,
    endingMessage: requireNonemptyString(value.endingMessage, 'job.result.endingMessage'),
    articlesAddedCount: requireNonnegativeInteger(
      value.articlesAddedCount,
      'job.result.articlesAddedCount'
    )
  };
};

export const parseGoogleNewsRssStatusResponse = (
  body: unknown,
  context: GoogleNewsRssStatusContext
): GoogleNewsRssJob => {
  if (!isRecord(body) || !isRecord(body.job)) {
    throw new GoogleNewsRssClientError(
      'malformed_response',
      'RSS status response must contain a job object'
    );
  }
  const raw = body.job;
  const jobId = requireNonemptyString(raw.jobId, 'job.jobId');
  if (jobId !== context.expectedJobId) {
    throw new GoogleNewsRssClientError('unavailable_job', 'Saved RSS job ID does not match');
  }
  if (raw.endpointName !== GOOGLE_NEWS_RSS_ENDPOINT_NAME) {
    throw new GoogleNewsRssClientError(
      'unavailable_job',
      'Saved job belongs to a different worker endpoint'
    );
  }
  if (!['queued', 'running', 'completed', 'failed', 'canceled'].includes(raw.status as string)) {
    throw new GoogleNewsRssClientError(
      'malformed_response',
      'RSS job contains an unrecognized status'
    );
  }
  const status = raw.status as GoogleNewsRssJobStatus;
  const createdAt = requireTimestamp(raw.createdAt, 'job.createdAt');
  if (Date.parse(createdAt) < context.phaseStartedAt.getTime()) {
    throw new GoogleNewsRssClientError(
      'unavailable_job',
      'Saved RSS job was created before Phase 4 started'
    );
  }
  const endedAt = terminalStatuses.has(status)
    ? requireTimestamp(raw.endedAt, 'job.endedAt')
    : optionalTimestamp(raw.endedAt, 'job.endedAt');

  return {
    jobId,
    endpointName: GOOGLE_NEWS_RSS_ENDPOINT_NAME,
    status,
    createdAt,
    ...(raw.startedAt === undefined
      ? {}
      : { startedAt: requireTimestamp(raw.startedAt, 'job.startedAt') }),
    ...(endedAt === undefined ? {} : { endedAt }),
    ...(raw.failureReason === undefined
      ? {}
      : { failureReason: requireNonemptyString(raw.failureReason, 'job.failureReason') }),
    ...(status === 'completed' ? { result: parseGoogleNewsRssResult(raw.result) } : {})
  };
};

export const startGoogleNewsRssJob = async (
  settings: GoogleNewsRssClientSettings,
  request: WorkerNodeRequest = globalThis.fetch
): Promise<GoogleNewsRssStartResult> => {
  const { body } = await requestWorkerNode(
    settings,
    GOOGLE_NEWS_RSS_ENDPOINT_NAME,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    },
    request,
    'RSS start request'
  );
  return parseGoogleNewsRssStartResponse(body);
};

export const getGoogleNewsRssJobStatus = async (
  settings: GoogleNewsRssClientSettings,
  context: GoogleNewsRssStatusContext,
  request: WorkerNodeRequest = globalThis.fetch
): Promise<GoogleNewsRssJob> => {
  const { body, notFound } = await requestWorkerNode(
    settings,
    `/queue-info/check-status/${encodeURIComponent(context.expectedJobId)}`,
    { method: 'GET' },
    request,
    'RSS status request',
    true
  );
  if (notFound) {
    throw new GoogleNewsRssClientError('unavailable_job', 'RSS status request returned HTTP 404', {
      httpStatus: 404
    });
  }
  return parseGoogleNewsRssStatusResponse(body, context);
};

export const cancelGoogleNewsRssJob = async (
  settings: GoogleNewsRssClientSettings,
  jobId: string,
  request: WorkerNodeRequest = globalThis.fetch
): Promise<'canceled' | 'cancel_requested' | 'not_found'> => {
  const { body, notFound } = await requestWorkerNode(
    settings,
    `/queue-info/cancel_job/${encodeURIComponent(jobId)}`,
    { method: 'POST' },
    request,
    'RSS cancellation request',
    true
  );
  if (notFound) return 'not_found';
  if (!isRecord(body) || body.jobId !== jobId) {
    throw new GoogleNewsRssClientError(
      'malformed_response',
      'RSS cancellation response must contain the requested job ID'
    );
  }
  if (body.outcome !== 'canceled' && body.outcome !== 'cancel_requested') {
    throw new GoogleNewsRssClientError(
      'malformed_response',
      'RSS cancellation response must confirm canceled or cancel_requested'
    );
  }
  return body.outcome;
};

export const assessGoogleNewsRssJob = (
  job: GoogleNewsRssJob,
  now: Date,
  jobTimeoutMilliseconds: number
): GoogleNewsRssJobAssessment => {
  const createdAt = Date.parse(job.createdAt);
  if (job.status === 'queued' || job.status === 'running') {
    return now.getTime() - createdAt > jobTimeoutMilliseconds
      ? { kind: 'timed_out', job }
      : { kind: 'active', job };
  }

  const endedAt = Date.parse(job.endedAt as string);
  if (endedAt - createdAt > jobTimeoutMilliseconds) return { kind: 'timed_out', job };
  if (job.status === 'completed' && job.result?.endingReason === 'queries_exhausted') {
    return { kind: 'verified_success', job, result: job.result };
  }
  const reason =
    job.status === 'completed'
      ? (job.result?.endingReason ?? 'missing_result')
      : (job.failureReason ?? job.status);
  return { kind: 'unsuccessful', job, reason };
};

const defaultDelay: PhaseFourDelay = async (milliseconds) => {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
};

export const monitorGoogleNewsRssJob = async (
  options: MonitorGoogleNewsRssJobOptions
): Promise<Exclude<GoogleNewsRssJobAssessment, { kind: 'active' }>> => {
  const now = options.now ?? (() => new Date());
  const delay = options.delay ?? defaultDelay;
  let consecutiveFailures = 0;

  while (true) {
    let job: GoogleNewsRssJob;
    try {
      job = await options.getStatus();
      consecutiveFailures = 0;
    } catch (error: unknown) {
      if (!(error instanceof GoogleNewsRssClientError) || error.category !== 'transient_request') {
        throw error;
      }
      consecutiveFailures += 1;
      if (consecutiveFailures > options.toleratedConsecutiveFailures) {
        throw new GoogleNewsRssClientError(
          'unverified_outcome',
          `RSS monitoring stopped after ${consecutiveFailures} consecutive transient failures`,
          { cause: error }
        );
      }
      await delay(options.pollIntervalMilliseconds);
      continue;
    }

    const assessment = assessGoogleNewsRssJob(job, now(), options.jobTimeoutMilliseconds);
    if (assessment.kind !== 'active') return assessment;
    await delay(options.pollIntervalMilliseconds);
  }
};

export const confirmGoogleNewsRssCancellation = async (
  options: ConfirmGoogleNewsRssCancellationOptions
): Promise<GoogleNewsRssCancellationConfirmation> => {
  const delay = options.delay ?? defaultDelay;
  let outcome: 'canceled' | 'cancel_requested' | 'not_found';
  try {
    outcome = await options.cancel();
  } catch (error: unknown) {
    throw new GoogleNewsRssClientError(
      'cancellation_failure',
      'RSS cancellation could not be confirmed',
      { cause: error }
    );
  }

  if (outcome === 'canceled') return { kind: 'confirmed_inactive', via: 'canceled' };
  if (outcome === 'cancel_requested') await delay(options.pollIntervalMilliseconds);

  try {
    const job = await options.getStatus();
    if (job.status === 'queued' || job.status === 'running') {
      throw new GoogleNewsRssClientError(
        'unverified_outcome',
        'RSS job remains active after cancellation'
      );
    }
    return { kind: 'confirmed_inactive', via: 'terminal_status', job };
  } catch (error: unknown) {
    if (
      outcome === 'not_found' &&
      error instanceof GoogleNewsRssClientError &&
      error.category === 'unavailable_job' &&
      error.httpStatus === 404
    ) {
      return { kind: 'unavailable', via: 'status_404' };
    }
    if (error instanceof GoogleNewsRssClientError && error.category === 'unverified_outcome') {
      throw error;
    }
    throw new GoogleNewsRssClientError(
      'unverified_outcome',
      'RSS cancellation follow-up status could not be verified',
      { cause: error }
    );
  }
};
