import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SEMANTIC_SCORER_ENDPOINT_NAME,
  SemanticScorerClientError,
  cancelSemanticScorerJob,
  getSemanticScorerJobStatus,
  parseSemanticScorerStartResponse,
  parseSemanticScorerStatusResponse,
  startSemanticScorerJob,
  type SemanticScorerJobStatus,
  type SemanticScorerRequest
} from '../../src/weekly-flow-02/phases/05_semanticScorerClient';

const phaseStartedAt = new Date('2026-10-05T08:00:00Z');
const settings = { baseUrl: 'http://worker.test:3002/', requestTimeoutSeconds: 60 };
const response = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const rawJob = (status: SemanticScorerJobStatus, overrides: Record<string, unknown> = {}) => ({
  jobId: 'job-5', endpointName: SEMANTIC_SCORER_ENDPOINT_NAME, status,
  createdAt: '2026-10-05T09:00:00Z',
  ...(['running', 'completed'].includes(status) ? { startedAt: '2026-10-05T09:01:00Z' } : {}),
  ...(['completed', 'failed', 'canceled'].includes(status) ? { endedAt: '2026-10-05T09:02:00Z' } : {}),
  ...overrides
});
const parse = (status: SemanticScorerJobStatus, overrides = {}) =>
  parseSemanticScorerStatusResponse(
    { job: rawJob(status, overrides) },
    { expectedJobId: 'job-5', phaseStartedAt }
  );

describe('semantic scorer client', () => {
  it('starts with exactly an empty JSON body', async () => {
    const request: SemanticScorerRequest = async (url, init) => {
      assert.equal(url.pathname, SEMANTIC_SCORER_ENDPOINT_NAME);
      assert.deepEqual(JSON.parse(String(init.body)), {});
      assert.ok(init.signal instanceof AbortSignal);
      return response({ jobId: 'job-5', status: 'queued', endpointName: SEMANTIC_SCORER_ENDPOINT_NAME }, 202);
    };
    assert.equal((await startSemanticScorerJob(settings, request)).jobId, 'job-5');
  });

  it('rejects malformed start responses', () => {
    for (const body of [null, {}, { jobId: 'x', status: 'running', endpointName: SEMANTIC_SCORER_ENDPOINT_NAME }]) {
      assert.throws(() => parseSemanticScorerStartResponse(body), SemanticScorerClientError);
    }
  });

  it('validates timestamp requirements for every lifecycle state', () => {
    for (const status of ['queued', 'running', 'completed', 'failed', 'canceled'] as const) {
      assert.equal(parse(status).status, status);
    }
    assert.equal(parse('canceled', { startedAt: undefined }).startedAt, undefined);
    assert.equal(parse('failed', { startedAt: undefined, failureReason: 'worker_restart' }).startedAt, undefined);
    assert.throws(() => parse('running', { startedAt: undefined }), SemanticScorerClientError);
    assert.throws(() => parse('completed', { startedAt: undefined }), SemanticScorerClientError);
    assert.throws(() => parse('failed', { endedAt: undefined }), SemanticScorerClientError);
  });

  it('rejects unavailable identity and malformed chronology', () => {
    for (const overrides of [
      { jobId: 'other' },
      { endpointName: '/other' },
      { createdAt: '2026-10-05T07:59:59Z' }
    ]) {
      assert.throws(
        () => parse('running', overrides),
        (error: unknown) => error instanceof SemanticScorerClientError && error.category === 'unavailable_job'
      );
    }
    assert.throws(() => parse('completed', { endedAt: '2026-10-05T09:00:30Z' }), SemanticScorerClientError);
  });

  it('distinguishes start, status, and cancellation 404 behavior', async () => {
    await assert.rejects(
      startSemanticScorerJob(settings, async () => response({}, 404)),
      (error: unknown) => error instanceof SemanticScorerClientError && error.category === 'permanent_request'
    );
    await assert.rejects(
      getSemanticScorerJobStatus(settings, { expectedJobId: 'job-5', phaseStartedAt }, async () => response({}, 404)),
      (error: unknown) => error instanceof SemanticScorerClientError && error.category === 'unavailable_job'
    );
    assert.equal(await cancelSemanticScorerJob(settings, 'job-5', async () => response({}, 404)), 'not_found');
  });

  it('parses cancellation outcomes and rejects invalid results', async () => {
    for (const outcome of ['canceled', 'cancel_requested'] as const) {
      assert.equal(
        await cancelSemanticScorerJob(settings, 'job-5', async () => response({ jobId: 'job-5', outcome })),
        outcome
      );
    }
    await assert.rejects(
      cancelSemanticScorerJob(settings, 'job-5', async () => response({ jobId: 'job-5', outcome: 'done' })),
      (error: unknown) => error instanceof SemanticScorerClientError && error.category === 'cancellation_failure'
    );
  });
});
