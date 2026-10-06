export const AI_APPROVER_V02_ENDPOINT_NAME = '/ai-approver-v02/start';

export interface AiApproverV02Inputs {
  selectionMode: 'article_position_count';
  requestedArticleCount: number;
  allowPastApprovedBoundary: true;
  allowDescriptionFallback: true;
}

export interface AiApproverV02ClientSettings {
  baseUrl: string;
  requestTimeoutSeconds: number;
}

export type AiApproverV02Request = (url: URL, init: RequestInit) => Promise<Response>;

export type AiApproverV02ClientErrorCategory =
  | 'transient_request'
  | 'permanent_request'
  | 'malformed_response'
  | 'identity_mismatch'
  | 'start_conflict'
  | 'unavailable_unaccepted_preview'
  | 'accepted_run_unavailable'
  | 'cancellation_failure'
  | 'unverified_outcome';

export class AiApproverV02ClientError extends Error {
  constructor(
    public readonly category: AiApproverV02ClientErrorCategory,
    message: string,
    public readonly httpStatus?: number,
    options?: { cause?: unknown }
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AiApproverV02ClientError';
  }
}

export interface AiApproverV02Preview {
  v02RunId: number;
  previewToken: string;
  previewCreatedAt: string;
  previewExpiresAt: string;
  plannedEligibleCount: number;
}

export type AiApproverV02PreviewResult =
  | { kind: 'work'; preview: AiApproverV02Preview }
  | { kind: 'zero_work' };

export interface AiApproverV02StartResult {
  v02RunId: number;
  jobId: string;
  status: 'queued';
}

export type AiApproverV02RunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'circuit_breaker';

export interface AiApproverV02Counts {
  plannedEligibleCount: number;
  attemptedCount: number;
  completedCount: number;
  failedCount: number;
  invalidResponseCount: number;
  skippedCount: number;
}

export interface AiApproverV02Run extends AiApproverV02Counts, AiApproverV02Inputs {
  v02RunId: number;
  status: AiApproverV02RunStatus;
  jobId: string | null;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  endingReason?: string;
}

export type AiApproverV02QueueStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled';

export interface AiApproverV02QueueRecord {
  jobId: string;
  endpointName: typeof AI_APPROVER_V02_ENDPOINT_NAME;
  status: AiApproverV02QueueStatus;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  failureReason?: string;
  parameters: { runId: number };
}

export interface AiApproverV02Detail {
  run: AiApproverV02Run;
  queueStatus: AiApproverV02QueueRecord | null;
}

export interface AiApproverV02DetailContext {
  expectedV02RunId: number;
  expectedInputs: AiApproverV02Inputs;
  previewCreatedAt: string;
  expectedJobId: string | null;
  acceptanceObserved: boolean;
}

const runStatuses = new Set<AiApproverV02RunStatus>([
  'queued',
  'running',
  'completed',
  'failed',
  'canceled',
  'circuit_breaker'
]);

const queueStatuses = new Set<AiApproverV02QueueStatus>([
  'queued',
  'running',
  'completed',
  'failed',
  'canceled'
]);

const contentSources = new Set(['article_contents_02', 'description']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AiApproverV02ClientError('malformed_response', `${field} must be a non-empty string`);
  }
  return value.trim();
};

const requireTimestamp = (value: unknown, field: string): string => {
  const timestamp = requireString(value, field);
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new AiApproverV02ClientError('malformed_response', `${field} must be a valid timestamp`);
  }
  return timestamp;
};

const requirePositiveInteger = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new AiApproverV02ClientError('malformed_response', `${field} must be a positive safe integer`);
  }
  return value;
};

const requireNonnegativeInteger = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new AiApproverV02ClientError(
      'malformed_response',
      `${field} must be a non-negative safe integer`
    );
  }
  return value;
};

const optionalString = (value: unknown, field: string): string | undefined =>
  value === null || value === undefined ? undefined : requireString(value, field);

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
    throw new AiApproverV02ClientError(
      'malformed_response',
      'Worker-python returned malformed JSON for a successful request',
      undefined,
      { cause: error }
    );
  }
};

