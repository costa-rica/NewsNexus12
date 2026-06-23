---
created_at: 2026-06-23
updated_at: 2026-06-23
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# Weekly continuation implementation TODO v02

Source plan: `docs/20260623_weekly_continuation_plan_v02.md`
Revises: `docs/20260623_weekly_continuation_todo_v01.md`
Assessment addressed: `docs/20260623_weekly_continuation_todo_v01_ASSESSMENT_CLAUDE.md`

## Operator rules for implementers

- [ ] Do not start implementation until the operator explicitly assigns the work.
- [ ] Keep changes scoped to the active phase whenever possible.
- [ ] After each completed phase, run relevant type checks, lint checks, tests where infrastructure exists, and build attempts for touched packages.
- [ ] If any check fails, fix and rerun it before marking the phase complete.
- [ ] After each completed phase and passing verification, check off completed tasks in this TODO and commit only that phase's related changes.
- [ ] Do not push unless the operator later asks.
- [ ] Do not mutate production databases or services during validation.

## Phase 1: Orphan reconciliation correctness

Package areas: `worker-node`, orchestration startup/reconciliation code, orchestration run and step model usage from `db-models`.

- [x] Locate the restart/orphan reconciliation path that currently marks interrupted orchestration runs and steps.
- [x] Change reconciliation to identify affected run ids first.
- [x] Mark only affected `running` runs as failed.
- [x] Update only `OrchestratorRunSteps` rows belonging to affected run ids.
- [x] Preserve the distinction between in-flight and never-started steps:
  - [x] `running` steps at restart become `failed` with `endingReason: "worker_restart"`.
  - [x] `pending` steps remain `pending`, or use a clearly distinct terminal marker such as `never_started_after_worker_restart`.
- [x] Verify reconciliation does not globally update every `running` or `pending` step.
- [x] Add or update tests covering affected-run scoping and in-flight versus never-started step handling.
- [x] Run relevant `worker-node` type checks, tests, and build attempts.
- [x] If checks fail, fix and rerun before marking this phase complete.
- [x] Commit only Phase 1 changes after verification passes.

## Phase 2: Continuation schema and persistence metadata

Package areas: `db-models`, `worker-node`, `db-manager` or docs for controlled schema upgrade, backup/import registry if applicable.

- [x] Extend `OrchestratorRuns` with nullable `sourceOrchestratorRunId`.
- [x] Extend `OrchestratorRuns` with `runMode`, defaulting to `standard`.
- [x] Extend `OrchestratorRuns` with nullable JSONB `continuationPlan`.
- [x] Add the self-reference association for source and continuation runs where associations are centralized.
- [x] Extend `NewsApiRequests` with nullable `orchestratorRunId`.
- [x] Thread `orchestratorRunId` into future weekly Google RSS request persistence.
- [x] Do not add `queryRowId` unless a later implementation step proves it is necessary and documents the row-id contract.
- [x] Provide an explicit idempotent schema upgrade path, such as a documented SQL script or controlled `db-manager` command.
- [x] Do not add hidden `ALTER TABLE` behavior to API or worker startup.
- [x] Confirm backup/replenish/export/import paths include the new columns when those paths are model or registry driven.
- [x] Add or update tests for model initialization and associations where test infrastructure exists.
- [x] Run `db-models` build and relevant `worker-node` type checks, tests, and build attempts.
- [x] If checks fail, fix and rerun before marking this phase complete.
- [x] Commit only Phase 2 changes after verification passes.

## Phase 3: Cheap signal and full assessment contract

Package areas: `worker-node` orchestration routes/services, run-list response code, continuation assessment service.

- [x] Add the cheap list-level continuation signal as fields embedded on each item in the existing recent-runs/list response.
- [x] Do not implement a separate batched cheap-signal endpoint in this first implementation.
- [x] Include fields such as `canRequestContinuationAssessment`, `continuationSignalReasonCode`, and `continuationSignalWarnings`.
- [x] Ensure the cheap signal uses only cheap inputs:
  - [x] source run status
  - [x] run mode
  - [x] presence of `articleIdMinExclusive`
  - [x] presence of `articleIdMaxInclusive`
  - [x] active orchestration run state
  - [x] existing active continuation for the source
