import { getActiveOrchestratorRunId, invalidateActiveRunCache } from '../../src/modules/orchestrator/activeRunGuard';

const mockQuery = jest.fn();

jest.mock('@newsnexus/db-models', () => ({
  sequelize: {
    query: (...args: unknown[]) => mockQuery(...args),
  },
}));

describe('activeRunGuard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidateActiveRunCache();
  });

  it('returns null when no active run exists', async () => {
    mockQuery.mockResolvedValueOnce([[], undefined]);

    const runId = await getActiveOrchestratorRunId();

    expect(runId).toBeNull();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('returns the run id when an active run exists', async () => {
    mockQuery.mockResolvedValueOnce([[{ id: 42 }], undefined]);

    const runId = await getActiveOrchestratorRunId();

    expect(runId).toBe(42);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('caches the result for subsequent calls within TTL', async () => {
    mockQuery.mockResolvedValueOnce([[{ id: 7 }], undefined]);

    const first = await getActiveOrchestratorRunId();
    const second = await getActiveOrchestratorRunId();

    expect(first).toBe(7);
    expect(second).toBe(7);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('re-queries after cache is invalidated', async () => {
    mockQuery.mockResolvedValueOnce([[{ id: 1 }], undefined]);
    mockQuery.mockResolvedValueOnce([[], undefined]);

    const first = await getActiveOrchestratorRunId();
    invalidateActiveRunCache();
    const second = await getActiveOrchestratorRunId();

    expect(first).toBe(1);
    expect(second).toBeNull();
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('returns null and logs a warning when the query fails', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB connection failed'));

    const runId = await getActiveOrchestratorRunId();

    expect(runId).toBeNull();
  });
});