const requestWorker = async (
  settings: AiApproverV02ClientSettings,
  route: string,
  init: Omit<RequestInit, 'signal'>,
  request: AiApproverV02Request,
  operation: string
): Promise<{ response: Response; body: unknown }> => {
  const signal = AbortSignal.timeout(settings.requestTimeoutSeconds * 1000);
  let response: Response;
  try {
    response = await request(buildUrl(settings.baseUrl, route), { ...init, signal });
  } catch (error: unknown) {
    throw new AiApproverV02ClientError(
      'transient_request',
      signal.aborted
        ? `${operation} timed out after ${settings.requestTimeoutSeconds} seconds`
        : `${operation} failed before a response was received`,
      undefined,
      { cause: error }
    );
  }
  return { response, body: await readBody(response) };
};

const validateInputs = (
  raw: Record<string, unknown>,
  expected: AiApproverV02Inputs,
  prefix: string
): void => {
  if (
    raw.selectionMode !== expected.selectionMode ||
    raw.requestedArticleCount !== expected.requestedArticleCount ||
    raw.allowPastApprovedBoundary !== true ||
    raw.allowDescriptionFallback !== true
  ) {
    throw new AiApproverV02ClientError(
      'identity_mismatch',
      `${prefix} inputs do not match the persisted Phase 7 inputs`
    );
  }
};

export const parseAiApproverV02Preview = (
  body: unknown,
  expectedInputs: AiApproverV02Inputs
): AiApproverV02Preview => {
  if (!isRecord(body)) {
    throw new AiApproverV02ClientError('malformed_response', 'V02 preview response must be an object');
  }
  const v02RunId = requirePositiveInteger(body.id, 'preview.id');
  if (body.status !== 'draft' || body.jobId !== null) {
    throw new AiApproverV02ClientError('malformed_response', 'V02 preview identity is invalid');
  }
  validateInputs(body, expectedInputs, 'V02 preview');
  const plannedEligibleCount = requirePositiveInteger(
    body.plannedEligibleCount,
    'preview.plannedEligibleCount'
  );
  if (plannedEligibleCount > expectedInputs.requestedArticleCount) {
    throw new AiApproverV02ClientError(
      'malformed_response',
      'V02 preview planned count exceeds the requested count'
    );
  }
  if (!Array.isArray(body.selectionSnapshot) || body.selectionSnapshot.length !== plannedEligibleCount) {
    throw new AiApproverV02ClientError(
      'malformed_response',
      'V02 preview selection snapshot length is invalid'
    );
  }
  for (const item of body.selectionSnapshot) {
    if (
      !isRecord(item) ||
      typeof item.articleId !== 'number' ||
      !Number.isSafeInteger(item.articleId) ||
      item.articleId <= 0 ||
      !contentSources.has(String(item.contentSource))
    ) {
      throw new AiApproverV02ClientError(
        'malformed_response',
        'V02 preview selection snapshot item is invalid'
      );
    }
  }
  const previewCreatedAt = requireTimestamp(body.createdAt, 'preview.createdAt');
  const previewExpiresAt = requireTimestamp(body.previewExpiresAt, 'preview.previewExpiresAt');
  if (Date.parse(previewExpiresAt) <= Date.parse(previewCreatedAt)) {
    throw new AiApproverV02ClientError(
      'malformed_response',
      'V02 preview expiration must be after creation'
    );
  }
  return {
    v02RunId,
    previewToken: requireString(body.previewToken, 'preview.previewToken'),
    previewCreatedAt,
    previewExpiresAt,
    plannedEligibleCount
  };
};

export const previewAiApproverV02 = async (
  settings: AiApproverV02ClientSettings,
  inputs: AiApproverV02Inputs,
  request: AiApproverV02Request
): Promise<AiApproverV02PreviewResult> => {
  const { response, body } = await requestWorker(
    settings,
    '/ai-approver-v02/preview',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(inputs)
    },
    request,
    'AI Approver V02 preview request'
  );
  if (!response.ok) {
    const code = isRecord(body) ? body.error : undefined;
    if (response.status === 400 && code === 'no_eligible_articles') return { kind: 'zero_work' };
    throw new AiApproverV02ClientError(
      isTransientStatus(response.status) ? 'transient_request' : 'permanent_request',
      `AI Approver V02 preview returned HTTP ${response.status}`,
      response.status
    );
  }
  return { kind: 'work', preview: parseAiApproverV02Preview(body, inputs) };
};

