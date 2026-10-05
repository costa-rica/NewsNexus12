export const STATE_ASSIGNER_ENDPOINT_NAME = '/state-assigner/start-job';

export interface StateAssignerInputs {
  targetArticleThresholdDaysOld: number;
  targetArticleStateReviewCount: number;
}

export type StateAssignerJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled';

export interface StateAssignerStartResult {
  jobId: string;
  status: 'queued';
  endpointName: typeof STATE_ASSIGNER_ENDPOINT_NAME;
}

export interface StateAssignerJobResult extends StateAssignerInputs {
  selectedCount: number;
  completedCount: number;
  skippedCount: number;
  failedCount: number;
}

export interface StateAssignerJob {
  jobId: string;
  endpointName: typeof STATE_ASSIGNER_ENDPOINT_NAME;
  status: StateAssignerJobStatus;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  failureReason?: string;
  parameters?: StateAssignerInputs;
  result?: StateAssignerJobResult;
}

export type StateAssignerStatusResult =
  | { kind: 'compatible'; job: StateAssignerJob & { parameters: StateAssignerInputs } }
  | {
      kind: 'incompatible_contract';
      job: StateAssignerJob;
      missingParameterFields: string[];
    };

export type StateAssignerClientErrorCategory =
  | 'transient_request'
  | 'permanent_request'
  | 'malformed_response'
  | 'unavailable_job'
  | 'cancellation_failure';

export class StateAssignerClientError extends Error {
  constructor(
    public readonly category: StateAssignerClientErrorCategory,
    message: string,
    public readonly httpStatus?: number,
    options?: { cause?: unknown }
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'StateAssignerClientError';
  }
}

export type StateAssignerRequest = (url: URL, init: RequestInit) => Promise<Response>;

export interface StateAssignerClientSettings {
  baseUrl: string;
  requestTimeoutSeconds: number;
}

export interface StateAssignerStatusContext {
  expectedJobId: string;
  phaseStartedAt: Date;
  expectedInputs: StateAssignerInputs;
}

const statuses = new Set<StateAssignerJobStatus>([
  'queued',
  'running',
  'completed',
  'failed',
  'canceled'
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new StateAssignerClientError('malformed_response', `${field} must be a non-empty string`);
  }
  return value.trim();
};

const requireTimestamp = (value: unknown, field: string): string => {
  const timestamp = requireString(value, field);
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new StateAssignerClientError('malformed_response', `${field} must be a valid timestamp`);
  }
  return timestamp;
};

const requirePositiveInteger = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new StateAssignerClientError('malformed_response', `${field} must be a positive safe integer`);
  }
  return value;
};

const requireNonnegativeInteger = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new StateAssignerClientError(
      'malformed_response',
      `${field} must be a non-negative safe integer`
    );
  }
  return value;
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
  } catch (error: unknown) {
    if (!response.ok) return undefined;
    throw new StateAssignerClientError(
      'malformed_response',
      'Worker-node returned malformed JSON for a successful request',
      undefined,
      { cause: error }
    );
  }
};

