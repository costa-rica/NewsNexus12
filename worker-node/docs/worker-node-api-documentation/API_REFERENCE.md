# NewsNexus12 Worker Node API Reference

This API provides a RESTful interface for creating, monitoring, and managing queued worker jobs.

This file is the top-level reference index for engineers and service consumers.

## API endpoint reference files

- [index](./endpoints/index.md)
- [health](./endpoints/health.md)
- [queue-info](./endpoints/queue-info.md)
- [request-google-rss](./endpoints/request-google-rss.md)
- [semantic-scorer](./endpoints/semantic-scorer.md)
- [state-assigner](./endpoints/state-assigner.md)
- [article-content-scraper-02](./endpoints/article-content-scraper-02.md)

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
curl --location 'http://localhost:3002/example'
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
