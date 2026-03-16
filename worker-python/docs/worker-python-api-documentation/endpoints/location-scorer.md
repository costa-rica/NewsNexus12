# Location scorer endpoints

These endpoints manage location scorer queue jobs inside worker-python.

The location scorer classifies whether articles occurred in the United States and writes scores into `ArticleEntityWhoCategorizedArticleContracts`.

## POST /location-scorer/start-job

Creates a new queued location scorer job.

### parameters

- Body: `limit` (integer, optional) — maximum number of unscored articles to process in this run

### Sample Request

```bash
curl --location --request POST 'http://localhost:5000/location-scorer/start-job' \
--header 'Content-Type: application/json' \
--data '{
  "limit": 25
}'
```

### Sample Response

```json
{
  "jobId": "0007",
  "status": "queued",
  "endpointName": "/location-scorer/start-job"
}
```

### Error responses

- `422`: Invalid request body shape or invalid `limit` type
- `500`: Unexpected queue or runtime failure

## Runtime notes

1. This endpoint only enqueues the job. Use queue-info endpoints to monitor progress:
- `GET /queue-info/latest-job?endpointName=/location-scorer/start-job`
- `GET /queue-info/check-status/{job_id}`
- `POST /queue-info/cancel-job/{job_id}`

2. The queue job `result` payload may include workflow-specific progress keys such as:
- `workflow`
- `summaryStatus`
- `currentStep`
- `currentStepStatus`
- `currentStepProcessed`
- `completedStepCount`

3. Queue status values still use the shared contract:
- `queued`
- `running`
- `completed`
- `failed`
- `canceled`

## AI entity prerequisite

The location scorer requires both of the following database records to exist before jobs can run successfully:

1. An `ArtificialIntelligences` row whose `name` matches `NAME_AI_ENTITY_LOCATION_SCORER`
2. A related `EntityWhoCategorizedArticles` row whose `artificialIntelligenceId` points at that AI row

This setup is a prerequisite and is not created automatically by `POST /location-scorer/start-job`.

The source project used a one-time helper script named `standalone/update_ai_entities.py`. If these rows do not exist in the shared NewsNexus database, create them before using this route.
