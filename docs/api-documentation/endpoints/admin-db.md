# Admin Database API

This router provides database administration tools including backup creation, table management, and row-level CRUD operations. All operations require authentication and are rate-limited for security.

All endpoints are prefixed with `/admin-db`.

## GET /admin-db/table/:tableName

Get all rows from a specific database table.

- Requires authentication (JWT token)
- Rate limited (databaseOperationLimiter)
- Returns complete table data

### Parameters

- `tableName` (string, required, URL parameter): Name of the database table to query

### Sample Request

```bash
curl --location 'http://localhost:3000/admin-db/table/Article' \
--header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
```

### Sample Response

```json
{
  "result": true,
  "data": [
    {
      "id": 1,
      "title": "Product Safety Alert",
      "description": "Consumer warning issued...",
      "url": "https://example.com/article/1",
      "publishedDate": "2024-01-15T10:00:00.000Z",
      "createdAt": "2024-01-15T11:00:00.000Z",
      "updatedAt": "2024-01-15T11:00:00.000Z"
    },
    {
      "id": 2,
      "title": "Recall Notice",
      "description": "Product recall announced...",
      "url": "https://example.com/article/2",
      "publishedDate": "2024-01-16T14:30:00.000Z",
      "createdAt": "2024-01-16T15:00:00.000Z",
      "updatedAt": "2024-01-16T15:00:00.000Z"
    }
  ]
}
```

### Error Responses

#### Table not found (400)

```json
{
  "result": false,
  "message": "Table 'InvalidTable' not found."
}
```

#### Server error (500)

```json
{
  "result": false,
  "message": "Internal server error",
  "error": "Database query failed"
}
```

### Available Tables

The following tables are available for querying:
- User, Article, Keyword, State, WebsiteDomain
- ArtificialIntelligence, EntityWhoCategorizedArticle, EntityWhoFoundArticle
- ArticleKeywordContract, ArticleStateContract, ArticleStateContract02
- ArticleReportContract, ArticleEntityWhoCategorizedArticleContract
- ArticleEntityWhoCategorizedArticleContracts02
- ArticleApproved, ArticlesApproved02, ArticleReviewed, ArticleIsRelevant
- ArticleContents02, ArticleDuplicateAnalysis
- Report, NewsApiRequest, NewsRssRequest
- NewsArticleAggregatorSource, NewsArticleAggregatorSourceStateContract
- NewsApiRequestWebsiteDomainContract, Prompt

## GET /admin-db/create-database-backup

Create a complete database backup as a ZIP file.

- Requires authentication (JWT token)
- Rate limited (databaseOperationLimiter)
- Exports all database tables to CSV files, except models in `BACKUP_EXCLUDED_MODELS` from `@newsnexus/db-models`
- Bundles CSVs into timestamped ZIP archive
- Saves to PATH_DB_BACKUPS directory
- `ArticleEmbeddings` is excluded. It holds binary embeddings that do not round-trip through CSV, and it can be regenerated from approved article text.

### Parameters

None

### Sample Request

```bash
curl --location 'http://localhost:3000/admin-db/create-database-backup' \
--header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
```

### Sample Response

```json
{
  "result": true,
  "message": "Database backup completed",
  "backupFile": "/path/to/backups/db_backup_2024-01-15_14-30-00.zip"
}
```

### Error Responses

#### Server error (500)

```json
{
  "result": false,
  "message": "Internal server error",
  "error": "Failed to create backup archive"
}
```

### Backup Process

1. Creates temporary directory for CSV exports
2. Exports each database table to CSV format
3. Bundles all CSV files into ZIP archive
4. Names file with timestamp: `db_backup_YYYY-MM-DD_HH-MM-SS.zip`
5. Saves to configured backup directory
6. Returns full path to created backup file

## GET /admin-db/backup-database-list

Get list of all database backup ZIP files.

- Requires authentication (JWT token)
- Returns only .zip files from backup directory
- Files sorted by filesystem order

### Parameters

None

### Sample Request

```bash
curl --location 'http://localhost:3000/admin-db/backup-database-list' \
--header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
```

### Sample Response

```json
{
  "result": true,
  "backups": [
    "db_backup_2024-01-15_14-30-00.zip",
    "db_backup_2024-01-14_10-15-30.zip",
    "db_backup_2024-01-13_09-45-00_last_before_db_delete.zip"
  ]
}
```

### Error Responses

#### Backup directory not configured (500)

```json
{
  "result": false,
  "message": "Backup directory not configured."
}
```

#### Server error (500)

```json
{
  "result": false,
  "message": "Internal server error",
  "error": "Permission denied reading directory"
}
```

## GET /admin-db/send-db-backup/:filename

Download a specific database backup file.

- Requires authentication (JWT token)
- Secure file path validation prevents path traversal attacks
- Only allows .zip file extensions
- Returns ZIP file with proper download headers

### Parameters

- `filename` (string, required, URL parameter): Name of the backup file to download

### Sample Request

```bash
curl --location 'http://localhost:3000/admin-db/send-db-backup/db_backup_2024-01-15_14-30-00.zip' \
--header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' \
--output database_backup.zip
```

