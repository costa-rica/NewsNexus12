---
created_at: 2026-09-29T19:19:06Z
updated_at: 2026-09-29T19:19:06Z
created_by: hermes (gpt-5.6-sol) nws-nn12prod
modified_by: hermes (gpt-5.6-sol) nws-nn12prod
---

# Weekly Article Flow Run 4 Failure Report

## Executive Summary

The September 25, 2026 scheduled weekly article flow failed during `semantic_scorer`. The semantic algorithm did not report a scoring error. Instead, one coordinator status request to the Node worker ended with `read ECONNRESET`.

The coordinator treated that single observation failure as a stage failure and immediately canceled semantic job `0267`. The job had selected 1,705 articles, but cancellation arrived before scoring began. All 1,705 remained unattempted.

The defensible direct cause is a transient status-poll connection reset amplified by fail-fast coordinator policy. Retained evidence does not identify what reset the local TCP connection. It does not prove a worker crash, model failure, timeout, or scoring defect.

A separate configuration conflict prevented the failure alert from being published. The coordinator service uses `NoNewPrivileges=true`, but its alert helper attempts to use `sudo` to start a root-owned publisher service.

The semantic scorer was later run manually from the portal. Job `0272` completed on September 29 with 871 attempted, 733 successful, 138 skipped, zero failed, and zero unattempted. This confirms the scorer can complete, but it does not repair or resume durable weekly run 4.

## Scope and Evidence

This report is based on read-only inspection of:

- `WeeklyArticleFlowRuns` row 4 and its stage evidence
- Node worker queue jobs `0266`, `0267`, and later manual job `0272`
- systemd journals for the weekly coordinator and Node worker
- the weekly-flow HTTP client, worker-stage, coordinator, and alert source
- the weekly-flow tests that encode current polling behavior
- the source-controlled weekly service unit

No application code, service configuration, database data, queue state, timers, or running services were changed during this investigation. The only repository change is this report.

## Incident Identity

- Durable run: `WeeklyArticleFlowRuns` row 4
- Mode: `scheduled_production`
- Scheduled and started: September 25, 2026 at 5:00:29 AM PDT
- Ended: September 25, 2026 at 9:09:33 AM PDT
- Durable status: `failed`
- Durable failure reason: `fetch failed`
- Final business stage reached: `semantic_scorer`
- Recorded `currentStage`: `reporting`
- JSONL path: `/home/limited_user/project_resources/NewsNexus12/weekly-flow/weekly-flow-20260925.jsonl`

The `currentStage` value does not mean reporting caused the business failure. Failure finalization started reporting after semantic scoring failed, and stage startup overwrote `currentStage`.

## What Completed Before the Failure

The following stages completed:

1. Preflight
2. Duplicate cleanup
3. Backup
4. Old-article deletion
5. Google RSS ingestion

Google RSS child job `0266` completed successfully with:

- ending reason: `queries_exhausted`
- successful queries: 567
- skipped queries: 0
- failed queries: 0
- articles added: 1,562

The weekly run recorded both `rssArticlesAddedCount` and `cohortArticleCount` as 1,562.

No durable stage evidence exists for state assignment, AI Approver V02, or reconciliation. Those downstream weekly stages did not run.

## Failure Timeline

All times below are PDT on September 25, 2026.

1. 9:09:18 AM: Google RSS job `0266` completed.
2. 9:09:21 AM: The coordinator enqueued semantic job `0267`.
3. 9:09:21 AM: The Node worker started job `0267`.
4. 9:09:21 AM: A status request succeeded in 287 milliseconds.
5. 9:09:24 AM: Another status request succeeded in 1,406 milliseconds.
6. 9:09:33 AM: A later status request failed after 6,895 milliseconds with `fetch failed`, caused by `read ECONNRESET`.
7. 9:09:33 AM: The coordinator immediately requested cancellation of job `0267`.
8. 9:09:33 AM: The worker accepted the cancellation request and logged that it had loaded 1,705 articles and 25 keywords.
9. 9:09:34 AM: The worker began loading `Xenova/paraphrase-MiniLM-L6-v2`.
10. 9:09:35 AM: The worker persisted the job as canceled after the workflow returned.
11. 9:09:33 AM: Failure reporting staged an alert but could not start the publisher.
12. 9:09:44 AM: systemd recorded the coordinator service exiting with status 1.

The stage deadline was 1:09:21 PM PDT. The failed request was not a deadline expiry and did not reach the configured 30-second HTTP request timeout.

## Exact Semantic Job Result

Job `0267` ended with:

