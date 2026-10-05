---
created_at: 2026-10-05T20:20:02Z
updated_at: 2026-10-05T20:20:02Z
created_by: codex (gpt-5.6-sol) nws-nn12dev
modified_by: codex (gpt-5.6-sol) nws-nn12dev
---

# Worker-Node RSS Job 0026 Investigation Report V01

## Scope

This was a read-only investigation of worker-node RSS job `0026` around `2026-10-05 20:06:18Z`.

No code, database data, spreadsheet content, queue state, or service state was changed. No replacement or test job was started.

Evidence came from:

- `/home/limited_user/project_resources/NewsNexus12/utilities/worker-node/queue-jobs.json`
- `/home/limited_user/logs/NewsNexus12WorkerNode.log`
- the `newsnexus12-worker-node.service` journal
- `/home/limited_user/logs/newsnexus12-weekly-pipeline.log`
- read-only PostgreSQL queries inside an explicit read-only transaction
- a read-only ExcelJS load of the configured spreadsheet

## Finding

Job `0026` failed while processing the first spreadsheet query because Playwright could not find its required Chromium headless-shell revision `1243` under the worker service user's cache.

The service user had cached headless-shell revisions `1208`, `1228`, and `1234`, but not the requested `1243` revision.

The RSS request itself succeeded and persisted one request, one Article, and one failed seed `ArticleContents02` row. The subsequent Google-to-publisher browser fallback raised the Playwright error.

The workflow caught that error and saved a result with `endingReason = error`. Because the handler returned after catching the workflow error, the outer queue record has `status = completed`; this does not mean the RSS workflow succeeded.

## Saved Job Status and Result

- Job ID: `0026`
- Endpoint: `/request-google-rss/start-job`
- Queue status: `completed`
- Created: `2026-10-05T20:06:18.287Z`
- Started: `2026-10-05T20:06:18.322Z`
- Ended: `2026-10-05T20:06:19.864Z`
- Result ending reason: `error`
- Result article count: `0`
- Query result rows: `3`

The exact saved `endingMessage` was:

```text
browserType.launch: Executable doesn't exist at /home/limited_user/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell
╔════════════════════════════════════════════════════════════╗
║ Looks like Playwright was just installed or updated.       ║
║ Please run the following command to download new browsers: ║
║                                                            ║
║     npx playwright install                                 ║
║                                                            ║
║ <3 Playwright Team                                         ║
╚════════════════════════════════════════════════════════════╝
```

The worker log emitted the same error after this prefix:

```text
requestGoogleRss job failed:
```

No JavaScript call-stack frames were present in the saved result, file log, or systemd journal. The text above is the complete recorded error message rather than a truncated stack trace.

## Failing Spreadsheet Row

The failure occurred on spreadsheet row `2`, which is loaded query index `0`:

| Field | Value |
| --- | --- |
| `id` | `1` |
| `and_keywords` | `Lebron James` |
| `and_exact_phrases` | empty |
| `or_keywords` | empty |
| `or_exact_phrases` | empty |
| `time_range` | empty |
| Effective time range | `180d` |
| Saved query status | `failed` |
| Saved article count | `0` |

The exact requested URL was:

```text
https://news.google.com/rss/search?q=%22Lebron+James%22+when%3A180d&hl=en-US&gl=US&ceid=US%3Aen
```

The query result note contains `error: ` followed by the exact Playwright message recorded above.

## Last Successfully Processed Query

There was no successfully completed query in job `0026`.

- Row ID `1` was attempted but ended with `status = failed`.
- Row IDs `2` and `3` were never reached.
- Therefore, there is no last successfully processed query.

The last and only attempted query was row ID `1`, `Lebron James`.

## Query Outcomes

| Spreadsheet row | ID | Query | Outcome | Saved result |
| --- | ---: | --- | --- | ---: |
| 2 | 1 | `Lebron James` | Failed during browser fallback | 0 |
| 3 | 2 | `football` | Skipped as `not_reached` | 0 |
| 4 | 3 | `artificial intelligence` | Skipped as `not_reached` | 0 |

Totals from the saved result:

- Successfully completed queries: `0`
- Skipped by the 72-hour repeat window: `0`
- Skipped because they were not reached: `2`
- Failed queries: `1`
- Empty-query skips: `0`
- Worker-reported `articlesAddedCount`: `0`