- [x] Verify the cheap signal does not read the Google RSS spreadsheet.
- [x] Verify the cheap signal does not scan `NewsApiRequests`.
- [x] Implement `GET /orchestrator/runs/:id/continuation-assessment`.
- [x] Pin the worker-node status-code contract for continuation routes at the source:
  - [x] `GET /orchestrator/runs/:id/continuation-assessment` returns `200` with `eligible`, `blockingReasons`, and the assessment body for existing source runs, including recognized ineligible cases such as running, completed, `completed_no_new_articles`, pre-Google-RSS, already-active-continuation, and recognized unsupported/deferred shapes.
  - [x] `GET /orchestrator/runs/:id/continuation-assessment` returns `404` only when the source run is missing.
  - [ ] `POST /orchestrator/runs/:id/continue` returns `202` with the new continuation run id on success.
  - [x] `POST /orchestrator/runs/:id/continue` returns `404` when the source run is missing.
  - [x] `POST /orchestrator/runs/:id/continue` returns `409` when another orchestration run is active or the source is no longer eligible at POST-time revalidation.
  - [x] `POST /orchestrator/runs/:id/continue` returns `422` for recognized but unsupported shapes, including deferred report-only continuation.
- [x] Make full assessment re-read durable state and return `eligible`, `reasonCode`, source/run mode, article bounds, inherited steps, runnable steps, Google RSS resume plan, retry policy, warnings, and blocking reasons.
- [x] Use run-level bounds as the primary failure-location signal:
  - [x] `articleIdMinExclusive` null means no continuation is needed.
  - [x] `articleIdMinExclusive` set and `articleIdMaxInclusive` null means Google RSS interruption unless stronger evidence blocks it.
  - [x] both bounds set means locate downstream continuation from step details, child job state, and report metadata as advisory signals.
- [x] Represent running, completed, `completed_no_new_articles`, pre-Google-RSS, already-active-continuation, and recognized unsupported shapes as `200` assessment responses with `eligible: false` and populated `blockingReasons`; use `404` only for a missing source run.
- [x] Treat unrecognized failure shapes as blocking and choose the status/body according to the pinned contract above.
- [x] Recognize report-only continuation as unsupported or deferred in this first implementation.
- [x] Add tests for cheap signal behavior and full assessment blocking/eligible cases.
- [x] Run relevant `worker-node` type checks, tests, and build attempts.
- [x] If checks fail, fix and rerun before marking this phase complete.
- [x] Commit only Phase 3 changes after verification passes.

## Phase 4: Google RSS resume planning

Package areas: `worker-node` Google RSS automation, query spreadsheet helpers, `NewsApiRequests` matching, continuation assessment.

- [x] Extract reusable helpers for reading the weekly query spreadsheet.
- [x] Extract or reuse helpers for normalizing query row fields.
- [x] Extract or reuse helpers for building the Google RSS query and final RSS URL.
- [x] Extract or reuse helpers for database strings used as `andString` and `orString`.
- [x] In full assessment, build expected RSS URLs for each spreadsheet row.
- [x] Match persisted automation requests for the source run using exact `url` first.
- [x] Add fallback matching using `andString`, `orString`, `isFromAutomation`, status, counts, and timestamps.
- [x] Verify fallback matching does not use `notString` unless the Google RSS job first persists a meaningful value for it.
- [x] Pick the latest matching query row as the resume marker.
- [x] Plan resumed Google RSS to start after the last persisted matching request.
- [x] Plan start from the first query row when no persisted match exists.
- [x] Accept a resume plan in the Google RSS job request body for continuation runs.
- [x] Skip spreadsheet rows until passing the resume marker, then process remaining rows normally.
- [x] Preserve the allowed one-request replay behavior when a request was started but never recorded in `NewsApiRequests`.
- [x] Add tests for last URL match, no-match first-row behavior, and fallback matching without `notString`.
- [x] Run relevant `worker-node` type checks, tests, and build attempts.
- [x] If checks fail, fix and rerun before marking this phase complete.
- [x] Commit only Phase 4 changes after verification passes.

## Phase 5: Continuation creation and coordinator branching

Package areas: `worker-node` orchestration routes/services/coordinator, step creation, report generation.

