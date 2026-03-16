# Queue Info API

This router provides queue inspection and cancellation operations for worker-node jobs.

All endpoints are prefixed with `/queue-info`.

## GET /queue-info/check-status/:jobId

Returns a single job record by job ID.

- Does not require authentication
- Returns `404` if the job is not found

### Parameters

- `jobId` (string, required, URL parameter): Job identifier

### Sample Request

```bash
curl --location 'http://localhost:3002/queue-info/check-status/job-1'
```

### Sample Response

```json
{
  "job": {
    "jobId": "job-1",
    "endpointName": "/request-google-rss/start-job",
    "status": "completed",
    "createdAt": "2026-02-26T18:40:00.000Z",
    "startedAt": "2026-02-26T18:40:01.000Z",
    "endedAt": "2026-02-26T18:40:09.000Z"
  }
}
```

### Error responses

1. Job not found (404)

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Job not found: job-1",
    "status": 404
  }
}
```

## GET /queue-info/latest-job

Returns the most recent job record for a given worker-node endpoint name.

- Does not require authentication
- Returns `200` with `"job": null` when no matching jobs exist yet

### Parameters

- `endpointName` (string, required, query parameter): Worker-node endpoint name such as `/request-google-rss/start-job`

### Sample Request

```bash
curl --location 'http://localhost:3002/queue-info/latest-job?endpointName=%2Frequest-google-rss%2Fstart-job'
```

### Sample Response

```json
{
  "job": {
    "jobId": "job-14",
    "endpointName": "/request-google-rss/start-job",
    "status": "running",
    "createdAt": "2026-02-26T18:45:00.000Z",
    "startedAt": "2026-02-26T18:45:02.000Z"
  }
}
```

### Sample Response When No Matching Jobs Exist

```json
{
  "job": null
}
```

### Error responses

1. Missing or blank endpoint name (400)

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "status": 400,
    "details": [
      {
        "field": "endpointName",
        "message": "endpointName query parameter is required"
      }
    ]
  }
}
```

## GET /queue-info/queue_status

Returns queue summary and currently running/queued items.

- Does not require authentication
- Useful for dashboard polling and operational checks

### Parameters

None

### Sample Request

```bash
curl --location 'http://localhost:3002/queue-info/queue_status'
```

### Sample Response

```json
{
  "summary": {
    "totalJobs": 3,
    "queued": 1,
    "running": 1,
    "completed": 1,
    "failed": 0,
    "canceled": 0
  },
  "runningJob": {
    "jobId": "job-3",
    "endpointName": "/request-google-rss/start-job",
    "status": "running",
    "createdAt": "2026-02-26T18:45:00.000Z",
    "startedAt": "2026-02-26T18:45:02.000Z"
  },
  "queuedJobs": [
    {
      "jobId": "job-4",
      "endpointName": "/state-assigner/start-job",
      "status": "queued",
      "createdAt": "2026-02-26T18:45:05.000Z"
    }
  ]
}
```

## POST /queue-info/cancel_job/:jobId

Requests cancellation for a queued or running job.

- Does not require authentication
- Queued jobs cancel immediately
- Running jobs enter cancel flow (`SIGTERM`, then `SIGKILL` after grace period if needed)

### Parameters

- `jobId` (string, required, URL parameter): Job identifier

### Sample Request

```bash
curl --location --request POST 'http://localhost:3002/queue-info/cancel_job/job-4'
```

### Sample Response

```json
{
  "jobId": "job-4",
  "outcome": "canceled"
}
```

### Error responses

1. Job not found (404)

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Job not found: job-4",
    "status": 404
  }
}
```