const requestWorker = async (
  settings: StateAssignerClientSettings,
  route: string,
  init: Omit<RequestInit, 'signal'>,
  request: StateAssignerRequest,
  operation: string,
  allowNotFound = false
): Promise<{ body: unknown; notFound: boolean }> => {
  const signal = AbortSignal.timeout(settings.requestTimeoutSeconds * 1000);
  let response: Response;
  try {
    response = await request(buildUrl(settings.baseUrl, route), { ...init, signal });
  } catch (error: unknown) {
    throw new StateAssignerClientError(
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
    throw new StateAssignerClientError(
      isTransientStatus(response.status) ? 'transient_request' : 'permanent_request',
      `${operation} returned HTTP ${response.status}`,
      response.status
    );
  }
  return { body, notFound: false };
};

export const parseStateAssignerStartResponse = (body: unknown): StateAssignerStartResult => {
  if (!isRecord(body)) {
    throw new StateAssignerClientError(
      'malformed_response',
      'State assigner start response must be an object'
    );
  }
  const jobId = requireString(body.jobId, 'jobId');
  if (body.status !== 'queued' || body.endpointName !== STATE_ASSIGNER_ENDPOINT_NAME) {
    throw new StateAssignerClientError(
      'malformed_response',
      'State assigner start response identity is invalid'
    );
  }
  return { jobId, status: 'queued', endpointName: STATE_ASSIGNER_ENDPOINT_NAME };
};

const parseLifecycle = (
  raw: Record<string, unknown>,
  context: StateAssignerStatusContext
): StateAssignerJob => {
  const jobId = requireString(raw.jobId, 'job.jobId');
  if (jobId !== context.expectedJobId || raw.endpointName !== STATE_ASSIGNER_ENDPOINT_NAME) {
    throw new StateAssignerClientError('unavailable_job', 'Saved state assigner job identity does not match');
  }
  if (!statuses.has(raw.status as StateAssignerJobStatus)) {
    throw new StateAssignerClientError('malformed_response', 'State assigner job status is invalid');
  }
  const status = raw.status as StateAssignerJobStatus;
  const createdAt = requireTimestamp(raw.createdAt, 'job.createdAt');
  if (Date.parse(createdAt) < context.phaseStartedAt.getTime()) {
    throw new StateAssignerClientError('unavailable_job', 'Saved state assigner job predates Phase 6');
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
    throw new StateAssignerClientError(
      'malformed_response',
      'job.startedAt cannot be before job.createdAt'
    );
  }
  if (endedAt && Date.parse(endedAt) < (startedAt ? Date.parse(startedAt) : createdMs)) {
    throw new StateAssignerClientError(
      'malformed_response',
      'job.endedAt is not chronological'
    );
  }

  return {
    jobId,
    endpointName: STATE_ASSIGNER_ENDPOINT_NAME,
    status,
    createdAt,
    ...(startedAt ? { startedAt } : {}),
    ...(endedAt ? { endedAt } : {}),
    ...(raw.failureReason === undefined
      ? {}
      : { failureReason: requireString(raw.failureReason, 'job.failureReason') })
  };
};

const parseParameters = (
  rawParameters: unknown,
  context: StateAssignerStatusContext
): { parameters?: StateAssignerInputs; missingFields: string[] } => {
  const requiredFields = [
    'targetArticleThresholdDaysOld',
    'targetArticleStateReviewCount'
  ] as const;
  if (rawParameters === undefined) {
    return { missingFields: [...requiredFields] };
  }
  if (!isRecord(rawParameters)) {
    throw new StateAssignerClientError('malformed_response', 'job.parameters must be an object');
  }
  const missingFields = requiredFields.filter((field) => rawParameters[field] === undefined);
  if (missingFields.length > 0) return { missingFields };

  const parameters: StateAssignerInputs = {
    targetArticleThresholdDaysOld: requirePositiveInteger(
      rawParameters.targetArticleThresholdDaysOld,
      'job.parameters.targetArticleThresholdDaysOld'
    ),
    targetArticleStateReviewCount: requirePositiveInteger(
      rawParameters.targetArticleStateReviewCount,
      'job.parameters.targetArticleStateReviewCount'
    )
  };
  if (
    parameters.targetArticleThresholdDaysOld !==
      context.expectedInputs.targetArticleThresholdDaysOld ||
    parameters.targetArticleStateReviewCount !==
      context.expectedInputs.targetArticleStateReviewCount
  ) {
    throw new StateAssignerClientError(
      'unavailable_job',
      'Saved state assigner job parameters do not match Phase 6 inputs'
    );
  }
  return { parameters, missingFields: [] };
};

const parseCompletedResult = (
  rawResult: unknown,
  expectedInputs: StateAssignerInputs
): StateAssignerJobResult => {
  if (!isRecord(rawResult)) {
    throw new StateAssignerClientError(
      'malformed_response',
      'Completed state assigner job must contain a result object'
    );
  }
  const result: StateAssignerJobResult = {
    selectedCount: requireNonnegativeInteger(rawResult.selectedCount, 'job.result.selectedCount'),
    completedCount: requireNonnegativeInteger(
      rawResult.completedCount,
      'job.result.completedCount'
    ),
    skippedCount: requireNonnegativeInteger(rawResult.skippedCount, 'job.result.skippedCount'),
    failedCount: requireNonnegativeInteger(rawResult.failedCount, 'job.result.failedCount'),
    targetArticleThresholdDaysOld: requirePositiveInteger(
      rawResult.targetArticleThresholdDaysOld,
      'job.result.targetArticleThresholdDaysOld'
    ),
    targetArticleStateReviewCount: requirePositiveInteger(
      rawResult.targetArticleStateReviewCount,
      'job.result.targetArticleStateReviewCount'
    )
  };
  if (
    result.targetArticleThresholdDaysOld !== expectedInputs.targetArticleThresholdDaysOld ||
    result.targetArticleStateReviewCount !== expectedInputs.targetArticleStateReviewCount
  ) {
    throw new StateAssignerClientError(
      'malformed_response',
      'State assigner result inputs do not match Phase 6 inputs'
    );
  }
  if (
    result.selectedCount !==
    result.completedCount + result.skippedCount + result.failedCount
  ) {
    throw new StateAssignerClientError(
      'malformed_response',
      'State assigner result counts are inconsistent'
    );
  }
  if (result.selectedCount > expectedInputs.targetArticleStateReviewCount) {
    throw new StateAssignerClientError(
      'malformed_response',
      'State assigner selectedCount exceeds the requested Article count'
    );
  }
  return result;
};

export const parseStateAssignerStatusResponse = (
  body: unknown,
  context: StateAssignerStatusContext
): StateAssignerStatusResult => {
  if (!isRecord(body) || !isRecord(body.job)) {
    throw new StateAssignerClientError(
      'malformed_response',
      'State assigner status response must contain a job object'
    );
  }
  const lifecycle = parseLifecycle(body.job, context);
  const parsedParameters = parseParameters(body.job.parameters, context);
  if (!parsedParameters.parameters) {
    return {
      kind: 'incompatible_contract',
      job: lifecycle,
      missingParameterFields: parsedParameters.missingFields
    };
  }
  const result =
    lifecycle.status === 'completed'
      ? parseCompletedResult(body.job.result, context.expectedInputs)
      : undefined;
  return {
    kind: 'compatible',
    job: {
      ...lifecycle,
      parameters: parsedParameters.parameters,
      ...(result ? { result } : {})
    }
  };
};

export const startStateAssignerJob = async (
  settings: StateAssignerClientSettings,
  inputs: StateAssignerInputs,
  request: StateAssignerRequest = globalThis.fetch
): Promise<StateAssignerStartResult> => {
  const { body } = await requestWorker(
    settings,
    STATE_ASSIGNER_ENDPOINT_NAME,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(inputs)
    },
    request,
    'State assigner start request'
  );
  return parseStateAssignerStartResponse(body);
};