- [x] Implement `POST /orchestrator/runs/:id/continue`.
- [x] Re-run full assessment inside the POST handler immediately before creating a continuation.
- [x] Reject no-longer-eligible requests with an appropriate status and response body.
- [x] Create a new `OrchestratorRun` with `runMode: "continuation"`, `sourceOrchestratorRunId`, and the exact full assessment saved in `continuationPlan`.
- [x] Copy relevant source settings such as `aiApproverEnabled` and `semanticScorerEnabled`.
- [x] Create normal step rows for the continuation run.
- [x] Mark inherited steps as `skipped` with `endingReason: "inherited_from_source_run"` and result metadata linking source step and child job ids where available.
- [x] Extend coordinator configuration to include source run id, inherited steps, first runnable step, article lower bound, planned upper bound, Google RSS resume plan, and AI Approver retry policy.
- [x] Replicate the existing inline active-run guard for `POST /continue` so standard and continuation runs cannot overlap.
- [x] Call `invalidateActiveRunCache()` after creating a continuation run, matching the existing start-route cache invalidation behavior.
- [x] Preserve normal weekly run behavior as the default path.
- [x] Seed continuation run `articleIdMinExclusive` from the source run or saved `continuationPlan` before any runnable continuation step starts.
- [x] For continuation runs, do not call `captureMaxArticleId()` to recapture `articleIdMinExclusive` when `google_rss` is a runnable step.
- [x] Keep the continuation lower bound fixed at the source `articleIdMinExclusive` for all downstream steps, including the run-14-style Google RSS replay path.
- [x] Capture current global max article id only for the upper bound when continuation reaches downstream processing.
- [x] Save that current global max as the continuation `articleIdMaxInclusive`.
- [x] Add warnings when the planned global article range may include articles from unrelated later runs or manual ingestion.
- [x] Verify warnings appear in `continuationPlan` and generated reports.
- [x] Add tests for linked run creation, inherited steps, coordinator branching, active-run guard, and global max article-id warnings.
- [x] Run relevant `worker-node` type checks, tests, and build attempts.
- [x] If checks fail, fix and rerun before marking this phase complete.
- [x] Commit only Phase 5 changes after verification passes.

## Phase 6: AI Approver continuation retry support

Package areas: `worker-python` AI Approver, AI score repository/data-access code, worker-node AI Approver request payloads.

- [x] Ensure continuation invokes AI Approver in `gatekeeper` mode.
- [x] Pass `requireStateAssignment: true`, article bounds, limit based on planned article count, and continuation retry policy.
- [x] Keep retry policy conservative:
  - [x] process missing gatekeeper rows
  - [x] process missing category rows only for completed gatekeeper pass rows
  - [x] retry transient failed rows for rate limit, cancellation, timeout, or worker interruption
  - [x] do not automatically retry `invalid_response` rows in the first implementation
- [x] Add a retry-selection query for existing score rows inside continuation bounds whose `resultStatus` is retryable.
- [x] Add an `update_score_row` repository method that overwrites the selected retryable failed row in place.
- [x] Ensure retry selection bypasses normal skip-existing behavior only for rows selected by the retry-selection query.
- [x] Verify successful rows, non-retryable failed rows, and rows outside bounds are not re-touched.
- [x] Preserve audit metadata on updates, including previous status, previous error, source job id, continuation job id, retry timestamp, and previous metadata.
- [x] Add tests for missing rows, completed-row skipping, retry-selection, `update_score_row`, and default `invalid_response` exclusion.
- [x] Run relevant `worker-python` tests/checks where infrastructure exists and relevant `worker-node` type checks/tests/build attempts for payload integration.
- [x] If checks fail, fix and rerun before marking this phase complete.
- [x] Commit only Phase 6 changes after verification passes.

## Phase 7: API proxy routes

Package areas: `api` automation routes/proxy code, auth middleware, worker-node client/proxy helpers.

- [ ] Add authenticated proxy route `GET /automations/orchestrator/runs/:id/continuation-assessment`.
- [ ] Add authenticated proxy route `POST /automations/orchestrator/runs/:id/continue`.
- [ ] Preserve worker-node response bodies and the pinned continuation status-code contract from Phase 3.
- [ ] Explicitly verify preservation for:
  - [ ] `200` assessment responses, including recognized ineligible cases with `eligible: false` and `blockingReasons`
  - [ ] `202` accepted continuation starts with new continuation run id
  - [ ] `404` missing source run responses
  - [ ] `409` active-run or no-longer-eligible POST responses
  - [ ] `422` recognized unsupported-shape POST responses
- [ ] Preserve cheap continuation signal fields through any runs-list proxy path.
- [ ] Add or update API tests for authentication and status preservation.
- [ ] Run relevant `api` tests, type checks, and build attempts.
- [ ] If checks fail, fix and rerun before marking this phase complete.
- [ ] Commit only Phase 7 changes after verification passes.

## Phase 8: Portal continuation UI

Package areas: `portal` weekly orchestration dashboard, API client layer, Redux slices or hooks if used, modal components.

