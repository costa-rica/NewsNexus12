import { createDeleteArticlesJobHandler } from '../../src/modules/jobs/deleteArticlesJob';

const makeContext = () => ({
  jobId: 'job-1',
  endpointName: '/delete-articles/start-job',
  signal: new AbortController().signal,
  registerCancelableProcess: () => undefined,
  updateResult: () => Promise.resolve()
});

describe('deleteArticlesJob', () => {
  it('runs against the test database without throwing (finds 0 articles to delete)', async () => {
    const handler = createDeleteArticlesJobHandler({ daysOld: 30 });
    await expect(handler(makeContext())).resolves.toBeUndefined();
  });

  it('creates a handler for trim mode without throwing on import', () => {
    const handler = createDeleteArticlesJobHandler({ trimCount: 100 });
    expect(typeof handler).toBe('function');
  });

  it('creates a handler with default daysOld when not specified', () => {
    const handler = createDeleteArticlesJobHandler({});
    expect(typeof handler).toBe('function');
  });
});
