---
created_at: 2026-10-01T21:58:44Z
updated_at: 2026-10-01T23:18:45Z
created_by: codex (gpt-6) nicksmacbookair
modified_by: codex (gpt-6) nicksmacbookair
---

# Worker Python Deduper Clear Todo V01

## Scope and review

- Requirements: [Worker Python Deduper Clear PRD V01](20261001_worker_python_deduper_clear_prd_v01.md), reviewed by Claude with no concerns reported by the operator.
- Complete this endpoint change before connecting the working weekly phase 1 module. The coordinator scaffold is separate work and is not part of this todo.
- This todo includes the focused implementation approach for Claude to vet under [Plan and Vet](../PLAN_AND_VET.md). Do not treat the PRD review as an assessment of this new todo or its concurrency design.
- Work in small increments with the operator. Review each implementation phase and its verification before moving to the next. Do not deploy a partially completed endpoint change.
- The operator approved the configurable 30-second cancellation timeout on 2026-10-01 and directed implementation to begin.

## Implementation progress

- Phase 1 helpers and Phase 2 endpoint integration are implemented. Plain DELETE requests now cancel only deduper jobs, wait for execution to end, and clear the table. The broad cancellation helper is removed; unrelated services and jobs remain running.
- The endpoint reports 409 for conflicts, 504 for cancellation timeout, and 500 for other failures, preserving cancellation results. Success includes the committed DELETE count in `rowsDeleted`. Deduper start routes retain their successful response contract.
- Validation: 87 focused configuration, queue, job-manager, deduper, and clear-route tests passed using an isolated temporary PostgreSQL instance. The temporary instance was stopped and removed. Python syntax checks passed; no dedicated Python build/lint/type-check command is configured.
- Additional route checks cover unrelated queue progress during deletion and unchanged successful deduper starts. README and worker API documentation were updated with the endpoint behavior and configuration.
- Both deduper start routes use the same job manager and admission guard. The supported deployment remains one queue-owning process; actual Ubuntu process counts and server behavior still need verification before deployment.
- Phase 2 awaits operator review. Full-suite/API-proxy regression checks and Ubuntu validation remain Phase 3/4 work. No coordinator or production deployment changes were made.

## Implementation approach to vet

1. Keep the endpoint and the existing shared queue. All current deduper submissions enter through `JobManager.enqueue_deduper_job()`, including report-specific submissions.
2. Add a deduper-only operation guard shared by submission and clearing in the active job manager. Hold it briefly during deduper enqueue and across cancellation, waiting, and deletion during clearing. Reject competing deduper submissions and clear requests with HTTP 409 while the guard is held.
3. Do not acquire this guard inside a running deduper handler. That handler must remain able to finish and close its repository while the clear request waits. Unrelated job submission and execution must not acquire the guard.
4. While holding the guard, filter queued/running records by `DEDUPER_ENDPOINT_NAME`, cancel only those jobs, and verify their execution has ended. Use the existing queue's active-job identity plus job records, not a global-idle wait.
5. Use a monotonic deadline and a short bounded polling interval for completion checks, with controllable timing in tests. Cover the transition where the engine has selected an active job but has not yet updated its stored status.
6. Delete only after confirming no affected deduper execution remains active. Release the guard on success, timeout, or exception. Preserve the existing internal clear-before-analysis operation; it must not call the endpoint-level cancellation path or try to cancel itself.
7. The guard is local to the service's existing queue owner. Confirm the deployment uses a single queue-owning worker process before relying on it. If multiple processes can execute deduper work against the same database, bring that conflict to the operator before implementation rather than adding a cross-process framework silently.

## Proposed response contract

| Outcome | HTTP status | Behavior |
| --- | --- | --- |
| Deletion committed, including zero rows | 200 | `cleared = true`, accurate `rowsDeleted`, existing success fields retained. |
| Another clear or deduper submission holds the guard | 409 | No new cancellation or deletion; return an actionable busy response. |
| Running deduper did not exit within the wait | 504 | `cleared = false`; do not execute deletion. |
| Invalid server configuration or database/internal failure | 500 | `cleared = false`; report the failure and release coordination. |

