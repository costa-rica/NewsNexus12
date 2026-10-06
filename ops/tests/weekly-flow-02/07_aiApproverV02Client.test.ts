import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AiApproverV02ClientError,
  cancelAiApproverV02,
  getAiApproverV02Detail,
  parseAiApproverV02Detail,
  previewAiApproverV02,
  startAiApproverV02,
  type AiApproverV02DetailContext,
  type AiApproverV02Inputs,
  type AiApproverV02Request
} from '../../src/weekly-flow-02/phases/07_aiApproverV02Client';

const settings = { baseUrl: 'http://worker.test:5000/', requestTimeoutSeconds: 60 };
const inputs: AiApproverV02Inputs = {
  selectionMode: 'article_position_count',
  requestedArticleCount: 2,
  allowPastApprovedBoundary: true,
  allowDescriptionFallback: true
};

const previewBody = {
  id: 41,
  status: 'draft',
  jobId: null,
  ...inputs,
  plannedEligibleCount: 2,
  selectionSnapshot: [
    { articleId: 20, contentSource: 'article_contents_02' },
    { articleId: 19, contentSource: 'description' }
  ],
  previewToken: 'secret-token',
  createdAt: '2026-10-06T18:00:00Z',
  previewExpiresAt: '2026-10-06T18:15:00Z'
};

const context = (overrides: Partial<AiApproverV02DetailContext> = {}): AiApproverV02DetailContext => ({
  expectedV02RunId: 41,
  expectedInputs: inputs,
  previewCreatedAt: '2026-10-06T18:00:00Z',
  expectedJobId: '0007',
  acceptanceObserved: true,
  ...overrides
});

const completedDetail = {
  run: {
    id: 41,
    status: 'completed',
    jobId: '0007',
    ...inputs,
    plannedEligibleCount: 2,
    attemptedCount: 2,
    completedCount: 1,
    failedCount: 1,
    invalidResponseCount: 0,
    skippedCount: 0,
    endingReason: 'selection_exhausted',
    createdAt: '2026-10-06T18:00:00Z',
    startedAt: '2026-10-06T18:01:00Z',
    endedAt: '2026-10-06T18:03:00Z'
  },
  queueStatus: {
    jobId: '0007',
    endpointName: '/ai-approver-v02/start',
    status: 'completed',
    createdAt: '2026-10-06T18:00:30Z',
    startedAt: '2026-10-06T18:01:00Z',
    endedAt: '2026-10-06T18:03:01Z',
    parameters: { runId: 41 }
  }
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });

describe('AI Approver V02 client', () => {
  it('sends the exact preview body and validates the frozen selection', async () => {
    let receivedBody: unknown;
    const request: AiApproverV02Request = async (url, init) => {
      assert.equal(url.pathname, '/ai-approver-v02/preview');
      receivedBody = JSON.parse(String(init.body));
      return jsonResponse(previewBody);
    };

    const result = await previewAiApproverV02(settings, inputs, request);

    assert.deepEqual(receivedBody, inputs);
    assert.equal(result.kind, 'work');
    if (result.kind === 'work') {
      assert.equal(result.preview.v02RunId, 41);
      assert.equal(result.preview.previewToken, 'secret-token');
    }
  });

  it('recognizes only the typed zero-work response', async () => {
    const zero = await previewAiApproverV02(
      settings,
      inputs,
      async () => jsonResponse({ error: 'no_eligible_articles' }, 400)
    );
    assert.deepEqual(zero, { kind: 'zero_work' });

    await assert.rejects(
      previewAiApproverV02(
        settings,
        inputs,
        async () => jsonResponse({ error: 'invalid_request' }, 400)
      ),
      (error: unknown) =>
        error instanceof AiApproverV02ClientError && error.category === 'permanent_request'
    );
  });

  it('sends only the run ID and token to start without exposing the token in the result', async () => {
    let body: Record<string, unknown> = {};
    const result = await startAiApproverV02(settings, 41, 'secret-token', async (_url, init) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return jsonResponse({ runId: 41, jobId: '0007', status: 'queued' }, 202);
    });

    assert.deepEqual(body, { runId: 41, previewToken: 'secret-token' });
    assert.deepEqual(result, { v02RunId: 41, jobId: '0007', status: 'queued' });
    assert.equal(JSON.stringify(result).includes('secret-token'), false);
  });

  it('classifies typed start conflicts', async () => {
    await assert.rejects(
      startAiApproverV02(
        settings,
        41,
        'secret-token',
        async () => jsonResponse({ error: 'v02_run_conflict' }, 409)
      ),
      (error: unknown) =>
        error instanceof AiApproverV02ClientError && error.category === 'start_conflict'
    );
  });

  it('validates durable completion and queue identity', () => {
    const result = parseAiApproverV02Detail(completedDetail, context());
    assert.equal(result.run.status, 'completed');
    assert.equal(result.run.completedCount, 1);
    assert.equal(result.queueStatus?.parameters.runId, 41);
  });

  it('accepts authoritative durable completion without queue status', () => {
    const result = parseAiApproverV02Detail(
      { ...completedDetail, queueStatus: null },
      context()
    );
    assert.equal(result.run.status, 'completed');
    assert.equal(result.queueStatus, null);
  });

  it('rejects inconsistent counters and queue identities', () => {
    assert.throws(
      () =>
        parseAiApproverV02Detail(
          {
            ...completedDetail,
            run: { ...completedDetail.run, attemptedCount: 1 }
          },
          context()
        ),
      (error: unknown) =>
        error instanceof AiApproverV02ClientError && error.category === 'malformed_response'
    );
    assert.throws(
      () =>
        parseAiApproverV02Detail(
          {
            ...completedDetail,
            queueStatus: { ...completedDetail.queueStatus, jobId: '9999' }
          },
          context()
        ),
      (error: unknown) =>
        error instanceof AiApproverV02ClientError && error.category === 'identity_mismatch'
    );
  });

  it('classifies 404 by persisted acceptance evidence', async () => {
    for (const [acceptanceObserved, expectedCategory] of [
      [false, 'unavailable_unaccepted_preview'],
      [true, 'accepted_run_unavailable']
    ] as const) {
      await assert.rejects(
        getAiApproverV02Detail(
          settings,
          context({ acceptanceObserved, expectedJobId: null }),
          async () => jsonResponse({ error: 'run_not_found' }, 404)
        ),
        (error: unknown) =>
          error instanceof AiApproverV02ClientError && error.category === expectedCategory
      );
    }
  });

  it('does not compare worker timestamps with the ops clock', () => {
    assert.doesNotThrow(() => parseAiApproverV02Detail(completedDetail, context()));
  });

  it('accepts only verified cancellation outcomes', async () => {
    const outcome = await cancelAiApproverV02(
      settings,
      41,
      '0007',
      async () => jsonResponse({ runId: 41, jobId: '0007', outcome: 'cancel_requested' })
    );
    assert.equal(outcome, 'cancel_requested');

    await assert.rejects(
      cancelAiApproverV02(
        settings,
        41,
        '0007',
        async () => jsonResponse({ runId: 41, jobId: '0007', outcome: 'not_found' })
      ),
      (error: unknown) =>
        error instanceof AiApproverV02ClientError && error.category === 'cancellation_failure'
    );
  });
});
