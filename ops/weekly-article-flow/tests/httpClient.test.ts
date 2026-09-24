import { WorkerHttpClient, WorkerHttpError } from '../src/http';

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' }
});

describe('worker HTTP client', () => {
  it('uses each worker queue route spelling and preserves the allowlisted origin', async () => {
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ summary: {}, runningJob: null, queuedJobs: [] }))
      .mockResolvedValueOnce(jsonResponse({ summary: {}, runningJob: null, queuedJobs: [] }))
      .mockResolvedValueOnce(jsonResponse({ outcome: 'canceled' }))
      .mockResolvedValueOnce(jsonResponse({ outcome: 'canceled' }));
    const client = new WorkerHttpClient({
      workerNodeUrl: new URL('http://127.0.0.1:3002'),
      workerPythonUrl: new URL('http://127.0.0.1:5000'),
      fetchFn
    });

    await client.getQueueStatus('node');
    await client.getQueueStatus('python');
    await client.cancelQueueJob('node', 'job 1');
    await client.cancelQueueJob('python', 'job 2');

    expect(String(fetchFn.mock.calls[0][0])).toBe('http://127.0.0.1:3002/queue-info/queue_status');
    expect(String(fetchFn.mock.calls[1][0])).toBe('http://127.0.0.1:5000/queue-info/queue-status');
    expect(String(fetchFn.mock.calls[2][0])).toContain('/cancel_job/job%201');
    expect(String(fetchFn.mock.calls[3][0])).toContain('/cancel-job/job%202');
  });

  it('polls with bounded backoff until a queue job is terminal', async () => {
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ job: { jobId: 'job-1', endpointName: '/test', status: 'running' } }))
      .mockResolvedValueOnce(jsonResponse({ job: { jobId: 'job-1', endpointName: '/test', status: 'completed', result: {} } }));
    const client = new WorkerHttpClient({
      workerNodeUrl: new URL('http://127.0.0.1:3002'),
      workerPythonUrl: new URL('http://127.0.0.1:5000'),
      fetchFn
    });

    const result = await client.pollQueueJob('node', 'job-1', {
      deadline: new Date(Date.now() + 1000),
      initialMs: 1,
      maxMs: 2
    });

    expect(result.status).toBe('completed');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('rejects origin escape attempts and redacts error bodies', async () => {
    const fetchFn = jest.fn().mockResolvedValue(new Response('token=super-secret', { status: 500 }));
    const client = new WorkerHttpClient({
      workerNodeUrl: new URL('http://127.0.0.1:3002'),
      workerPythonUrl: new URL('http://127.0.0.1:5000'),
      fetchFn
    });

    await expect(client.requestJson('node', '//evil.test/path')).rejects.toThrow('origin-relative');
    await expect(client.requestJson('node', '/failure')).rejects.toThrow('token=[redacted]');
    await expect(client.requestJson('node', '/failure')).rejects.not.toThrow('super-secret');
  });

  it('preserves nested transport causes and request context without retrying or leaking credentials', async () => {
    const cause = Object.assign(new Error('connect failed'), {
      code: 'ECONNREFUSED', syscall: 'connect', address: '127.0.0.1', port: 3002
    });
    const failure = new TypeError('fetch failed', {
      cause: new AggregateError([cause], 'connection failed token="private value" https://user:pass@example.test/?secret=hidden')
    });
    const fetchFn = jest.fn().mockRejectedValue(failure);
    const client = new WorkerHttpClient({
      workerNodeUrl: new URL('http://127.0.0.1:3002'),
      workerPythonUrl: new URL('http://127.0.0.1:5000'),
      fetchFn
    });
    const error = await client.requestJson('node', '/queue-info/check-status/job-1?token=query-secret')
      .catch((value: WorkerHttpError) => value);
    expect(error).toBeInstanceOf(WorkerHttpError);
    expect((error as WorkerHttpError).diagnostics).toMatchObject({
      worker: 'node', method: 'GET', endpoint: '/queue-info/check-status/job-1',
      durationMs: expect.any(Number), requestTimeoutMs: 30000, timedOut: false, status: null,
      error: { cause: { errors: [{ code: 'ECONNREFUSED', syscall: 'connect', address: '127.0.0.1', port: 3002 }] } }
    });
    const serialized = JSON.stringify(error);
    for (const secret of ['private value', 'user:pass', 'hidden', 'query-secret']) {
      expect(serialized).not.toContain(secret);
    }
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('records HTTP errors and invalid JSON with status and duration', async () => {
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response('invalid JSON', { status: 200 }));
    const client = new WorkerHttpClient({
      workerNodeUrl: new URL('http://127.0.0.1:3002'),
      workerPythonUrl: new URL('http://127.0.0.1:5000'), fetchFn
    });
    await expect(client.getQueueJob('node', 'job-1')).rejects.toMatchObject({
      diagnostics: { status: 503, durationMs: expect.any(Number), timedOut: false }
    });
    await expect(client.getQueueJob('node', 'job-1')).rejects.toMatchObject({
      message: 'worker returned invalid JSON', diagnostics: { status: 200 }
    });
  });

  it('rejects requests that exceed the bounded request timeout', async () => {
    const fetchFn = jest.fn((_input: URL | RequestInfo, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })) as unknown as typeof fetch;
    const client = new WorkerHttpClient({
      workerNodeUrl: new URL('http://127.0.0.1:3002'),
      workerPythonUrl: new URL('http://127.0.0.1:5000'),
      requestTimeoutMs: 5,
      fetchFn
    });

    await expect(client.requestJson('node', '/slow')).rejects.toMatchObject({
      message: 'worker request timed out', diagnostics: { timedOut: true, requestTimeoutMs: 5 }
    });
  });
});
