---
created_at: 2026-10-16T19:16:21Z
updated_at: 2026-10-16T19:18:55Z
created_by: hermes (gpt-5.6-sol) nws-nn12prod
modified_by: hermes (gpt-5.6-sol) nws-nn12prod
---

# Weekly Flow 02 Run 3 Failure Report

## Overview

The October 16, 2026 scheduled `newsnexus-weekly-flow-02` run failed in Phase 4, Google News RSS collection. Child job `0290` processed 753 of 833 queries and added 1,797 articles before Google returned HTTP 503 on query 754. The worker labeled the result `rate_limited`, stopped immediately, and left 79 queries unprocessed. The coordinator correctly rejected the child job's queue-level `completed` status because its business result was unsuccessful, then exited with status 1. Durable run 3 remains incomplete with Phases 1–3 complete; Phases 5–7 did not start. The HTTP 503 is verified, but retained evidence does not prove whether Google applied a quota, temporary overload, or another service-side restriction. The immediate mitigation is to wait for the upstream condition to clear, increase the existing five-second request interval, and deliberately continue run 3. The durable fix is bounded 503 retry/backoff, resumable query progress, and better response diagnostics.

## Scope

This report covers the scheduled production attempt on October 16, 2026.

Evidence was gathered read-only from:

- `newsnexus-weekly-flow-02.service` and its journal
- `newsnexus-weekly-flow-02.timer`
- `newsnexus12-worker-node.service` and its journal
- worker-node queue job `0290`
- `WeeklyArticleFlowRuns02` row 3
- the Phase 4 coordinator and worker source
- the current operations documentation and environment template

No code, configuration, database records, queues, timers, or services were changed. The only repository change is this report.

## Incident Identity

- Host: `nws-nn12prod`
- Systemd unit: `newsnexus-weekly-flow-02.service`
- Durable run: `WeeklyArticleFlowRuns02` row 3
- RSS child job: `0290`
- Service start: October 16, 2026 at 12:00:35 UTC
- RSS phase start: October 16, 2026 at 12:02:24 UTC
- RSS job end: October 16, 2026 at 16:52:56 UTC
- Service failure: October 16, 2026 at 16:57:36 UTC
- Service result: `failed`, process exit status 1
- Worker-node state after the incident: active and running
- Timer state after the incident: active and waiting
- Next timer trigger observed: October 23, 2026 at 12:00:00 UTC

The service is a scheduled oneshot. It is not expected to remain running between executions. Its failed state reflects the unsuccessful October 16 invocation.

## What Completed

Durable run 3 records:

- `lastPhaseStarted`: 4
- `lastPhaseCompleted`: 3
- `runCompleted`: false
- `rssJobId`: `0290`
- `rssArticlesAddedCount`: 1,797

The following phases completed before the failure:

1. Phase 1: duplicate-analysis cleanup
2. Phase 2: verified database backup
3. Phase 3: eligible old-article deletion

Phase 4 started and produced partial business output, but it did not satisfy the verified-success contract.

No child job IDs were recorded for:

- Phase 5 semantic scoring
- Phase 6 state assignment
- Phase 7 AI Approver V02

These downstream phases did not start.

## RSS Child Job Result

Worker-node queue job `0290` has lifecycle status `completed`. That status means the queue handler returned; it does not mean the RSS business operation succeeded.

Its business result was:

- Ending reason: `rate_limited`
- Queries in spreadsheet: 833
- Successful queries: 753
- Failed queries: 1
- Queries not reached: 79
- Articles added: 1,797
- Failed spreadsheet query: ID 754
- First unprocessed query: ID 755
- Configured delay between requests: 5,000 milliseconds

At 16:52:55 UTC, the worker received HTTP 503 while requesting query 754. It marked that query failed, marked the remaining queries as `not_reached`, and ended the job.

At the coordinator's next five-minute observation, Phase 4 saw the terminal queue record. It preserved the 1,797-article count, recorded `unsuccessful_result`, and exited nonzero with:

```text
RSS job ended without verified success: rate_limited
```

This behavior is consistent with the current coordinator contract: queue completion is not accepted when the worker's ending reason is unsuccessful.

## Failure Timeline

All times are UTC on October 16, 2026.

1. 12:00:35: systemd started the weekly service.
2. 12:00:36: durable run 3 was created.
3. 12:02:24: Phase 4 started and RSS job `0290` was enqueued.
4. 12:02:25: worker-node started job `0290` and loaded 833 spreadsheet rows.
5. 16:52:46: the worker requested query 754.
6. 16:52:55: Google returned HTTP 503.
7. 16:52:56: job `0290` ended with `endingReason=rate_limited` after adding 1,797 articles.
8. 16:57:36: the coordinator observed the terminal result, recorded Phase 4 failure, and exited status 1.

The five-minute gap between child completion and service failure matches the configured Phase 4 status-poll interval.

## Cause Assessment

### Verified direct cause

Google News RSS returned HTTP 503 for query 754. Current worker code treats any RSS HTTP 503 as `rate_limited`, immediately stops the loop, and returns an unsuccessful business result.

Current coordinator code correctly distinguishes queue lifecycle completion from business success. It rejected `endingReason=rate_limited` and stopped the weekly flow.

### Contributing behavior

The worker sent RSS requests with a five-second inter-request delay. The source permits a configured value from 500 through 10,000 milliseconds and defaults to 5,000 milliseconds.