There is no `Skipping RSS request ... repeat_window` log for this job.

## Data Persisted Before Failure

A read-only database check found partial work from the first query even though the saved result reports zero Articles.

### NewsApiRequest

- ID: `173843`
- Created: `2026-10-05 20:06:19.618Z`
- Status: `success`
- RSS items received: `100`
- `andString`: `Lebron James`
- Linked Articles: `1`
- `countOfArticlesSavedToDbFromRequest`: null

The saved-count field remained null because the exception occurred before `storeRequestAndArticles` completed and updated that field.

### Article

- ID: `467832`
- Created: `2026-10-05 20:06:19.771Z`
- Title: `What’s next for LeBron James? - The Stein Line`
- `newsApiRequestId`: `173843`

### ArticleContents02

- ID: `163316`
- Article ID: `467832`
- Created: `2026-10-05 20:06:19.806Z`
- Status: `fail`
- Body source: `none`
- Details: `RSS item content missing; triggering Google-to-publisher scrape`

The Article was persisted before the Playwright launch attempt. The job-level counter stayed at zero because `articlesAddedCount` is incremented only after `storeRequestAndArticles` returns successfully.

## Spreadsheet Configuration

The configured environment value and the path logged by job `0026` agree:

```text
/home/limited_user/project_resources/NewsNexus12/utilities/automation_excel_files/AutomatedRequestsGoogleNewsRss04.xlsx
```

The workbook modification time was `2026-10-05T20:03:47.985Z`, before job `0026` started.

Worker-node logged:

```text
Loaded 3 query rows from spreadsheet.
```

A read-only load of the current workbook also found three data rows in worksheet `template_query_parameters`.

## Newly Added Row Validation

The three loaded rows satisfy the worker's spreadsheet loader and query-builder requirements.

### Headers

All six required headers are present:

1. `id`
2. `and_keywords`
3. `and_exact_phrases`
4. `or_keywords`
5. `or_exact_phrases`
6. `time_range`

### IDs

- IDs are numeric: `1`, `2`, and `3`.
- IDs are unique in the loaded workbook.
- No row has a missing or invalid ID.

### Query fields

- Every row has a non-empty `and_keywords` value.
- The remaining AND/OR fields are empty, which is permitted.
- Every row therefore builds a non-empty Google RSS query.
- No row qualifies for `empty_query` skipping.

### Time ranges

All three raw `time_range` cells are empty.

An explicit non-empty value must match a positive day count such as `180d`. An empty value is accepted by the implementation and uses `LIMIT_ARTICLE_AGE_IN_DAYS` instead.

The configured fallback is `180`, so all three rows normalize to valid effective range `180d`. The worker log confirms row ID `1` was requested with `180d` and did not flag an invalid time range.

## Timeline

1. `20:06:18.283Z`: worker received the RSS start request.
2. `20:06:18.287Z`: queue record created.
3. `20:06:18.322Z`: job started.
4. `20:06:18.673Z`: worker loaded three spreadsheet rows.
5. `20:06:18.745Z`: worker started row ID `1` with effective range `180d`.
6. `20:06:19.618Z`: database request row `173843` was created.
7. `20:06:19.771Z`: Article `467832` was created.
8. `20:06:19.806Z`: failed seed content row `163316` was created.
9. `20:06:19.847Z`: Playwright reported missing headless-shell revision `1243`.
10. `20:06:19.849Z`: worker saved `endingReason = error` and the three query results.
11. `20:06:19.864Z`: queue status became `completed`.
12. `20:11:18Z`: weekly-flow Phase 4 observed the terminal result and stopped with `failureCategory=unsuccessful_result` and `RSS job ended without verified success: error`.

## Conclusion

- Exact failure: missing Playwright Chromium headless-shell revision `1243` for service user `limited_user`.
- Failing row: spreadsheet row `2`, query ID `1`, `Lebron James`.
- Last successful query: none.
- Completed queries: none.
- Repeat-window skips: none.
- Not-reached queries: IDs `2` and `3`.
- Data persisted before failure: one NewsApiRequest, one Article, and one failed `ArticleContents02` seed row.
- Spreadsheet configuration: correct path, correct six headers, three loaded rows, numeric unique IDs, non-empty query fields, and accepted blank time ranges resolving to `180d`.
