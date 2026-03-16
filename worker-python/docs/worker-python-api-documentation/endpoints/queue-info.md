# Queue info endpoints

These endpoints provide cross-cutting visibility into the global job queue. They are not scoped to a single worker (e.g. deduper) — they operate on all jobs regardless of which endpoint enqueued them.

## GET /queue-info/check-status/{job_id}

Returns the full record for a single job by its queue job ID.

### parameters

- Path: `job_id` (string) — the queue job identifier returned from job creation

### Sample Request

```bash
curl --location 'http://localhost:5000/queue-info/check-status/abc-123'
```

### Sample Response

```json
{
  "job": {
    "jobId": "abc-123",
    "endpointName": "/deduper/start-job",
    "status": "completed",
    "createdAt": "2026-02-25T15:12:19.147420+00:00",
    "startedAt": "2026-02-25T15:12:19.149871+00:00",
    "endedAt": "2026-02-25T15:12:22.481555+00:00",
    "failureReason": null,
    "logs": [],
    "parameters": null,
    "result": null
  }
}
```

### Error responses

- `400`: `job_id` is empty or whitespace-only
- `404`: No job found with the given ID — `{"error": "Job not found: abc-123"}`

## GET /queue-info/latest-job

Returns the most recent job matching the given endpoint name, or `null` if none exists.

### parameters

- Query: `endpointName` (string, required) — the endpoint name used when the job was enqueued (e.g. `/deduper/start-job`)

### Sample Request

```bash
curl --location 'http://localhost:5000/queue-info/latest-job?endpointName=/deduper/start-job'
```

### Sample Response

```json
{
  "job": {
    "jobId": "abc-456",
    "endpointName": "/deduper/start-job",
    "status": "running",
    "createdAt": "2026-02-25T15:14:01.006940+00:00",
    "startedAt": "2026-02-25T15:14:01.009871+00:00",
    "endedAt": null,
    "failureReason": null,
    "logs": [],
    "parameters": null,
    "result": null
  }
}
```

When no job matches the endpoint name, `job` is `null`:

```json
{
  "job": null
}
```

### Error responses

- `400`: `endpointName` query parameter is missing or empty — `{"error": "endpointName query parameter is required"}`

## GET /queue-info/queue-status

Returns a summary of all jobs in the queue plus details on the currently running job and any queued (waiting) jobs.

### parameters

- None

### Sample Request

```bash
curl --location 'http://localhost:5000/queue-info/queue-status'
```

### Sample Response

```json
{
  "summary": {
    "totalJobs": 5,
    "queued": 1,
    "running": 1,
    "completed": 2,
    "failed": 1,
    "canceled": 0
  },
  "runningJob": {
    "jobId": "abc-123",
    "endpointName": "/deduper/start-job",
    "status": "running",
    "createdAt": "2026-02-25T15:12:19.147420+00:00",
    "startedAt": "2026-02-25T15:12:19.149871+00:00",
    "endedAt": null,
    "failureReason": null,
    "logs": [],
    "parameters": null,
    "result": null
  },
  "queuedJobs": [
    {
      "jobId": "abc-456",
      "endpointName": "/deduper/start-job",
      "status": "queued",
      "createdAt": "2026-02-25T15:13:01.006940+00:00",
      "startedAt": null,
      "endedAt": null,
      "failureReason": null,
      "logs": [],
      "parameters": null,
      "result": null
    }
  ]
}
```

When the queue is idle, `runningJob` is `null` and `queuedJobs` is `[]`.

### Error responses

- `500`: Internal server error

## POST /queue-info/cancel-job/{job_id}

Requests cancellation of a queued or running job.

- If the job is **queued** (waiting), it is removed from the queue immediately.
- If the job is **running**, a cancel signal is sent. The job must check for cancellation cooperatively via `context.is_cancel_requested()`.

### parameters

- Path: `job_id` (string) — the queue job identifier

### Sample Request

```bash
curl --location --request POST 'http://localhost:5000/queue-info/cancel-job/abc-123'
```

### Sample Response

```json
{
  "jobId": "abc-123",
  "outcome": "cancel_requested"
}
```

Possible `outcome` values:

| outcome | meaning |
|---------|---------|
| `cancel_requested` | Job was running; cancel signal sent |
| `canceled` | Job was queued and has been removed before starting |

### Error responses

- `400`: `job_id` is empty or whitespace-only
- `404`: No job found with the given ID — `{"error": "Job not found: abc-123"}`
