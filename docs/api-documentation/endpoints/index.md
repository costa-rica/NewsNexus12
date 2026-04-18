# Index API

This router provides the home page endpoint for the NewsNexus12API.

All endpoints are prefixed with `/`.

## GET /

Get the home page HTML template.

- Does not require authentication
- Returns an HTML page
- Logs page access to both console and logger

### Parameters

None

### Sample Request

```bash
curl --location 'http://localhost:3000/'
```

### Sample Response

Returns HTML content from `/src/templates/index.html`

```html
<!DOCTYPE html>
<html>
  <head>
    <title>NewsNexus12API</title>
  </head>
  <body>
    <h1>Welcome to NewsNexus12API</h1>
    ...
  </body>
</html>
```