The worker has no bounded retry or cooldown path for HTTP 503. A single 503 therefore terminates the entire 833-query job, even after hundreds of successful requests.

Phase 4 progress is retained at the job level, but the worker does not persist a resumable per-query cursor. Recovery relies on starting another job and using the 72-hour repeat window to skip recently recorded requests.

### Root-cause boundary

The retained evidence proves HTTP 503, but it does not prove Google's reason for returning it.

Possible explanations include:

- request-rate enforcement
- temporary Google service overload
- an automated-traffic restriction
- another upstream availability condition

The worker does not retain selected response headers, a bounded response-body sample, retry metadata, or a rate-limit incident counter. No `Retry-After` value is available in the retained evidence.

There was no kernel OOM evidence during the run. Worker-node remained active, served the final queue-status request, and did not restart. This was not a confirmed worker crash.

## Business Impact

- The weekly flow did not complete.
- Phase 4 produced 1,797 new articles before failing.
- Seventy-nine configured queries were not attempted.
- Semantic scoring, state assignment, and AI Approver V02 did not run.
- Durable run 3 remains incomplete and auditable.
- The timer remains enabled. Its next default invocation is outside the 72-hour automatic continuation window and would create a new run, leaving run 3 incomplete unless an operator explicitly continues it.

The partially added articles are real production output. They should not be deleted or treated as rolled back merely because the coordinator failed.

## Recommended Recovery

Do not start a fresh weekly run or rerun the workflow blindly.

Recommended operator sequence:

1. Preserve durable run 3 and child job `0290` as incident evidence.
2. Allow a cooldown period before contacting Google RSS again.
3. Increase `MILISECONDS_IN_BETWEEN_REQUESTS` for worker-node from 5,000 to 10,000 milliseconds, the current source-supported maximum.
4. Deploy that configuration through the approved worker-node control path and verify worker health.
5. Confirm no conflicting worker-node queue job is active.
6. Deliberately continue run 3 with the documented `--continue-run 3` path under operator authorization.
7. Verify that recently completed URLs are skipped by the 72-hour repeat window and that processing reaches the formerly unprocessed suffix.
8. Reconcile the replacement RSS job, run 3 Phase 4 completion, and all downstream job IDs before declaring recovery.

This is an operational mitigation, not a guaranteed fix. A ten-second delay may reduce request pressure, but HTTP 503 can have causes unrelated to request frequency.

A continuation is preferable to a new run because Phases 1–3 already performed production mutations. The continuation contract is designed to preserve those completed phases and replace an unsuccessful saved Phase 4 job on a later invocation.

## Durable Engineering Recommendation

### 1. Add bounded 503 retry and cooldown

Treat HTTP 503 as potentially transient rather than immediately terminal.

- Honor a valid `Retry-After` header when present.
- Otherwise use exponential backoff with jitter.
- Cap attempts and total cooldown time.
- Keep cancellation responsive during waits.
- Retry the same query without submitting a second queue job.
- End as `rate_limited` only after the bounded policy is exhausted.

Also consider HTTP 429 under the same policy while keeping permanent `4xx` responses distinct.

### 2. Persist resumable query progress

Persist a compact checkpoint containing:

- spreadsheet identity or digest
- current query ID or row index
- last successful query
- cumulative article count
- retry and cooldown state

A replacement attempt should resume from verified progress instead of rescanning the whole spreadsheet and depending only on database repeat-window behavior.

### 3. Separate upstream unavailability from confirmed rate limiting

Do not equate every HTTP 503 with a proven quota event.

Use a classification such as `upstream_unavailable` unless retained response evidence supports `rate_limited`. Keep both the HTTP status and the worker's interpretation.

### 4. Improve safe diagnostics

For failed RSS responses, log structured fields without storing sensitive or excessively large data:

- job ID and query ID
- HTTP status
- request host and a query fingerprint
- request sequence number and elapsed job time
- configured delay
- retry attempt and selected backoff
- selected safe headers such as `Retry-After`, `Date`, and a request or trace ID
- a length-limited, sanitized response-body sample when content type and policy permit

Do not log the full 833-row `queryResults` array in one journal entry. Log summary counts plus the failed query, then retain detailed results in a bounded artifact if needed.

### 5. Add rate-limit telemetry

Record counters for:

- requests attempted per job
- 503 and 429 responses
- retries and cooldown seconds
- successful recovery after retry
- terminal rate-limit events
- remaining unprocessed queries

This will show whether failures correlate with request count, elapsed time, specific query families, or repeated weekly runs.

## Verification Plan for a Future Fix

1. Unit-test a single 503 followed by success.
2. Verify `Retry-After` is honored within configured limits.
3. Test repeated 503 responses ending in a typed terminal result.
4. Verify no query is skipped or submitted twice across retry.
5. Test cancellation during backoff.
6. Test process restart and continuation from a persisted checkpoint.
7. Verify summary logging excludes the full query-result array.
8. Run a nonproduction canary with controlled 503 responses.
9. Perform an operator-authorized production continuation.
10. Confirm Phase 4 completion and downstream Phase 5–7 execution through durable records, not systemd status alone.

## Conclusion

The weekly service failed because Phase 4 received one HTTP 503 and the worker's current policy stopped the remaining RSS workload. The coordinator then correctly refused to treat queue-level completion as business success.

The immediate response should be a cooled-down, slower, explicitly authorized continuation of run 3. The long-term solution is bounded retry/backoff, resumable per-query progress, and diagnostics that can distinguish actual rate limiting from generic upstream unavailability.