export const parseAiApproverV02Start = (
  body: unknown,
  expectedV02RunId: number
): AiApproverV02StartResult => {
  if (!isRecord(body)) {
    throw new AiApproverV02ClientError('malformed_response', 'V02 start response must be an object');
  }
  const v02RunId = requirePositiveInteger(body.runId, 'start.runId');
  if (v02RunId !== expectedV02RunId) {
    throw new AiApproverV02ClientError('identity_mismatch', 'V02 start run ID does not match');
  }
  if (body.status !== 'queued') {
    throw new AiApproverV02ClientError('malformed_response', 'V02 start status must be queued');
  }
  return { v02RunId, jobId: requireString(body.jobId, 'start.jobId'), status: 'queued' };
};

export const startAiApproverV02 = async (
  settings: AiApproverV02ClientSettings,
  v02RunId: number,
  previewToken: string,
  request: AiApproverV02Request
): Promise<AiApproverV02StartResult> => {
  const { response, body } = await requestWorker(
    settings,
    '/ai-approver-v02/start',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: v02RunId, previewToken })
    },
    request,
    'AI Approver V02 start request'
  );
  if (!response.ok) {
    const code = isRecord(body) ? body.error : undefined;
    if (response.status === 409 && (code === 'v02_run_conflict' || code === 'preview_expired')) {
      throw new AiApproverV02ClientError(
        'start_conflict',
        `AI Approver V02 start returned ${String(code)}`,
        response.status
      );
    }
    throw new AiApproverV02ClientError(
      isTransientStatus(response.status) ? 'transient_request' : 'permanent_request',
      `AI Approver V02 start returned HTTP ${response.status}`,
      response.status
    );
  }
  return parseAiApproverV02Start(body, v02RunId);
};

const parseRun = (
  raw: Record<string, unknown>,
  context: AiApproverV02DetailContext
): AiApproverV02Run => {
  const v02RunId = requirePositiveInteger(raw.id, 'detail.run.id');
  if (v02RunId !== context.expectedV02RunId) {
    throw new AiApproverV02ClientError('identity_mismatch', 'V02 detail run ID does not match');
  }
  validateInputs(raw, context.expectedInputs, 'V02 detail');
  if (!runStatuses.has(raw.status as AiApproverV02RunStatus)) {
    throw new AiApproverV02ClientError('malformed_response', 'V02 detail status is invalid');
  }
  const status = raw.status as AiApproverV02RunStatus;
  const jobId = raw.jobId === null ? null : requireString(raw.jobId, 'detail.run.jobId');
  if (context.expectedJobId !== null && jobId !== context.expectedJobId) {
    throw new AiApproverV02ClientError('identity_mismatch', 'V02 detail job ID does not match');
  }
  const counts: AiApproverV02Counts = {
    plannedEligibleCount: requireNonnegativeInteger(
      raw.plannedEligibleCount,
      'detail.run.plannedEligibleCount'
    ),
    attemptedCount: requireNonnegativeInteger(raw.attemptedCount, 'detail.run.attemptedCount'),
    completedCount: requireNonnegativeInteger(raw.completedCount, 'detail.run.completedCount'),
    failedCount: requireNonnegativeInteger(raw.failedCount, 'detail.run.failedCount'),
    invalidResponseCount: requireNonnegativeInteger(
      raw.invalidResponseCount,
      'detail.run.invalidResponseCount'
    ),
    skippedCount: requireNonnegativeInteger(raw.skippedCount, 'detail.run.skippedCount')
  };
  if (counts.plannedEligibleCount > context.expectedInputs.requestedArticleCount) {
    throw new AiApproverV02ClientError('malformed_response', 'V02 planned count exceeds the request');
  }
  if (status === 'completed') {
    if (
      counts.plannedEligibleCount !== counts.attemptedCount + counts.skippedCount ||
      counts.attemptedCount !==
        counts.completedCount + counts.failedCount + counts.invalidResponseCount
    ) {
      throw new AiApproverV02ClientError('malformed_response', 'V02 completed counters are inconsistent');
    }
  }
  const createdAt = requireTimestamp(raw.createdAt, 'detail.run.createdAt');
  if (Date.parse(createdAt) < Date.parse(context.previewCreatedAt)) {
    throw new AiApproverV02ClientError(
      'identity_mismatch',
      'V02 detail run predates its persisted preview'
    );
  }
  const startedAt = optionalString(raw.startedAt, 'detail.run.startedAt');
  const endedAt = optionalString(raw.endedAt, 'detail.run.endedAt');
  if (startedAt && !Number.isFinite(Date.parse(startedAt))) {
    throw new AiApproverV02ClientError('malformed_response', 'detail.run.startedAt is invalid');
  }
  if (endedAt && !Number.isFinite(Date.parse(endedAt))) {
    throw new AiApproverV02ClientError('malformed_response', 'detail.run.endedAt is invalid');
  }
  if ((status === 'running' || status === 'completed') && !startedAt) {
    throw new AiApproverV02ClientError('malformed_response', 'V02 active or completed run lacks startedAt');
  }
  if (['completed', 'failed', 'canceled', 'circuit_breaker'].includes(status) && !endedAt) {
    throw new AiApproverV02ClientError('malformed_response', 'V02 terminal run lacks endedAt');
  }
  if (startedAt && Date.parse(startedAt) < Date.parse(createdAt)) {
    throw new AiApproverV02ClientError('malformed_response', 'V02 run started before creation');
  }
  if (endedAt && Date.parse(endedAt) < Date.parse(startedAt ?? createdAt)) {
    throw new AiApproverV02ClientError('malformed_response', 'V02 run timestamps are not chronological');
  }
  return {
    v02RunId,
    status,
    jobId,
    ...context.expectedInputs,
    ...counts,
    createdAt,
    ...(startedAt ? { startedAt } : {}),
    ...(endedAt ? { endedAt } : {}),
    ...(optionalString(raw.endingReason, 'detail.run.endingReason')
      ? { endingReason: optionalString(raw.endingReason, 'detail.run.endingReason') }
      : {})
  };
};

