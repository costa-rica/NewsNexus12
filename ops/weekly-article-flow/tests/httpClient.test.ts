import { WorkerHttpClient } from '../src/http';

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' }
});

describe('worker HTTP client', () => {
  it('uses each worker queue route spelling and preserves the allowlisted origin', async () => {
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ totalJobs: 0, queued: 0, running: 0, completed: 0, failed: 0, canceled: 0 }))
      .mockResolvedValueOnce(jsonResponse({ totalJobs: 0, queued: 0, running: 0, completed: 0, failed: 0, canceled: 0 }))
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

    await expect(client.requestJson('node', '/slow')).rejects.toThrow('timed out');
  });
});