- [ ] Render the `continue` action only from the cheap list-level continuation signal.
- [ ] Read cheap continuation signal fields from the existing past-runs/list response; do not add a separate cheap-signal portal fetch in this first implementation.
- [ ] Do not fetch full assessment during table rendering or polling.
- [ ] Disable continuation action while any orchestration run is active.
- [ ] Fetch full assessment only when the operator opens the confirmation modal.
- [ ] Build confirmation modal behavior showing:
  - [ ] source run id
  - [ ] new run type `continuation`
  - [ ] inherited steps
  - [ ] runnable steps
  - [ ] article lower bound
  - [ ] planned article upper bound
  - [ ] Google RSS resume behavior when applicable
  - [ ] warnings, including global article range warnings
- [ ] Use primary visible button text `continue`.
- [ ] Use secondary small text or tooltip `from where left off`.
- [ ] On confirm, call `POST /continue` and let the server revalidate.
- [ ] Branch on the pinned worker-node/API status-code contract:
  - [ ] Treat `200` assessment responses with `eligible: false` and `blockingReasons` as a non-continuable source state to explain in the modal.
  - [ ] Treat `202` POST responses as a successfully accepted continuation and refresh run state.
  - [ ] Treat `404` as a missing source run.
  - [ ] Treat `409` as active-run conflict or no-longer-eligible after POST-time revalidation.
  - [ ] Treat `422` as a recognized unsupported shape.
- [ ] Refresh active-run and past-run state after a continuation starts.
- [ ] Verify modal close, cancel, loading, error, retry, and success states.
- [ ] Verify strict TypeScript and ESLint expectations, including no `any`.
- [ ] Add or update portal tests if existing infrastructure supports the touched area.
- [ ] Run `portal` lint and build attempts.
- [ ] If checks fail, fix and rerun before marking this phase complete.
- [ ] Commit only Phase 8 changes after verification passes.

## Phase 9: Manual validation and regression pass

Package areas: `db-models`, `worker-node`, `worker-python`, `api`, `portal`; local restored data only.

- [ ] Validate run 11 assessment manually against restored local data:
  - [ ] source run id `11`
  - [ ] source status `timed_out`
  - [ ] AI Approver timeout recognized
  - [ ] `articleIdMinExclusive` and `articleIdMaxInclusive` both set
  - [ ] inherited steps are `delete_articles`, `google_rss`, and `state_assigner`
  - [ ] runnable steps are `ai_approver`, `semantic_scorer`, and `report`
  - [ ] lower bound comes from source `articleIdMinExclusive`
  - [ ] upper bound is current global max article id at continuation time
  - [ ] AI mode is `gatekeeper`
  - [ ] warning explains unrelated later ingestion may be included and idempotency is the safety net
- [ ] Validate run 14 assessment manually against restored local data:
  - [ ] source run id `14`
  - [ ] source status `failed`
  - [ ] worker restart during Google RSS recognized
  - [ ] `articleIdMinExclusive` set and `articleIdMaxInclusive` null
  - [ ] inherited step is `delete_articles`
  - [ ] runnable steps are `google_rss`, `state_assigner`, `ai_approver`, `semantic_scorer`, and `report`
  - [ ] Google RSS resume matches spreadsheet rows to `NewsApiRequests`
  - [ ] exact URL matching is preferred
  - [ ] fallback uses `andString`, `orString`, automation flag, status, counts, and timestamps
  - [ ] fallback does not use `notString`
  - [ ] no persisted match starts at the first query row
  - [ ] downstream lower bound equals the source `articleIdMinExclusive`, not a freshly captured continuation-time value
  - [ ] downstream upper bound is current global max article id after resumed Google RSS completes
  - [ ] AI mode is `gatekeeper`
  - [ ] warning explains unrelated later ingestion may be included
- [ ] Validate a normal weekly orchestration still starts and follows the standard path.
- [ ] Validate source runs are preserved and not overwritten by continuation runs.
- [ ] Validate continuation reports include continuation run id, source run id, run mode, inherited steps, runnable steps, article bounds, Google RSS resume marker when applicable, AI Approver counts, and warnings.
- [ ] Run final relevant checks across touched packages:
  - [ ] `db-models` build
  - [ ] `worker-node` tests and build
  - [ ] `worker-python` tests/checks where available
  - [ ] `api` tests and build
  - [ ] `portal` lint and build
- [ ] If checks fail, fix and rerun before marking this phase complete.
- [ ] Commit only Phase 9 validation/TODO updates after verification passes.
