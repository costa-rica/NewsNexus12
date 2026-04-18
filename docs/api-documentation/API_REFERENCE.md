# NewsNexus12API Reference

This API is a Node.js/Express JavaScript API that provides a RESTful interface for interacting with the SQLite database using Sequelize ORM.

This file serves as the top-level API index.

Each resource has its own documentation under the [`/endpoints`](./endpoints) folder:

- [index](./endpoints/index.md)
- [users](./endpoints/users.md)
- [keywords](./endpoints/keywords.md)
- [state](./endpoints/state.md)
- [website-domains](./endpoints/website-domains.md)
- [news-aggregators](./endpoints/news-aggregators.md)
- [artificial-intelligence](./endpoints/artificial-intelligence.md)
- [articles](./endpoints/articles.md)
- [articles-approveds](./endpoints/articles-approveds.md)
- [downloads](./endpoints/downloads.md)
- [reports](./endpoints/reports.md)
- [admin-db](./endpoints/admin-db.md)

### Analysis

- [llm01](./endpoints/analysis/llm01.md)
- [llm02](./endpoints/analysis/llm02.md)
- [llm04](./endpoints/analysis/llm04.md)
- [state-assigner](./endpoints/analysis/state-assigner.md)
- [deduper](./endpoints/analysis/deduper.md)
- [approved-articles](./endpoints/analysis/approved-articles.md)

### News Organizations

- [automations](./endpoints/news-orgs/automations.md)
- [g-news](./endpoints/news-orgs/g-news.md)
- [google-rss](./endpoints/news-orgs/google-rss.md)
- [news-api](./endpoints/news-orgs/news-api.md)
- [news-data-io](./endpoints/news-orgs/news-data-io.md)

File names should be in lower case and follow the pattern of their router subdomain. This means routers that have two words will have a hyphen between them. If we make a router for the subdomain "contract-users-teams" the file will be named docs/api-documentation/endpoints/contract-users-teams.md.

## Endpoint documentation format

Each file should be a router file.
Include an example of the reqeust in curl and the response in json.

Minimize the user of bold text. Never use it in section headings or the beginning of a listed item.

Each endpoint should have its own section with a heading that follows the pattern of the endpoint.

## [METHOD] /[router-file-name]/[endpoint]

[description]

- include if authentication is required

### parameters

- list in bullet format

### Sample Request

```bash
curl --location 'http://localhost:3000/users/login' \
--header 'Content-Type: application/json' \
--data-raw '{"email":"nrodrig1@gmail.com", "password": "test"}'
```

### Sample Response

```json
{
  "message": "User successfully registered"
}
```

### Error responses

#### Missing required field (400)

```json
{
  "error": {
    "code": "AUTH_FAILED",
    "message": "Invalid email or password",
    "status": 401
  }
}
```

### [Optional seciton for additional information]

- This section should be used sparingly