- For clear responses, `cancelledJobs` contains only jobs confirmed canceled by this operation. A job that finishes normally during the race is not reported as canceled.
- Add `cancellationRequestedJobs` to clear responses to identify running jobs signaled for cancellation. This field records requests, not proof of cancellation; it may overlap with `cancelledJobs` after confirmation.
- Retain `exitCode`, `stdout`, `stderr`, and `timestamp` on success. Failure responses retain `error` and include the known cancellation results instead of discarding them when an exception occurs.
- Keep existing successful deduper job-start responses unchanged. Their new 409 response applies only when admission conflicts with the guarded operation. Preserve the separate per-job cancellation endpoints.

## Phase 1: scoped cancellation primitives

- [x] Record the operator-approved `DEDUPER_CLEAR_CANCEL_TIMEOUT_SECONDS` setting: positive integer, default 30 seconds. Review the implemented guard and wait with the operator during this increment's closeout before endpoint integration.
- [ ] Confirm every live deduper enqueue path uses the same job manager and guard, and confirm the single queue-owner deployment assumption. Record the supported scope without changing deployment configuration.
- [x] Before database-backed tests, explicitly select a disposable PostgreSQL database and isolate queue/log paths. `tests/conftest.py` uses `setdefault`, and `reset_public_schema()` drops the public schema; inherited environment values must not select the development or production database by accident.
- [x] Add timeout parsing and focused validation tests using the existing deduper configuration conventions. Reject invalid values before cancellation or deletion begins.
- [x] Add the deduper-only guard and helper operations in `src/services/job_manager.py` or a small deduper helper module. Leave unrelated queue behavior intact; do not hold the queue engine's state lock during waiting or database work.
- [x] Implement filtered cancellation and bounded completion checking using the existing queue methods. Handle jobs completing between selection and cancellation, queued-to-running transitions, and cancellation requests that remain pending.
- [x] Add deterministic helper tests in `tests/unit/deduper/test_clear_control.py`, alongside configuration tests, and run relevant existing queue/job-manager checks. Use events/barriers and isolated queue stores rather than relying on long sleeps.
- [x] Verify a mixed queue preserves unrelated jobs, the helper waits for an affected running handler to exit, it does not wait for unrelated work, and timeout prevents the caller from reaching its deletion step. Real endpoint deletion tests remain Phase 2 work.
- [ ] Complete the phase closeout below: applicable checks, focused tests, Python syntax verification, checked-off tasks, task-related commit, and operator review. Keep the endpoint marked unfinished until Phase 2 is complete.

## Phase 2: endpoint integration

- [x] Integrate the guard into `enqueue_deduper_job()` so both existing deduper start routes reject conflicting submissions with the proposed 409 response. Do not enqueue a job or leave an orphan queue record on rejection.
- [x] Replace `run_clear_table()`'s broad cancellation with the guarded deduper-only sequence: select, cancel, await execution exit, delete, and report. Remove `cancel_all_active_jobs()` if the repository search confirms no remaining callers.
- [x] Check for affected deduper work immediately before deletion while retaining the guard. Ensure a second clear or new deduper submission cannot enter the protected interval. Do not wait for the whole worker-python queue to drain.
- [x] Add `rowsDeleted` to the clear result through the deduper repository/orchestrator boundary. Use the committed DELETE's affected-row count rather than reporting an unverified pre-delete count as actual deletion.
- [x] Preserve `DeduperOrchestrator.run_analyze()` and `run_analyze_fast()` using their internal clear-first path. Endpoint coordination must not cause a running deduper to wait for or cancel itself.
- [x] Update `src/routes/deduper.py` to return the agreed success, busy, timeout, and failure responses. Keep the DELETE endpoint argument-free and provide no cancellation-all option or fallback.
- [x] Preserve actual cancellation results on failures. Release the guard and close any opened repository in all exit paths, including configuration, cancellation, and database errors.
- [x] Log selected deduper IDs, requests, confirmed cancellations, wait duration, affected rows, and failure context through the existing worker-python logger. Do not log credentials.
- [x] Extend `tests/integration/test_routes.py`, `tests/unit/test_job_manager.py`, and relevant deduper tests for success, empty table, timeout, concurrent clear, conflicting job starts, database failure, and successful reuse after a failure releases the guard.
- [x] Test that an unrelated job can finish and another unrelated job can progress during the clear operation. Verify canceled queued deduper jobs never execute and a running deduper cannot write after clearing starts.
- [ ] Review Phase 2 with the operator before progressing. Implementation, focused tests, syntax checks, and documentation are complete; commit this increment under the phase closeout rules.