### Sample Response

Binary file download with headers:
```
Content-Type: application/zip
Content-Disposition: attachment; filename="db_backup_2024-01-15_14-30-00.zip"
```

### Error Responses

#### Backup directory not configured (500)

```json
{
  "result": false,
  "message": "Backup directory not configured."
}
```

#### File not found (404)

```json
{
  "result": false,
  "message": "File not found."
}
```

#### Invalid file path (404)

```json
{
  "result": false,
  "message": "Invalid file path"
}
```

#### Error sending file (500)

```json
{
  "result": false,
  "message": "Error sending file."
}
```

#### Server error (500)

```json
{
  "result": false,
  "message": "Internal server error",
  "error": "Unexpected error message"
}
```

### Security Features

- Path traversal protection via `safeFileExists` middleware
- Only .zip extensions allowed
- Validates file exists within configured backup directory
- Prevents accessing files outside backup directory

## GET /admin-db/db-row-counts-by-table

Get row counts for all database tables.

- Requires authentication (JWT token)
- Returns count of records in each table
- Results sorted alphabetically by table name
- Useful for database health monitoring

### Parameters

None

### Sample Request

```bash
curl --location 'http://localhost:3000/admin-db/db-row-counts-by-table' \
--header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
```

### Sample Response

```json
{
  "result": true,
  "arrayRowCountsByTable": [
    {
      "tableName": "Article",
      "rowCount": 1523
    },
    {
      "tableName": "ArticleApproved",
      "rowCount": 342
    },
    {
      "tableName": "ArticleKeywordContract",
      "rowCount": 4567
    },
    {
      "tableName": "State",
      "rowCount": 50
    },
    {
      "tableName": "User",
      "rowCount": 8
    }
  ]
}
```

### Error Responses

#### Server error (500)

```json
{
  "result": false,
  "message": "Internal server error",
  "error": "Database connection failed"
}
```

### Use Cases

- Database health monitoring
- Identifying tables with unexpected growth
- Verifying backup/restore operations
- Performance analysis and optimization planning

## POST /admin-db/import-db-backup

Import database data from a backup ZIP file.

- Requires authentication (JWT token)
- Rate limited (databaseOperationLimiter)
- Accepts multipart/form-data file upload
- Extracts CSV files from backup ZIP
- Appends data to existing database tables
- Does not overwrite existing records
- Leaves `ArticleEmbeddings` empty, because backups do not include it. Regenerate it with worker-python `POST /article-embeddings/jobs`, or let the next deduper job fill it.

### Parameters

- `backupFile` (file, required, multipart form): ZIP file containing database backup

### Sample Request

```bash
curl --location 'http://localhost:3000/admin-db/import-db-backup' \
--header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' \
--form 'backupFile=@"/path/to/db_backup_2024-01-15_14-30-00.zip"'
```

### Sample Response

```json
{
  "result": true,
  "message": "Database import completed successfully"
}
```

### Error Responses

#### No file uploaded (400)

```json
{
  "result": false,
  "message": "No file uploaded."
}
```

#### Temporary directory not configured (500)

```json
{
  "result": false,
  "message": "Temporary directory not configured."
}
```

#### Import failed on specific table (500)

```json
{
  "result": false,
  "error": "Failed to import table data",
  "failedOnTableName": "Article"
}
```

#### Server error (500)

```json
{
  "result": false,
  "message": "Internal server error",
  "error": "Extraction failed"
}
```

### Import Process

1. Accepts uploaded ZIP file
2. Extracts to temporary directory (temp_db_import)
3. Locates backup folder (starts with "db_backup_")
4. Reads CSV files from backup
5. Parses and appends data to database tables
6. Cleans up temporary files
7. Returns success/failure status

### Important Notes

- Import appends data (does not replace existing records)
- May create duplicate records if importing same backup multiple times
- Temporary files automatically deleted after import
- Process can take significant time for large backups

## DELETE /admin-db/delete-db-backup/:filename

Delete a specific database backup file.

- Requires authentication (JWT token)
- Permanently removes backup ZIP file from filesystem

### Parameters

- `filename` (string, required, URL parameter): Name of the backup file to delete

### Sample Request

```bash
curl --location --request DELETE 'http://localhost:3000/admin-db/delete-db-backup/db_backup_2024-01-15_14-30-00.zip' \
--header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
```

### Sample Response

```json
{
  "result": true,
  "message": "Backup file deleted successfully."
}
```

### Error Responses

#### Backup directory not configured (500)

```json
{
  "result": false,
  "message": "Backup directory not configured."
}
```

#### File not found (404)

```json
{
  "result": false,
  "message": "File not found."
}
```

#### Server error (500)

```json
{
  "result": false,
  "message": "Internal server error",
  "error": "Permission denied"
}
```

## DELETE /admin-db/the-entire-database

Delete the entire database file.

- Requires authentication (JWT token)
- Automatically creates backup before deletion
- Backup file named with suffix "_last_before_db_delete"
- Permanently removes database file from filesystem
- Requires application restart to recreate database