const parseQueue = (
  raw: unknown,
  run: AiApproverV02Run,
  context: AiApproverV02DetailContext
): AiApproverV02QueueRecord | null => {
  if (raw === null || raw === undefined) return null;
  if (!isRecord(raw)) {
    throw new AiApproverV02ClientError('malformed_response', 'V02 queue status must be an object');
  }
  const jobId = requireString(raw.jobId, 'detail.queueStatus.jobId');
  if (run.jobId === null || jobId !== run.jobId || (context.expectedJobId && jobId !== context.expectedJobId)) {
    throw new AiApproverV02ClientError('identity_mismatch', 'V02 queue job identity does not match');
  }
  if (raw.endpointName !== AI_APPROVER_V02_ENDPOINT_NAME) {
    throw new AiApproverV02ClientError('identity_mismatch', 'V02 queue endpoint does not match');
  }
  if (!queueStatuses.has(raw.status as AiApproverV02QueueStatus)) {
    throw new AiApproverV02ClientError('malformed_response', 'V02 queue status is invalid');
  }
  if (!isRecord(raw.parameters) || Object.keys(raw.parameters).length !== 1) {
    throw new AiApproverV02ClientError('identity_mismatch', 'V02 queue parameters are invalid');
  }
  const parameterRunId = requirePositiveInteger(
    raw.parameters.runId,
    'detail.queueStatus.parameters.runId'
  );
  if (parameterRunId !== context.expectedV02RunId) {
    throw new AiApproverV02ClientError('identity_mismatch', 'V02 queue run ID does not match');
  }
  const status = raw.status as AiApproverV02QueueStatus;
  const createdAt = requireTimestamp(raw.createdAt, 'detail.queueStatus.createdAt');
  const startedAt = optionalString(raw.startedAt, 'detail.queueStatus.startedAt');
  const endedAt = optionalString(raw.endedAt, 'detail.queueStatus.endedAt');
  if (Date.parse(createdAt) < Date.parse(run.createdAt)) {
    throw new AiApproverV02ClientError('identity_mismatch', 'V02 queue job predates the V02 run');
  }
  if ((status === 'running' || status === 'completed') && !startedAt) {
    throw new AiApproverV02ClientError('malformed_response', 'V02 queue lifecycle lacks startedAt');
  }
  if (['completed', 'failed', 'canceled'].includes(status) && !endedAt) {
    throw new AiApproverV02ClientError('malformed_response', 'V02 terminal queue record lacks endedAt');
  }
  if (startedAt && Date.parse(startedAt) < Date.parse(createdAt)) {
    throw new AiApproverV02ClientError('malformed_response', 'V02 queue started before creation');
  }
  if (endedAt && Date.parse(endedAt) < Date.parse(startedAt ?? createdAt)) {
    throw new AiApproverV02ClientError('malformed_response', 'V02 queue timestamps are not chronological');
  }
  return {
    jobId,
    endpointName: AI_APPROVER_V02_ENDPOINT_NAME,
    status,
    createdAt,
    parameters: { runId: parameterRunId },
    ...(startedAt ? { startedAt } : {}),
    ...(endedAt ? { endedAt } : {}),
    ...(optionalString(raw.failureReason, 'detail.queueStatus.failureReason')
      ? { failureReason: optionalString(raw.failureReason, 'detail.queueStatus.failureReason') }
      : {})
  };
};

