import {
  createV02Preview,
  pollV02Terminal,
  reconcileV02Outcomes
} from '../src/stages';
import { WorkerHttpClient, WorkerHttpError } from '../src/http';

const previewResponse = (selectedArticleIds: number[]) => ({
  id: 91,
  status: 'draft' as const,
  selectionMode: 'article_position_count' as const,
  requestedArticleCount: 4,
  allowDescriptionFallback: true,
  allowPastApprovedBoundary: true,
  plannedEligibleCount: selectedArticleIds.length,
  selectionSnapshot: selectedArticleIds.map((articleId) => ({ articleId })),
  previewToken: 'never-persist-this-value',
  previewExpiresAt: new Date(Date.now() + 60_000).toISOString()
});

describe('AI Approver V02 weekly stage', () => {
  it.each([
    ['zero', [10, 11], [1, 2, 3, 4], 0],
    ['partial', [10, 11], [11, 12, 13, 14], 25],
    ['full', [11, 12, 13, 14], [11, 12, 13, 14], 100]
  ])('builds the exact Mode A body and treats %s overlap as visibility only', async (
    _label,
    selected,
    cohort,
    expectedPercentage
  ) => {
    const requestJson = jest.fn().mockResolvedValue(previewResponse(selected as number[]));
    const result = await createV02Preview({
      client: { requestJson } as unknown as WorkerHttpClient,
      requestedArticleCount: 4,
      cohortArticleIds: cohort as number[]
    });
    expect(requestJson).toHaveBeenCalledWith('python', '/ai-approver-v02/preview', {
      method: 'POST',
      body: JSON.stringify({
        selectionMode: 'article_position_count',
        requestedArticleCount: 4,
        allowDescriptionFallback: true,
        allowPastApprovedBoundary: true
      })
    });
    expect(result.evidence.overlapPercentage).toBe(expectedPercentage);
    expect(JSON.stringify(result.evidence)).not.toContain('never-persist-this-value');
  });

  it('rejects a preview that changes the requested count', async () => {
    const requestJson = jest.fn().mockResolvedValue({ ...previewResponse([1]), requestedArticleCount: 5 });
    await expect(createV02Preview({
      client: { requestJson } as unknown as WorkerHttpClient,
      requestedArticleCount: 4,
      cohortArticleIds: [1, 2, 3, 4]
    })).rejects.toThrow('selection contract');
  });

  it('waits for both terminal records and preserves a circuit breaker result', async () => {
    const requestJson = jest.fn()
      .mockResolvedValueOnce({
        run: { id: 91, jobId: 'job-91', status: 'circuit_breaker', endingReason: 'invalid_responses' },
        queueStatus: { jobId: 'job-91', status: 'running' }
      })
      .mockResolvedValueOnce({
        run: { id: 91, jobId: 'job-91', status: 'circuit_breaker', endingReason: 'invalid_responses' },
        queueStatus: { jobId: 'job-91', status: 'completed' }
      });
    await expect(pollV02Terminal({
      client: { requestJson } as unknown as WorkerHttpClient,
      v02RunId: 91,
      jobId: 'job-91',
      deadline: new Date(Date.now() + 2000),
      polling: { initialMs: 1, maxMs: 1 }
    })).resolves.toEqual(expect.objectContaining({
      runStatus: 'circuit_breaker',
      queueStatus: 'completed'
    }));
  });

  it('cancels best-effort when the V02 deadline is exhausted', async () => {
    const requestJson = jest.fn().mockResolvedValue({ outcome: 'cancel_requested' });
    await expect(pollV02Terminal({
      client: { requestJson } as unknown as WorkerHttpClient,
      v02RunId: 91,
      jobId: 'job-91',
      deadline: new Date(Date.now() - 1),
      polling: { initialMs: 1, maxMs: 1 }
    })).rejects.toThrow('timed out');
    expect(requestJson).toHaveBeenCalledWith('python', '/ai-approver-v02/runs/91/cancel', { method: 'POST' });
  });

  it('fails fast on permanent V02 polling errors', async () => {
    const requestJson = jest.fn().mockRejectedValue(new WorkerHttpError('not found', 404));
    await expect(pollV02Terminal({
      client: { requestJson } as unknown as WorkerHttpClient,
      v02RunId: 91,
      jobId: 'job-91',
      deadline: new Date(Date.now() + 1000),
      polling: { initialMs: 1, maxMs: 1 }
    })).rejects.toThrow('not found');
    expect(requestJson).toHaveBeenCalledTimes(1);
  });

  it('reconciles completed outcomes and identifies skipped IDs', () => {
    const result = reconcileV02Outcomes({
      run: {
        id: 91,
        jobId: 'job-91',
        status: 'completed',
        endingReason: null,
        attemptedCount: 2,
        completedCount: 1,
        failedCount: 1,
        invalidResponseCount: 0,
        skippedCount: 1,
        selectionSnapshot: [{ articleId: 3 }, { articleId: 2 }, { articleId: 1 }]
      } as never,
      selectedArticleIds: [3, 2, 1],
      predictions: [
        { articleId: 3, resultStatus: 'completed', prediction: 'approved' },
        { articleId: 1, resultStatus: 'failed', prediction: null }
      ]
    });
    expect(result.skippedArticleIds).toEqual([2]);
    expect(result.unattemptedCount).toBe(0);
  });

  it('reconciles skipped and unattempted IDs from the deterministic processed prefix', () => {
    const result = reconcileV02Outcomes({
      run: {
        id: 91,
        jobId: 'job-91',
        status: 'circuit_breaker',
        endingReason: 'codex_cli_failures',
        attemptedCount: 1,
        completedCount: 0,
        failedCount: 1,
        invalidResponseCount: 0,
        skippedCount: 1,
        selectionSnapshot: [{ articleId: 3 }, { articleId: 2 }, { articleId: 1 }]
      } as never,
      selectedArticleIds: [3, 2, 1],
      predictions: [{ articleId: 3, resultStatus: 'failed', prediction: null }]
    });
    expect(result.unresolvedArticleIds).toEqual([]);
    expect(result.skippedArticleIds).toEqual([2]);
    expect(result.unattemptedArticleIds).toEqual([1]);
    expect(result.unattemptedCount).toBe(1);
  });

  it('rejects a prediction outside the processed prefix', () => {
    expect(() => reconcileV02Outcomes({
      run: {
        id: 91, jobId: 'job-91', status: 'failed', endingReason: 'execution_failed',
        attemptedCount: 1, completedCount: 0, failedCount: 1, invalidResponseCount: 0,
        skippedCount: 0, selectionSnapshot: [{ articleId: 3 }, { articleId: 2 }, { articleId: 1 }]
      } as never,
      selectedArticleIds: [3, 2, 1],
      predictions: [{ articleId: 1, resultStatus: 'failed', prediction: null }]
    })).toThrow('processed frozen-selection prefix');
  });
});
