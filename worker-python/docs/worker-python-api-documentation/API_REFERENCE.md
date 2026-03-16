# NewsNexus11 Worker Python API Reference

This API provides a RESTful interface for creating, monitoring, and managing queued worker jobs.

This file is the top-level reference index for engineers and service consumers.

## API endpoint reference files

- [index](./endpoints/index.md)
- [deduper](./endpoints/deduper.md)
- [location-scorer](./endpoints/location-scorer.md)
- [queue-info](./endpoints/queue-info.md)

## Quick usage guidance

1. Treat `jobId` and `reportId` as different values.
2. Create deduper job by report ID:
- `GET /deduper/jobs/reportId/{report_id}`
3. Poll job status using `jobId` from creation response:
- `GET /deduper/jobs/{job_id}`
4. Use `GET /deduper/jobs/list` to inspect active and recent jobs.
5. Use `GET /deduper/health` for runtime and environment checks.
6. Create location scorer job:
- `POST /location-scorer/start-job`
7. Poll latest location scorer job by endpoint name:
- `GET /queue-info/latest-job?endpointName=/location-scorer/start-job`

## Documentation conventions

1. Keep endpoint file names lowercase.
2. Use hyphens for multi-word route groups.
3. Keep each endpoint in its own section using this heading pattern:

## [METHOD] /[router]/[endpoint]

4. Include request and response examples for every endpoint.
5. Include error response examples for expected failure cases.

## Endpoint documentation template

### parameters

- List path parameters
- List query parameters
- List body fields

### Sample Request

```bash
curl --location 'http://localhost:5000/example'
```

### Sample Response

```json
{
  "status": "ok"
}
```

### Error responses

- List common errors and when they occur

## Notes for contributors

- Keep examples realistic and concise.
- Keep response keys consistent with live endpoint behavior.
- Update endpoint docs in the same change set as route updates.