### Parameters

None

### Sample Request

```bash
curl --location --request DELETE 'http://localhost:3000/admin-db/the-entire-database' \
--header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
```

### Sample Response

```json
{
  "result": true,
  "message": "Database successfully deleted.",
  "backupFile": "/path/to/backups/db_backup_2024-01-15_14-30-00_last_before_db_delete.zip"
}
```

### Error Responses

#### Database file not found (404)

```json
{
  "result": false,
  "message": "Database file not found."
}
```

#### Server error (500)

```json
{
  "result": false,
  "message": "Internal server error.",
  "error": "Failed to create backup"
}
```

### Deletion Process

1. Creates automatic backup with "_last_before_db_delete" suffix
2. Verifies database file exists
3. Deletes database file
4. Returns path to backup file for recovery

### Critical Warnings

- This operation is IRREVERSIBLE without the backup file
- Application must be restarted after deletion
- New database will be empty on restart
- Use with extreme caution
- Always verify backup file was created successfully

## DELETE /admin-db/table/:tableName

Delete all rows from a specific database table.

- Requires authentication (JWT token)
- Truncates table (removes all records)
- Does not delete the table structure
- Table remains in database but empty

### Parameters

- `tableName` (string, required, URL parameter): Name of the table to truncate

### Sample Request

```bash
curl --location --request DELETE 'http://localhost:3000/admin-db/table/ArticleDuplicateAnalysis' \
--header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
```

### Sample Response

```json
{
  "result": true,
  "message": "Table 'ArticleDuplicateAnalysis' has been deleted."
}
```

### Error Responses

#### Table not found (400)

```json
{
  "result": false,
  "message": "Table 'InvalidTable' not found."
}
```

#### Server error (500)

```json
{
  "result": false,
  "message": "Internal server error",
  "error": "Database operation failed"
}
```

### Important Notes

- Deletes ALL records from the table
- Operation is permanent and cannot be undone
- Table structure remains intact
- Foreign key constraints may prevent deletion if referenced by other tables

## DELETE /admin-db/table-row/:tableName/:rowId

Delete a specific row from a database table.

- Requires authentication (JWT token)
- Removes single record by ID
- Cascading deletes may affect related tables

### Parameters

- `tableName` (string, required, URL parameter): Name of the table containing the row
- `rowId` (number, required, URL parameter): ID of the row to delete

### Sample Request

```bash
curl --location --request DELETE 'http://localhost:3000/admin-db/table-row/Article/123' \
--header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
```

### Sample Response

```json
{
  "result": true,
  "message": "Row 123 from table 'Article' has been deleted."
}
```

### Error Responses

#### Table not found (400)

```json
{
  "result": false,
  "message": "Table 'InvalidTable' not found."
}
```

#### Server error (500)

```json
{
  "result": false,
  "message": "Internal server error",
  "error": "Foreign key constraint violation"
}
```

### Important Notes

- Foreign key constraints may prevent deletion
- Related records in other tables may be affected by cascading deletes
- No confirmation prompt - deletion is immediate

## PUT /admin-db/table-row/:tableName/:rowId

Update an existing row or create a new row in a database table.

- Requires authentication (JWT token)
- Updates existing record if rowId is valid
- Creates new record if rowId is null, "null", or "undefined"
- Accepts complete or partial row data

### Parameters

- `tableName` (string, required, URL parameter): Name of the table
- `rowId` (number or null, required, URL parameter): ID of row to update, or null/undefined to create new
- Request body: Object containing field values to save

### Sample Request (Update)

```bash
curl --location --request PUT 'http://localhost:3000/admin-db/table-row/State/5' \
--header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' \
--header 'Content-Type: application/json' \
--data-raw '{
  "name": "California",
  "abbreviation": "CA",
  "isActive": true
}'
```

### Sample Request (Create)

```bash
curl --location --request PUT 'http://localhost:3000/admin-db/table-row/State/null' \
--header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' \
--header 'Content-Type: application/json' \
--data-raw '{
  "name": "New York",
  "abbreviation": "NY",
  "isActive": true
}'
```

### Sample Response

```json
{
  "result": true,
  "message": "Row 5 in 'State' successfully saved."
}
```

### Error Responses

#### Table not found (400)

```json
{
  "result": false,
  "message": "Table 'InvalidTable' not found."
}
```

#### Record not found (404)

```json
{
  "result": false,
  "message": "No record found with id 999 in table 'State'."
}
```

#### Server error (500)

```json
{
  "result": false,
  "message": "Internal server error",
  "error": "Validation failed: abbreviation cannot be null"
}
```

### Operation Logic

**Update Mode (rowId provided):**
1. Validates table exists
2. Updates record where id = rowId
3. Returns error if no record found
4. Returns success message with row ID

**Create Mode (rowId is null/undefined):**
1. Validates table exists
2. Creates new record with provided data
3. Auto-generates new ID
4. Returns success message with new row ID

### Use Cases

- Manual data entry and correction
- Administrative record updates
- Testing and debugging
- Quick fixes without writing custom endpoints