- queue status: `canceled`
- failure reason: `canceled_by_request`
- ending reason: `canceled`
- selected: 1,705
- attempted: 0
- successful: 0
- skipped: 0
- failed: 0
- unattempted: 1,705

These counters show that the semantic scorer did not fail while processing an article. The coordinator canceled the job before the first selected article was attempted.

The canceled queue result is a consequence of the coordinator's response to the failed status request. It is not independent evidence that the semantic algorithm failed.

## Root Cause Analysis

### Direct cause

A coordinator `GET` request to `/queue-info/check-status/0267` on `http://127.0.0.1:8003` lost its connection with `ECONNRESET`.

The request had no HTTP status because the connection ended before a valid response was received. The coordinator stored the nested transport cause correctly in durable stage diagnostics.

### Control-flow amplifier

The weekly-flow polling policy converted one failed observation into cancellation of active business work.

`ops/weekly-article-flow/src/http/client.ts` lines 174-189 implement queue polling. Line 181 awaits each status request directly. Backoff occurs only after a successful nonterminal response. There is no retry classification or recovery path for transport errors or HTTP `5xx` responses.

`ops/weekly-article-flow/src/stages/workers.ts` lines 19-47 catch any polling exception. Lines 35-37 immediately request cancellation, and line 46 rethrows the original polling error.

The current tests intentionally lock in this behavior:

- `ops/weekly-article-flow/tests/httpClient.test.ts` lines 65-91 assert that a transport failure is not retried.
- `ops/weekly-article-flow/tests/workerStages.test.ts` lines 143-166 expect exactly one failed poll followed by exactly one cancellation request.

The code therefore behaved as implemented. The defect is the policy: an observation failure is treated as proof that active work must be canceled.

### Root cause boundary

The retained evidence does not establish why the local connection reset.

The following explanations remain possible but unproven:

- a transient Node HTTP or socket failure
- event-loop delay or resource pressure
- connection reuse behavior
- a brief worker-side fault that did not terminate the service

The evidence argues against describing this as a confirmed worker crash. The same worker process logged successful status responses before the reset, accepted the cancellation request at 9:09:33 AM, continued semantic initialization, and persisted the terminal job result at 9:09:35 AM.

The weekly service reported a 2.8 GB memory peak, but retained evidence does not show an OOM kill or worker restart. Memory usage alone is insufficient to assign cause.

## Alert Publication Failure

The alert failure was separate from the semantic failure.

The reporting stage staged the alert file, then failed to publish it. Its retained error was:

```text
sudo: The "no new privileges" flag is set, which prevents sudo from running as root.
```

The source-controlled weekly service sets `NoNewPrivileges=true` at `ops/weekly-article-flow/systemd/newsnexus12-weekly-article-flow.service` line 17.

The publisher function invokes `/usr/bin/sudo -n /usr/bin/systemctl start newsnexus12-publish-weekly-alert.service` at `ops/weekly-article-flow/src/alerts/index.ts` lines 78-96.

A narrow `NOPASSWD` sudoers rule cannot overcome the kernel's no-new-privileges restriction. The design is internally inconsistent, so failures can occur without the intended operator alert.

## Business Impact

- The scheduled weekly run remained durably failed.
- None of the 1,705 selected semantic candidates was attempted by run 4's child job.
- State assignment, AI Approver V02, and reconciliation were not reached.
- Google RSS ingestion had already added 1,562 articles before the failure.
- The failure alert was staged locally but was not published through the configured helper.
- The timer remained enabled, so the same polling and alert defects could affect later scheduled runs.

## Manual Recovery Result

Portal-triggered semantic job `0272` ran on September 29 from 6:07:29 AM to 6:10:51 AM PDT and completed:

- selected: 871
- attempted: 871
- successful: 733
- skipped: 138
- failed: 0
- unattempted: 0

This is useful recovery evidence. It shows the semantic scorer and model can complete under current conditions.

The manual job selected 871 articles, not the 1,705 selected by job `0267`. Eligibility changed between runs, so the manual result must not be described as an exact replay or continuation of weekly run 4.

The manual semantic run also did not cause the weekly coordinator to resume downstream stages. Run 4 remains failed and should remain immutable for auditability.

## Recommended Fix

### 1. Make status polling resilient

Update queue polling to retry safe observation requests when failures are plausibly transient.

Retry candidates should include:

- transport failures such as `ECONNRESET`, `ECONNREFUSED`, and temporary DNS/socket errors
- request timeouts, while the stage deadline still has capacity
- HTTP `408`, `429`, and `5xx` responses

Use bounded exponential backoff with jitter and stop at the existing stage deadline. Preserve structured diagnostics for every failed attempt without exposing credentials.

