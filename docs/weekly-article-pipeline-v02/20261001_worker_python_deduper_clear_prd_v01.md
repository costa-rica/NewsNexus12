---
created_at: 2026-10-01T21:45:25Z
updated_at: 2026-10-01T21:54:01Z
created_by: codex (gpt-6) nicksmacbookair
modified_by: codex (gpt-6) nicksmacbookair
---

# Worker Python Deduper Clear PRD V01

## Purpose

Make `DELETE /deduper/clear-db-table` cancel only deduper jobs and wait for running deduper work to stop before clearing `ArticleDuplicateAnalyses`. The weekly pipeline's phase 1 module will reuse this endpoint, keeping the database operation inside worker-python.

- This is a focused prerequisite for the working phase 1 module in [Weekly Combined Flow PRD V05](20261001_weekly_combined_flow_prd_v05.md).
- It applies to every caller of the existing endpoint, not only the weekly pipeline.
- [Ops Plan V01](20261001_weekly_pipeline_ops_plan_v01.md) defines phase 1 as an HTTP caller of this endpoint. Implement and verify this prerequisite before connecting the working phase 1 module.
- The initial ops scaffold remains a logging stub. This document does not expand that first increment into endpoint or database execution.

## Current behavior and problem

1. The route calls `JobManager.run_clear_table()` in `worker-python/src/services/job_manager.py`.
2. Its cancellation helper visits every queued or running job in the shared worker-python queue, without filtering by workflow. AI Approver V02 and location-scoring jobs can therefore be canceled along with deduper jobs.
3. Running-job cancellation is cooperative. The queue signals a cancellation request and returns before the running job has necessarily stopped.
4. The endpoint immediately proceeds to count and delete analysis rows. A deduper still executing can race with that deletion and write more rows afterward.
5. The endpoint currently takes no arguments for selecting which workflow to cancel.

## Required behavior

1. Preserve `DELETE /deduper/clear-db-table` as the public endpoint. Every call cancels only deduper jobs, waits for running deduper work to stop, and clears `ArticleDuplicateAnalyses`. Remove this endpoint's all-job cancellation behavior entirely; provide no argument, configuration option, or fallback that cancels other workflows.
2. Identify deduper jobs using the existing queue identity, `JobManager.DEDUPER_ENDPOINT_NAME`, currently `/deduper/start-job`. Include both ordinary and report-specific deduper jobs, which use that identity.
3. Cancel queued deduper jobs and request cooperative cancellation of running deduper work. Do not cancel, modify, or remove unrelated queued or running jobs. Keep the worker-python service running; this endpoint stops deduper work, not the service process.
4. Wait until the affected running deduper execution has actually exited before deleting rows. A cancellation request or response message alone is not evidence that it has stopped writing.
5. Prevent another deduper job from starting between cancellation selection and completion of the deletion. Coordinate concurrent clear requests so they cannot bypass this protection. Review the small coordination mechanism during planning; reuse the existing queue.
6. Do not wait for the entire shared queue to become idle. Unrelated jobs may continue under its normal scheduling behavior while the deduper operation is coordinated.
7. After deduper writers have stopped, delete all rows from `ArticleDuplicateAnalyses`, preserving its table, schema, and unrelated data. Return success only after the deletion commits. An already empty table is a successful clear with zero rows deleted.
8. Allow later deduper work to run normally after the clear operation ends. The endpoint does not promise the table will remain empty after subsequent analysis starts.

## Bounded waiting and failure

- Use a finite, configurable wait for running deduper work to stop. The initial timeout is the open decision below.
- If the timeout expires or stopping the deduper cannot be verified, do not begin deletion. Return a non-success HTTP response with `cleared = false` and an actionable explanation.
- Distinguish jobs whose cancellation was requested from jobs confirmed canceled. Do not report a still-running job as successfully stopped.
- If deletion fails, report the failure rather than claiming success. Release temporary coordination in all exit paths. Cancellation already performed is not undone by a later deletion failure.
- Preserve failure details in worker logs and the response. Exact failure status codes and any additional response fields should be specified in the implementation plan against current callers.

## Response compatibility and logging

1. Keep the successful response fields currently used by callers: `cleared`, `cancelledJobs`, `exitCode`, `stdout`, `stderr`, and `timestamp`. `cancelledJobs` must contain only deduper jobs confirmed canceled by this operation.
2. Continue returning HTTP 200 for a successful committed clear. Preserve the readable deleted-row summary and add a numeric `rowsDeleted` field so the phase module can log the result without parsing prose.
3. Log the deduper jobs targeted, cancellation requests and confirmed outcomes, wait duration, deletion result, and any failure using worker-python's existing logger.
4. The later phase 1 module makes the HTTP request, validates the result, and records it through the coordinator's logger. It must not treat a timeout or unsuccessful response as a completed phase.
5. Update worker-python's active API documentation and affected caller tests with the clarified behavior. Do not rename the endpoint or replace the queue.

## Acceptance criteria

- A plain DELETE request with no arguments performs deduper-only cancellation and table clearing. No supported option or failure path enables cancellation of unrelated workflows.
- With a mixed queue, only deduper jobs are canceled; AI Approver V02 and location-scoring jobs keep their normal execution and queue records.
- A running deduper that delays responding to cancellation causes deletion to wait until its execution exits.
- A cancellation timeout causes no deletion and produces a clear failure response.
- A new deduper request or concurrent clear request cannot introduce a deduper write during clearing.
- With no deduper work active, clearing succeeds without waiting for unrelated jobs to finish.
- Successful clearing returns an accurate `rowsDeleted`, including zero for an empty table, while preserving the existing successful response fields.
- A database failure releases coordination and reports failure without falsely claiming rows were cleared.
- Focused tests cover the job manager, route contract, and queue interaction. A destructive integration check uses a disposable PostgreSQL database and verifies the table and unrelated data remain intact.

## Implementation approach

- Follow plan-and-vet for this focused change. Keep implementation in the existing worker-python route, job manager, queue integration, and repository boundaries as appropriate.
- Replace the clear endpoint's use of `cancel_all_active_jobs()` with deduper-scoped cancellation. Remove the broad helper if it has no remaining callers; retain the separate per-job cancellation routes used by other workflows.
- Review the cancellation filter, completion wait, concurrent-start protection, and response handling with the operator in small increments.
- Validate locally on macOS, then on the Ubuntu development server before the weekly phase 1 module relies on the endpoint.
- Do not implement the weekly coordinator, later phases, a replacement queue, or a broader scheduler as part of this change.

## Open Questions

### 1. Cancellation wait timeout

How long should the endpoint wait for running deduper work to stop before returning a failure without clearing the table?

#### Operator Response

(codex) Recommend a configurable 30-second default. If deduper work does not stop in that time, return failure without deleting rows.