export const parseAiApproverV02Detail = (
  body: unknown,
  context: AiApproverV02DetailContext
): AiApproverV02Detail => {
  if (!isRecord(body) || !isRecord(body.run)) {
    throw new AiApproverV02ClientError('malformed_response', 'V02 detail must contain a run object');
  }
  const run = parseRun(body.run, context);
  return { run, queueStatus: parseQueue(body.queueStatus, run, context) };
};

export const getAiApproverV02Detail = async (
  settings: AiApproverV02ClientSettings,
  context: AiApproverV02DetailContext,
  request: AiApproverV02Request
): Promise<AiApproverV02Detail> => {
  const { response, body } = await requestWorker(
    settings,
    `/ai-approver-v02/runs/${context.expectedV02RunId}`,
    { method: 'GET' },
    request,
    'AI Approver V02 detail request'
  );
  if (response.status === 404) {
    const accepted = context.acceptanceObserved || context.expectedJobId !== null;
    throw new AiApproverV02ClientError(
      accepted ? 'accepted_run_unavailable' : 'unavailable_unaccepted_preview',
      accepted
        ? 'Accepted AI Approver V02 run returned HTTP 404'
        : 'Unaccepted AI Approver V02 preview returned HTTP 404',
      404
    );
  }
  if (!response.ok) {
    throw new AiApproverV02ClientError(
      isTransientStatus(response.status) ? 'transient_request' : 'permanent_request',
      `AI Approver V02 detail returned HTTP ${response.status}`,
      response.status
    );
  }
  return parseAiApproverV02Detail(body, context);
};

export const cancelAiApproverV02 = async (
  settings: AiApproverV02ClientSettings,
  v02RunId: number,
  expectedJobId: string,
  request: AiApproverV02Request
): Promise<'canceled' | 'cancel_requested'> => {
  const { response, body } = await requestWorker(
    settings,
    `/ai-approver-v02/runs/${v02RunId}/cancel`,
    { method: 'POST' },
    request,
    'AI Approver V02 cancellation request'
  );
  if (!response.ok || !isRecord(body)) {
    throw new AiApproverV02ClientError(
      'cancellation_failure',
      `AI Approver V02 cancellation returned HTTP ${response.status}`,
      response.status
    );
  }
  if (
    body.runId !== v02RunId ||
    body.jobId !== expectedJobId ||
    !['canceled', 'cancel_requested'].includes(String(body.outcome))
  ) {
    throw new AiApproverV02ClientError(
      'cancellation_failure',
      'AI Approver V02 cancellation response is invalid'
    );
  }
  return body.outcome as 'canceled' | 'cancel_requested';
};

export interface AiApproverV02Worker {
  preview(inputs: AiApproverV02Inputs): Promise<AiApproverV02PreviewResult>;
  start(v02RunId: number, previewToken: string): Promise<AiApproverV02StartResult>;
  detail(context: AiApproverV02DetailContext): Promise<AiApproverV02Detail>;
  cancel(v02RunId: number, expectedJobId: string): Promise<'canceled' | 'cancel_requested'>;
}

export const createAiApproverV02Worker = (
  settings: AiApproverV02ClientSettings,
  request: AiApproverV02Request
): AiApproverV02Worker => ({
  preview: (inputs) => previewAiApproverV02(settings, inputs, request),
  start: (v02RunId, previewToken) => startAiApproverV02(settings, v02RunId, previewToken, request),
  detail: (context) => getAiApproverV02Detail(settings, context, request),
  cancel: (v02RunId, expectedJobId) =>
    cancelAiApproverV02(settings, v02RunId, expectedJobId, request)
});
