---
created_at: 2026-10-01T23:18:45Z
updated_at: 2026-10-01T23:18:45Z
created_by: codex (gpt-6) nicksmacbookair
modified_by: codex (gpt-6) nicksmacbookair
---

# Deduper endpoints

These endpoints manage deduper job lifecycle operations including create, status, cancel, list, health checks, and table clear operations.

## GET /deduper/jobs

Creates a new deduper job and starts it in the background.

### parameters

- None

### Sample Request

```bash
curl --location 'http://localhost:5000/deduper/jobs'
```

### Sample Response

```json
{
  "jobId": 1,
  "status": "pending"
}
```

### Error responses

- `409`: A deduper submission or clear operation already holds the operation guard
- `500`: Internal server error

## GET /deduper/jobs/reportId/{report_id}

Creates a new deduper job scoped to a specific report ID.

### parameters

- Path: `report_id` (integer)

### Sample Request

```bash
curl --location 'http://localhost:5000/deduper/jobs/reportId/125'
```

### Sample Response

```json
{
  "jobId": 9,
  "reportId": 125,
  "status": "pending"
}
```

### Error responses

- `422`: Invalid `report_id` type
- `409`: A deduper submission or clear operation already holds the operation guard
- `500`: Internal server error

## GET /deduper/jobs/{job_id}

Returns status and metadata for a single deduper job.

Important:

1. `job_id` is the queue job identifier returned from job creation.
2. `job_id` is not the same value as `report_id`.

### parameters

- Path: `job_id` (integer)

### Sample Request

```bash
curl --location 'http://localhost:5000/deduper/jobs/9'
```

### Sample Response

```json
{
  "jobId": 9,
  "reportId": 125,
  "status": "completed",
  "createdAt": "2026-02-25T15:12:19.147420+00:00",
  "startedAt": "2026-02-25T15:12:19.149871+00:00",
  "completedAt": "2026-02-25T15:12:22.481555+00:00",
  "exitCode": 0,
  "stdout": "Deduper processed in-process inside worker-python",
  "stderr": "",
  "logs": [
    "2026-02-25T15:12:19.147420+00:00 event=job_created job_id=9 report_id=125",
    "2026-02-25T15:12:19.149871+00:00 event=job_started job_id=9 report_id=125",
    "2026-02-25T15:12:22.481555+00:00 event=job_completed job_id=9 report_id=125"
  ]
}
```

### Error responses

- `404`: Job not found
- `422`: Invalid `job_id` type

## POST /deduper/jobs/{job_id}/cancel

Cancels a pending or running job.

### parameters

- Path: `job_id` (integer)

### Sample Request

```bash
curl --location --request POST 'http://localhost:5000/deduper/jobs/9/cancel'
```

### Sample Response

```json
{
  "jobId": 9,
  "status": "cancelled",
  "message": "Job cancelled successfully"
}
```

### Error responses

- `404`: Job not found
- `400`: Job is not cancellable in its current state
- `422`: Invalid `job_id` type
- `500`: Cancellation failure

## GET /deduper/jobs/list

Returns a summary list of all tracked jobs.

### parameters

- None

### Sample Request

```bash
curl --location 'http://localhost:5000/deduper/jobs/list'
```

### Sample Response

```json
{
  "jobs": [
    {
      "jobId": 8,
      "status": "completed",
      "createdAt": "2026-02-25T15:10:01.006940+00:00"
    },
    {
      "jobId": 9,
      "status": "running",
      "createdAt": "2026-02-25T15:12:19.147420+00:00"
    }
  ]
}
```

### Error responses

- `500`: Internal server error

## GET /deduper/health

Returns deduper service health including environment and job counters.

### parameters

- None

### Sample Request

```bash
curl --location 'http://localhost:5000/deduper/health'
```

### Sample Response

```json
{
  "status": "healthy",
  "timestamp": "2026-02-25T15:14:03.488332+00:00",
  "environment": {
    "path_database_configured": true,
    "name_db_configured": true,
    "database_exists": true
  },
  "jobs": {
    "total": 2,
    "pending": 0,
    "running": 1,
    "completed": 1,
    "failed": 0,
    "cancelled": 0
  }
}
```

### Error responses

- `500`: Unexpected health check failure

## DELETE /deduper/clear-db-table

Cancels only deduper jobs and clears the `ArticleDuplicateAnalyses` table in-process after running deduper execution has exited.

- AI Approver V02, location-scoring jobs, and the worker service remain running. There is no option to cancel other workflows through this endpoint.
- `DEDUPER_CLEAR_CANCEL_TIMEOUT_SECONDS` is a positive integer, default 30. It bounds cancellation waiting, not the duration of analysis or deletion. Timeout prevents deletion.
- New deduper submissions and concurrent clear requests return 409 while the operation guard is held. The guard applies within the existing single queue-owning process.
- `cancelledJobs` lists confirmed cancellations. `cancellationRequestedJobs` lists running jobs signaled to stop; it may overlap with `cancelledJobs` and does not itself confirm cancellation.

### parameters

- None

### Sample Request

```bash
curl --location --request DELETE 'http://localhost:5000/deduper/clear-db-table'
```

### Sample Response

```json
{
  "cleared": true,
  "rowsDeleted": 1024,
  "cancelledJobs": ["0009"],
  "cancellationRequestedJobs": ["0009"],
  "exitCode": 0,
  "stdout": "Successfully deleted 1024 rows from ArticleDuplicateAnalyses table.",
  "stderr": "",
  "timestamp": "2026-02-25T15:15:31.223614+00:00"
}
```

### Error responses

- `500`: Missing DB environment variables or internal clear-table failure
- `409`: Another deduper submission or clear operation holds the guard; no cancellation or deletion is started by this request
- `504`: Deduper execution did not stop before the configured cancellation deadline; no deletion is attempted

Failure responses include `cleared: false`, `error`, `cancelledJobs`, `cancellationRequestedJobs`, and `timestamp`. Completed cancellations are not undone by a later failure. For example:

```json
{
  "cleared": false,
  "error": "Deduper did not stop within 30 seconds; table was not cleared",
  "cancelledJobs": ["0010"],
  "cancellationRequestedJobs": ["0009"],
  "timestamp": "2026-10-01T23:17:20+00:00"
}
```