export const getStateAssignerJobStatus = async (
  settings: StateAssignerClientSettings,
  context: StateAssignerStatusContext,
  request: StateAssignerRequest = globalThis.fetch
): Promise<StateAssignerStatusResult> => {
  const { body, notFound } = await requestWorker(
    settings,
    `/queue-info/check-status/${encodeURIComponent(context.expectedJobId)}`,
    { method: 'GET' },
    request,
    'State assigner status request',
    true
  );
  if (notFound) {
    throw new StateAssignerClientError(
      'unavailable_job',
      'State assigner status returned HTTP 404',
      404
    );
  }
  return parseStateAssignerStatusResponse(body, context);
};

export const cancelStateAssignerJob = async (
  settings: StateAssignerClientSettings,
  jobId: string,
  request: StateAssignerRequest = globalThis.fetch
): Promise<'canceled' | 'cancel_requested' | 'not_found'> => {
  const { body, notFound } = await requestWorker(
    settings,
    `/queue-info/cancel_job/${encodeURIComponent(jobId)}`,
    { method: 'POST' },
    request,
    'State assigner cancellation request',
    true
  );
  if (notFound) return 'not_found';
  if (
    !isRecord(body) ||
    body.jobId !== jobId ||
    !['canceled', 'cancel_requested'].includes(String(body.outcome))
  ) {
    throw new StateAssignerClientError(
      'cancellation_failure',
      'State assigner cancellation response is invalid'
    );
  }
  return body.outcome as 'canceled' | 'cancel_requested';
};
