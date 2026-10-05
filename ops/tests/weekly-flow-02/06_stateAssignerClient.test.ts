import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  STATE_ASSIGNER_ENDPOINT_NAME,
  StateAssignerClientError,
  cancelStateAssignerJob,
  getStateAssignerJobStatus,
  parseStateAssignerStartResponse,
  parseStateAssignerStatusResponse,
  startStateAssignerJob,
  type StateAssignerJobStatus,
  type StateAssignerRequest
} from '../../src/weekly-flow-02/phases/06_stateAssignerClient';

const phaseStartedAt = new Date('2026-10-05T08:00:00Z');
const inputs = {
  targetArticleThresholdDaysOld: 180,
  targetArticleStateReviewCount: 10
};
const settings = { baseUrl: 'http://worker.test:3002/', requestTimeoutSeconds: 60 };
const response = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
const result = {
  selectedCount: 10,
  completedCount: 7,
  skippedCount: 2,
  failedCount: 1,
  ...inputs
};
const rawJob = (status: StateAssignerJobStatus, overrides: Record<string, unknown> = {}) => ({
  jobId: 'job-6',
  endpointName: STATE_ASSIGNER_ENDPOINT_NAME,
  status,
  createdAt: '2026-10-05T09:00:00Z',
  parameters: inputs,
  ...(['running', 'completed'].includes(status)
    ? { startedAt: '2026-10-05T09:01:00Z' }
    : {}),
  ...(['completed', 'failed', 'canceled'].includes(status)
    ? { endedAt: '2026-10-05T09:02:00Z' }
    : {}),
  ...(status === 'completed' ? { result } : {}),
  ...overrides
});
const parse = (status: StateAssignerJobStatus, overrides: Record<string, unknown> = {}) =>
  parseStateAssignerStatusResponse(
    { job: rawJob(status, overrides) },
    { expectedJobId: 'job-6', phaseStartedAt, expectedInputs: inputs }
  );

describe('state assigner client', () => {
  it('starts with exactly the persisted Phase 6 inputs', async () => {
    const request: StateAssignerRequest = async (url, init) => {
      assert.equal(url.pathname, STATE_ASSIGNER_ENDPOINT_NAME);
      assert.deepEqual(JSON.parse(String(init.body)), inputs);
      assert.ok(init.signal instanceof AbortSignal);
      return response(
        { jobId: 'job-6', status: 'queued', endpointName: STATE_ASSIGNER_ENDPOINT_NAME },
        202
      );
    };

    assert.equal((await startStateAssignerJob(settings, inputs, request)).jobId, 'job-6');
  });

  it('rejects malformed start responses', () => {
    for (const body of [
      null,
      {},
      { jobId: 'job-6', status: 'running', endpointName: STATE_ASSIGNER_ENDPOINT_NAME }
    ]) {
      assert.throws(() => parseStateAssignerStartResponse(body), StateAssignerClientError);
    }
  });

  it('validates lifecycle timestamp requirements', () => {
    for (const status of ['queued', 'running', 'completed', 'failed', 'canceled'] as const) {
      const parsed = parse(status);
      assert.equal(parsed.job.status, status);
    }
    assert.equal(parse('failed', { startedAt: undefined }).job.startedAt, undefined);
    assert.equal(parse('canceled', { startedAt: undefined }).job.startedAt, undefined);
    assert.throws(() => parse('running', { startedAt: undefined }), StateAssignerClientError);
    assert.throws(() => parse('completed', { endedAt: undefined }), StateAssignerClientError);
    assert.throws(
      () => parse('completed', { endedAt: '2026-10-05T09:00:30Z' }),
      StateAssignerClientError
    );
  });

  it('rejects unavailable job identity', () => {
    for (const overrides of [
      { jobId: 'other' },
      { endpointName: '/other' },
      { createdAt: '2026-10-05T07:59:59Z' },
      { parameters: { ...inputs, targetArticleStateReviewCount: 11 } }
    ]) {
      assert.throws(
        () => parse('running', overrides),
        (error: unknown) =>
          error instanceof StateAssignerClientError && error.category === 'unavailable_job'
      );
    }
  });

  it('returns incompatible lifecycle data for missing parameters', () => {
    const missingObject = parse('running', { parameters: undefined });
    assert.equal(missingObject.kind, 'incompatible_contract');
    if (missingObject.kind === 'incompatible_contract') {
      assert.deepEqual(missingObject.missingParameterFields, [
        'targetArticleThresholdDaysOld',
        'targetArticleStateReviewCount'
      ]);
      assert.equal(missingObject.job.status, 'running');
    }

    const missingKey = parse('failed', {
      parameters: { targetArticleThresholdDaysOld: 180 }
    });
    assert.equal(missingKey.kind, 'incompatible_contract');
    if (missingKey.kind === 'incompatible_contract') {
      assert.deepEqual(missingKey.missingParameterFields, ['targetArticleStateReviewCount']);
    }
  });

  it('rejects malformed parameter types without classifying them as unavailable', () => {
    assert.throws(
      () => parse('running', { parameters: { ...inputs, targetArticleStateReviewCount: '10' } }),
      (error: unknown) =>
        error instanceof StateAssignerClientError && error.category === 'malformed_response'
    );
  });

  it('validates completed result counts and input echoes', () => {
    const parsed = parse('completed');
    assert.equal(parsed.kind, 'compatible');
    if (parsed.kind === 'compatible') assert.deepEqual(parsed.job.result, result);

    for (const invalidResult of [
      undefined,
      { ...result, selectedCount: -1 },
      { ...result, failedCount: 1.5 },
      { ...result, completedCount: 6 },
      { ...result, selectedCount: 11, completedCount: 8 },
      { ...result, targetArticleThresholdDaysOld: 90 }
    ]) {
      assert.throws(
        () => parse('completed', { result: invalidResult }),
        (error: unknown) =>
          error instanceof StateAssignerClientError && error.category === 'malformed_response'
      );
    }
  });

  it('distinguishes start, status, and cancellation 404 behavior', async () => {
    await assert.rejects(
      startStateAssignerJob(settings, inputs, async () => response({}, 404)),
      (error: unknown) =>
        error instanceof StateAssignerClientError && error.category === 'permanent_request'
    );
    await assert.rejects(
      getStateAssignerJobStatus(
        settings,
        { expectedJobId: 'job-6', phaseStartedAt, expectedInputs: inputs },
        async () => response({}, 404)
      ),
      (error: unknown) =>
        error instanceof StateAssignerClientError && error.category === 'unavailable_job'
    );
    assert.equal(
      await cancelStateAssignerJob(settings, 'job-6', async () => response({}, 404)),
      'not_found'
    );
  });

  it('parses cancellation outcomes and rejects invalid results', async () => {
    for (const outcome of ['canceled', 'cancel_requested'] as const) {
      assert.equal(
        await cancelStateAssignerJob(settings, 'job-6', async () =>
          response({ jobId: 'job-6', outcome })
        ),
        outcome
      );
    }
    await assert.rejects(
      cancelStateAssignerJob(settings, 'job-6', async () =>
        response({ jobId: 'job-6', outcome: 'done' })
      ),
      (error: unknown) =>
        error instanceof StateAssignerClientError && error.category === 'cancellation_failure'
    );
  });
});