Do not apply the same automatic retry policy to job-start `POST` requests. Retrying a start request after an ambiguous response could submit duplicate business work.

### 2. Separate observation failure from worker failure

A failed status request should not immediately mark the child algorithm failed or cancel it.

Before cancellation, the coordinator should:

1. Retry status observation within a bounded policy.
2. Reconcile the exact job ID after connectivity returns.
3. Continue waiting if the job is queued or running.
4. accept and validate the result if the job became terminal.
5. Cancel only for stage deadline expiry, explicit operator/run cancellation, or another documented terminal policy.

If retries are exhausted before the deadline, record a distinct observation or coordinator-health failure. Avoid assigning a semantic algorithm failure when no semantic attempt failed.

### 3. Confirm terminal cancellation

A successful cancel HTTP response only confirms that the request was accepted.

After a legitimate cancellation request, poll the exact job with a bounded follow-up until it reaches `canceled`, `failed`, or `completed`. Persist both the cancellation reason and final child result.

### 4. Improve stage-state clarity

Add a durable `failedStage` or equivalent terminal-origin field. Keep `currentStage=reporting` if required for finalization, but expose that `semantic_scorer` was the business stage that failed.

This prevents operators from having to infer the failure stage from nested evidence.

### 5. Add semantic initialization observability

Publish phase markers for:

- article selection complete
- keywords loaded
- model initialization started
- model initialization complete
- scoring started

Add bounded model initialization and cancellation checks between initialization steps. Where the inference library cannot be interrupted, isolate inference in a worker thread or managed child process so timeouts do not leave background work accumulating.

These improvements aid diagnosis, but they are not the primary fix for this incident. Poll resilience is the first priority.

### 6. Repair alert publication architecture

Preferred approach: retain `NoNewPrivileges=true` and replace in-service `sudo` with a narrowly scoped privileged handoff that is compatible with systemd hardening.

Acceptable designs include a root-owned path or unit activation mechanism that consumes only the fixed staged alert and cannot accept arbitrary commands or paths.

A less desirable fallback is removing `NoNewPrivileges` from the coordinator while keeping the exact-command sudoers rule. That weakens service hardening and should require an explicit security review.

### 7. Preserve the failed run

Do not mutate run 4 into success and do not overwrite its historical evidence.

If the product needs resumable recovery, create a new continuation run linked to source run 4. The continuation should record which stages were manually completed, recompute eligibility, and make downstream execution explicit.

## Required Regression Tests

Add or revise tests for:

1. One `ECONNRESET` followed by a successful status response, with no cancellation and no duplicate submission.
2. Multiple retryable failures followed by recovery before the stage deadline.
3. Retryable failures continuing through the deadline, followed by exactly one cancellation request.
4. Non-retryable `4xx` status responses failing promptly under documented policy.
5. A job becoming terminal while status retries are in progress.
6. Cancellation request acceptance followed by terminal-state confirmation.
7. Coordinator restart or resume reattaching to the persisted exact child job ID.
8. Semantic cancellation during model initialization.
9. Alert publication under the actual systemd security restrictions.
10. Durable reporting of both `failedStage` and reporting-stage outcome.

The current tests expecting no transport retry and immediate cancellation must be replaced or narrowed to deadline and explicit-cancellation cases.

## Verification Plan for the Future Fix

Before restoring confidence in the Friday schedule:

1. Run the weekly-flow unit tests.
2. Run a test where the status endpoint resets once and then recovers.
3. Verify the same child job continues and no cancellation endpoint is called.
4. Run a supervised nonproduction flow through semantic scoring and downstream handoff.
5. Test the alert publisher from the coordinator's real systemd security context.
6. Confirm a staged alert is delivered, not merely written.
7. Deploy through the documented production process.
8. Monitor the next scheduled run using its exact durable run ID and child job IDs.

Success requires business completion, not merely a systemd exit or queue lifecycle status.

## Priority

1. P0: retry transient status-poll failures without canceling active work.
2. P0: make alert publication compatible with `NoNewPrivileges`.
3. P1: confirm terminal child state after legitimate cancellation.
4. P1: add `failedStage` and semantic initialization phase evidence.
5. P2: design linked continuation runs for partial weekly-flow recovery.

## Conclusion

Run 4 failed because the coordinator could not observe semantic job `0267` once and then canceled it. The available evidence does not show a semantic scoring failure.

The correct fix is to make read-only queue observation resilient, reserve cancellation for explicit terminal conditions, and repair the separate alert-publication security conflict. The later successful manual semantic run supports this diagnosis but does not convert or resume the failed weekly run.
