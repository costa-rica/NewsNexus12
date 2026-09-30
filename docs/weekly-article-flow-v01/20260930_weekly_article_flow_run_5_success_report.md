---
created_at: 2026-09-30T03:27:29Z
updated_at: 2026-09-30T03:27:29Z
created_by: hermes (gpt-5.6-sol) nws-nn12prod
modified_by: hermes (gpt-5.6-sol) nws-nn12prod
---

# Weekly Article Flow Run 5 Success Report

## Purpose

This report preserves the production evidence for durable weekly run `5` as a comparison baseline for later runs.

Run `5` is the first durable `scheduled_production` run in the current `WeeklyArticleFlowRuns` table history to finish with status `completed` after executing the complete workflow.

Run `1` ended as `completed_no_new_articles`. Runs `2`, `3`, and `4` did not complete end to end.

## Outcome

- Durable run ID: `5`
- Mode: `scheduled_production`
- Status: `completed`
- Host: `nws-nn12prod`
- Database: `newsnexus_prod`
- Source revision: `61a5ec02653c7ffc2d1c25c731efaff138ab23c3`
- Started: `2026-09-30T03:17:39.765Z`
- Durable completion: `2026-09-30T03:22:34.213Z`
- Durable duration: `294.448` seconds
- Final recorded stage: `reporting`
- Service exit: `0/SUCCESS` at `2026-09-30T03:22:44Z`
- Service wall time: approximately `306` seconds
- Service CPU time: `138.073` seconds
- Service memory peak: `2.96 GiB`
- Service swap peak: `0 B`

The final `failureReason` field contains `Weekly article flow completed.` despite the completed status. Treat the status and completed stage evidence as authoritative for the outcome. The field name makes the success message potentially confusing.

## Completed Stages

### Preflight

- Preflight completed against `newsnexus_prod` as `newsnexus_app`.
- Available disk was `148,657,750,016` bytes.
- Required minimum free disk was `10,737,418,240` bytes.
- Active prompt version ID was `1`.

### Duplicate cleanup

- Status: `completed`
- Duplicate analyses found: `0`
- Duplicate analyses deleted: `0`
- Duration: `9.270` seconds

### Backup

- Status: `completed`
- Archive size: `223,379,934` bytes, approximately `213.0 MiB`
- SHA-256: `e6cff29ae40494ee078757e9ab2f685b875b605ed00c0615d3189654aa3984fe`
- Duration: `93.036` seconds

The production database backup path is retained in the durable stage evidence. It is omitted here to avoid making this report depend on one host filesystem location.

### Old-article deletion

- Status: `completed`
- Cutoff date: `2026-04-03`
- Articles found: `1,676`
- Articles deleted: `1,676`
- Duration: `11.212` seconds

### Google RSS

- Queue job: `0274`
- Queue status: `completed`
- Ending reason: `queries_exhausted`
- Successful queries: `3`
- Failed queries: `0`
- Skipped queries: `0`
- Articles added: `3`

### Semantic scorer

- Queue job: `0275`
- Queue status: `completed`
- Selected articles: `140`
- Scored articles: `4`
- Skipped articles: `136`
- Skip reason: `no_score_result`
- Failed articles: `0`
- Unattempted articles: `0`
- Stage start: `2026-09-30T03:20:44.588Z`
- Stage end: `2026-09-30T03:21:54.878Z`

Workflow completion does not mean that all 140 selected articles received scores. The durable result records four scored articles and 136 explicit skips.

### State assigner

- Queue job: `0276`
- Queue status: `completed`
- Selected articles: `3`
- Attempted articles: `3`
- Successful articles: `3`
- Failed articles: `0`
- Unattempted articles: `0`
- Circuit breaker tripped: `false`

### AI Approver V02

- AI Approver run ID: `40`
- Preview status: `completed`
- Requested cohort articles: `3`
- Eligible overlap: `1`
- Selected articles: `1`
- Execution status: `completed`

A completed AI Approver run records successful workflow execution. It should not be interpreted as an approval decision without inspecting the corresponding AI Approver result.

### Reconciliation and reporting

- Reconciliation selected: `1`
- Reconciliation attempted: `1`
- Reconciliation completed: `1`
- Reconciliation failed: `0`
- Reconciliation skipped: `0`
- Reconciliation unattempted: `0`
- Reporting status: `completed`
- Reporting failures: none
- JSONL evidence: `/home/limited_user/project_resources/NewsNexus12/weekly-flow/weekly-flow-20260930.jsonl`

## Semantic Diagnostics Baseline

The diagnostic collector recorded `43` records and suppressed `0` records for semantic job `0275`.

Measured observations:

- Candidate selection loaded `140` articles and `25` keywords.
- Maximum measured event-loop delay during selection was `6,471.811071 ms`.
- The diagnostic timer was delayed by `6,183.729620 ms` in the same sample.
- Worker RSS at selection completion was `1,109,450,752` bytes.
- Semantic model initialization took `2,453.012329 ms`.
- Worker RSS after model initialization was `1,302,638,592` bytes.
- One concurrent status request took approximately `7,120 ms` and returned HTTP `200`.
- Semantic job execution reached `semantic_job_completed` after approximately `42,814.517349 ms`.
- No `ECONNRESET` was found in the inspected run journal.
- No warning-priority journal entry or matching fatal/error signature was found in the inspected run window.

This run directly confirms a substantial event-loop stall during semantic selection. It also confirms that a slow status request survived and completed during this run.

It does not prove the exact cause of the connection reset in run `4`. It does not prove that a future reset cannot recur. The relationship among event-loop delay, HTTP connection reuse, keep-alive behavior, and the earlier reset remains an evidence-supported hypothesis rather than a demonstrated causal chain.

## Evidence Sources

The report was assembled from read-only inspection of:

- `WeeklyArticleFlowRuns` row `5` and its durable `stageResults`
- systemd metadata for `newsnexus12-weekly-article-flow.service`
- journald entries for the weekly coordinator, Node worker, and Python worker from `2026-09-30T03:17:38Z` through `2026-09-30T03:22:45Z`
- semantic diagnostic records for queue job `0275`
- queue and workflow terminal records for jobs `0274`, `0275`, `0276`, and AI Approver V02 run `40`

Related investigations:

- [Weekly Article Flow Run 4 Failure Report](../../20260929_weekly_article_flow_run_4_failure_report.md)
- [Run 4 Semantic Status Connection Reset Investigation](../../20260929_run_4_connection_reset_investigation.md)
- [Weekly Flow Diagnostics Plan](../../20260929_weekly_flow_diagnostics_plan_v04.md)

## Future Run Comparison Checklist

For each significant production run, record:

1. Durable run ID, mode, status, revision, start time, completion time, and service exit status.
2. Stage IDs, stage durations, selected counts, successful counts, skip reasons, failures, and unattempted counts.
3. Semantic candidate count, scored count, `no_score_result` count, and model initialization duration.
4. Maximum event-loop delay, status-request latency, transport failures, diagnostic record count, and suppressed record count.
5. Service CPU time, peak memory, and swap use.
6. Whether the model was initialized cold or reused from an already running worker process, when that can be established.
7. Any configuration or workload difference that prevents a direct comparison.

Several repeated successful runs are needed before treating run `5` as evidence of reliability rather than one successful observation.