## Phase 3: regression checks and documentation

- [ ] Verify the API proxy in `api/src/routes/analysis/deduper.ts` still forwards successful responses and preserves non-success status codes and worker details. Add a focused regression test where existing API test infrastructure supports it; change production proxy code only if a demonstrated incompatibility requires it.
- [ ] Confirm portal location-scoring cancellation and AI Approver V02 cancellation still use their existing individual-job/run paths. Neither should acquire the deduper guard or depend on the clear endpoint.
- [ ] Update `worker-python/docs/worker-python-api-documentation/endpoints/deduper.md` with deduper-only behavior, bounded waiting, `rowsDeleted`, string job IDs, and failure examples. Document the new 409 behavior for deduper start routes and update the active API proxy documentation where needed.
- [ ] Document the timeout setting and single queue-owner assumption in the appropriate worker-python configuration documentation. State that the worker service and unrelated jobs remain running.
- [ ] Run the focused job-manager, deduper, queue, route, and queue-contract suites against isolated fixtures and the explicitly selected disposable database. Run the full worker-python suite once after the final implementation changes to check shared-queue regressions.
- [ ] Verify a real PostgreSQL clear preserves the table and schema, empties analysis rows, returns the correct count, and leaves seeded unrelated data unchanged. Include a second clear returning zero.
- [ ] Record the checks performed and any limitation that still prevents completion. Do not count mocked tests as database or Ubuntu verification.
- [ ] Complete the phase closeout below, including any applicable API checks if that package changed, and review the results with the operator.

## Phase 4: Ubuntu development validation

- [ ] With the operator, validate the completed change on the Ubuntu development server using a test worker instance connected to a disposable database and isolated queue/log paths. Confirm the intended service user and Python environment.
- [ ] Exercise mixed-job cancellation, a deliberately slow-to-stop deduper, timeout without deletion, concurrent requests, and a successful table clear. Use controlled test jobs rather than interfering with ordinary server workloads.
- [ ] Verify the normal no-argument DELETE request protects unrelated workflows and produces the documented logs and response. Confirm there is no cancellation-all option.
- [ ] Record macOS and Ubuntu results and identify any remaining production rollout work. Production deployment is a separate operator-directed action.
- [ ] Complete the phase closeout below for any code or documentation changed during validation. Mark this prerequisite ready for the weekly phase 1 module only after the required validation succeeds.

## Phase closeout

At the end of each phase:

1. Run applicable type or lint checks if configured. Worker-python currently has no dedicated type-check or lint command; record this rather than inventing a tool installation requirement.
2. Run tests appropriate to that phase and fix failures without removing required behavior. For worker-python, use its virtual environment and existing pytest infrastructure. Review the database target before invoking suites that reset schemas.
3. Verify Python syntax with `./venv/bin/python -m compileall -q src` from `worker-python`. This is a syntax check, not a packaged build; no separate Python build target currently exists. If another package changes, run its applicable build and checks too.
4. Check off only completed and verified tasks. Record unavailable external validation as pending, not successful.
5. Commit only changes related to the completed phase, including its todo progress. Follow root commit-message guidance and reference this todo and phase. Do not include unrelated operator changes or push unless instructed.
6. Explain the small increment to the operator and review the next one before continuing. Do not continue into weekly coordinator implementation automatically.
