---
created_at: 2026-10-03T20:46:21Z
updated_at: 2026-10-03T21:06:09Z
created_by: codex (gpt-6) nicksmacbookair
modified_by: codex (gpt-6) nicksmacbookair
---

# Weekly Flow 02 Persistence Todo V02

## Basis and scope

- Product requirements: [Weekly Combined Flow PRD V09](20261003_weekly_combined_flow_prd_v09.md).
- Approved plan: [Weekly Flow 02 Persistence Plan V03](20261003_weekly_flow_02_persistence_plan_v03.md).
- Phase contracts: [Weekly Flow 02 Phase Inputs and Outputs V01](20261003_weekly_flow_02_phase_inputs_outputs_v01.md).
- Previous todo: [Weekly Flow 02 Persistence Todo V01](20261003_weekly_flow_02_persistence_todo_v01.md).
- V01 assessment: [Assessment by Claude](20261003_weekly_flow_02_persistence_todo_v01_assessment_claude.md).
- Review process: [Plan and Vet](../PLAN_AND_VET.md).

Codex is the todo creator. Claude is the assessor unless the operator changes either role.

This increment adds durable run records, recovery selection, Phase 1–3 persistence, and same-host overlap protection. It prepares the coordinator to begin Phase 4 work without implementing RSS collection.

This increment does not install or enable a timer, implement Phases 4–7, send notifications, migrate legacy run history, or deploy to production.

## Working agreement

1. Complete implementation phases in order.
2. Use one operator checkpoint for development-server backup, schema rebuild, lock verification, and the persisted run.
3. Keep default tests independent of PostgreSQL and package `.env` files.
4. Never point automated tests at `newsnexus_dev` or `newsnexus_prod`.
5. Do not run the real weekly-flow entry point on macOS.
6. Preserve unrelated operator changes.
7. Check off work only after recording its evidence.
8. Do not install, enable, or start a systemd timer in this increment.
9. Do not push unless the operator requests it.

## Fixed implementation decisions

- Model class: `WeeklyArticleFlowRun02`
- PostgreSQL table: `WeeklyArticleFlowRuns02`
- Runtime lock: `ops/.runtime/weekly-flow-02.lock`
- Occupied-lock exit code: `75`
- Future systemd service setting: `SuccessExitStatus=75`
- Guard malfunction: ordinary nonzero failure, never an accepted conflict
- Default continuation window: 72 hours from `runStartedAt`
- Exactly 72 hours: within the continuation window
- Lock scope: one Ubuntu host and one operational checkout
- Lock ownership: the coordinator retains the descriptor; child inheritance is not required

Exit code 75 means another coordinator already owns the lock. Missing `flock`, an unusable runtime directory, or another launcher error must use a different nonzero status.

## Implementation phase 0: Baseline and planning commit

- [x] Review the PRD, approved plan, assessments, and this todo for unresolved blocking concerns.
- [x] Confirm the worktree contains only expected operator and planning changes.
- [x] Record Node and npm versions.
- [x] Run the complete ops test suite and record its count.
- [x] Run ops type checking and a clean production build.
- [x] Build `db-models`, db-manager, and ops in dependency order.
- [x] Confirm no local test loads package `.env` files or connects to PostgreSQL.
- [x] Commit the approved documentation baseline before runtime implementation.

### Phase 0 verification record

- Environment: macOS on `nicksmacbookair`, Node `v24.11.0`, npm `11.6.1`.
- Planning review: PRD V09, Persistence Plan V03, both TODO versions, and Claude's V01 TODO assessment contained no unresolved blocking concern after V02.
- Worktree scope: only the expected Weekly Flow 02 documentation files were uncommitted.
- Ops baseline: 57 tests passed across 11 suites; no failures, skips, or todos.
- Ops type checking and clean production build passed.
- Dependency build order passed: `db-models`, db-manager, then ops.
- Default ops tests used injected process and HTTP seams and did not connect to PostgreSQL or load package `.env` files.

## Implementation phase 1: Shared run model

### Model definition

- [x] Add `db-models/src/models/WeeklyArticleFlowRun02.ts`.
- [x] Use `WeeklyArticleFlowRuns02` as the exact table name with Sequelize timestamps enabled.
- [x] Add the identity, completion, phase, backup, RSS, worker-job, and threshold fields from Persistence Plan V03.
- [x] Store `backupByteSize` as PostgreSQL `BIGINT` and represent it safely in TypeScript without assuming every value fits a JavaScript integer.
- [x] Use JSONB objects for `phaseData` and `lastError`.
- [x] Default `phaseData` to `{}` and `runCompleted` to `false`.
- [x] Validate phase numbers from 1 through 7 when present.
- [x] Validate non-negative counts and positive IDs when present.
- [x] Validate a 64-character lowercase hexadecimal backup SHA-256 when present.
- [x] Do not add lifecycle-status, queue, lease, lock, PID, or active-run columns.
- [x] Do not add cascading foreign keys for the saved first RSS IDs.
- [x] Do not add associations that can delete or alter run history.

### Package integration

- [x] Initialize and export `WeeklyArticleFlowRun02` from `db-models/src/models/_index.ts`.
- [x] Add it to `MODEL_LOAD_ORDER` so backup and restore code sees it in a stable order.
- [x] Confirm old backup manifests without its CSV remain acceptable during replenish.
- [x] Build `db-models` and inspect its declarations.
- [x] Confirm no schema change is attempted from the Mac workstation.

### Phase 1 verification

- [x] Run the `db-models` build.
- [x] Build db-manager against the new export.
- [x] Inspect the model for exact names, nullability, defaults, and absence of coordination columns.
- [x] Record verification results below.

### Phase 1 verification record

- `db-models` and db-manager builds passed with the new export.
- Compiled declarations expose `backupByteSize` as `string | null` and export the new model and attribute types.
- A database-free Sequelize validation check accepted a default run, rejected completed phase greater than started phase, and exposed the nullable-JSON validator issue before it was fixed.
- Zip-import inspection confirmed missing CSV files are skipped and JSONB fields are normalized through model metadata.
- No PostgreSQL connection or schema write occurred on macOS.

## Implementation phase 2: Persistence boundary

### Database-free contracts

- [x] Add focused persistence types under `ops/src/weekly-flow-02/` without importing `db-models` at module load.
- [x] Define the repository operations the coordinator needs: latest-run lookup, run lookup by ID, creation, phase start, verified phase completion, failure recording, and terminal completion.
- [x] Keep run selection and recovery decisions outside the Sequelize adapter.
- [x] Represent database JSON as validated records rather than unrestricted `any`.
- [x] Add `@newsnexus/db-models` to the ops workspace dependency and update the root lockfile.

### Ops database configuration

- [x] Add `PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_USER`, `PG_PASSWORD`, and `PG_SCHEMA` placeholders to `ops/.env.example`.
- [x] Identify `PG_USER` as the application role and use `newsnexus_app` in the example.
- [x] Explain that bootstrap-owner credentials belong only in the db-manager schema workflow.
- [x] Document the ops PostgreSQL variables in `ops/README.md` without including real credentials.
- [x] Preserve the existing db-manager child-environment removal of every inherited `PG_*` value.
- [x] Preserve and name the existing sentinel test proving db-manager children receive no ops PostgreSQL credentials.

### Sequelize adapter and loading

- [x] Add one focused Sequelize persistence adapter.
- [x] Keep all runtime `db-models` loading behind an asynchronous factory.
- [x] In `index.ts`, load ops configuration before calling that factory.
- [x] Initialize models once and pass repository functions through the coordinator dependencies object.
- [x] Close the Sequelize connection during normal and failed entry-point shutdown.
- [x] Never import `db-models` from the coordinator or any phase module.
- [x] Do not call `sequelize.sync()` from ops.

### Write validation

- [x] Reject invalid phase transitions before issuing an update.
- [x] Require `lastPhaseCompleted <= lastPhaseStarted` when both values exist.
- [x] Record a phase start before invoking its external work.
- [x] Record only validated phase results as completion.
- [x] Store sanitized failure time, phase, category, and message in `lastError`.
- [x] Keep prior phase failure details in `phaseData` when a later attempt proceeds.
- [x] Set `runCompletedAt` only with `runCompleted=true`.

### Phase 2 tests and verification

- [x] Test the persistence contract with in-memory fakes.
- [x] Test adapter behavior with mocked model methods, without a database connection.
- [x] Test that importing coordinator and phase modules requires no PostgreSQL environment variables.
- [x] Test that the persistence factory is not invoked before configuration succeeds.
- [x] Test that the ops configuration load makes PostgreSQL variables available before the dynamic `db-models` import.
- [x] Confirm the db-manager runner still strips all inherited `PG_*` values while preserving ordinary environment values.
- [x] Run the complete ops suite, type checking, and production build.
- [x] Build `db-models` before ops.
- [x] Record verification results below.

### Phase 2 verification record

- Persistence contracts, adapter tests, and entry-point ordering tests passed without a database connection.
- Adapter failures replace raw database details with bounded persistence messages.
- Configuration tests preserve `PG_*` values for the later dynamic import.
- Existing command-runner tests confirm all inherited `PG_*` values are removed before db-manager children start.

## Implementation phase 3: Run selection and CLI controls

### Pure run selection

- [x] Add a pure decision function using only parsed invocation options, the latest run, and the current time.
- [x] Start a new run when no prior row exists.
- [x] Start a new run when the latest row is complete.
- [x] Start a new run when the latest row stopped during Phases 1–3, regardless of age.
- [x] Start a new run when the latest incomplete row passed Phase 3 and is older than 72 hours.
- [x] Continue the latest incomplete row when it passed Phase 3 and is no more than 72 hours old.
- [x] Measure age from `runStartedAt`, not `createdAt`.
- [x] Never search backward for an older incomplete row during default selection.

### Explicit controls

- [x] Add `--new-run` to force a new run when default behavior would continue.
- [x] Add `--continue-run` to request continuation of the latest eligible incomplete run.
- [x] Allow `--continue-run <positive-run-id>` to select a specific incomplete run.
- [x] Reject unknown, duplicate, or conflicting options before creating or updating a run.
- [x] Refuse continuation of completed rows or rows stopped during Phases 1–3.
- [x] Do not let either option bypass the host lock.
- [x] Document the final syntax in `ops/README.md`.

### Selection tests

- [x] Cover every PRD decision-table row.
- [x] Cover exactly 72 hours and greater than 72 hours.
- [x] Cover future or invalid `runStartedAt` values as failures.
- [x] Cover explicit new-run and continuation behavior.
- [x] Confirm explicit continuation never silently selects a different row.
- [x] Confirm invalid CLI input performs no persistence write and starts no phase.

## Implementation phase 4: Coordinator persistence for Phases 1–3

### Run start and logging

- [x] Select or create the run before starting Phase 1.
- [x] Add `runId` to coordinator start, phase start, completion, failure, continuation, and boundary logs.
- [x] Preserve current Phase 1–3 execution order and validated result contracts.
- [x] Keep the coordinator database-independent through injected repository functions.

### Phase writes

- [x] Record Phase 1 start before the worker-python request.
- [x] Save the validated clear result in `phaseData.phase1` before advancing.
- [x] Record Phase 2 start before the db-manager backup command.
- [x] Save backup path, byte size, SHA-256, and manifest version in typed columns and `phaseData.phase2` before advancing.
- [x] Record Phase 3 start before the db-manager deletion command.
- [x] Save threshold, cutoff, eligible, processed, and deleted counts in `phaseData.phase3` before advancing.
- [x] Update `lastPhaseCompleted` only after the corresponding verified write succeeds.
- [x] Record a sanitized `lastError` when a phase or persistence write fails.
- [x] Leave every Phase 1–3 failure row incomplete.
- [x] Do not mark a run complete at the Phase 4 boundary.

### Continuation boundary

- [x] When the selected run has `lastPhaseCompleted >= 3`, skip Phases 1–3.
- [x] Log that the run is continuing at the unimplemented Phase 4 boundary.
- [x] Do not alter finalized Phase 1–3 outputs during that continuation.
- [x] Leave the run incomplete until a later accepted terminal outcome exists.

### Coordinator tests

- [x] Test successful creation and persisted Phase 1–3 progress.
- [x] Test each phase failure and verify no later phase starts.
- [x] Test persistence failure before and after external work without false completion logs.
- [x] Test replacement of an incomplete Phase 1–3 run with a new run.
- [x] Test continuation at Phase 4 without rerunning destructive phases.
- [x] Confirm database errors do not expose credentials or environment values.
- [x] Preserve all current Phase 1–3 assertions.

## Implementation phase 5: Linux overlap guard

### Launcher

- [x] Add `ops/scripts/runWeeklyFlow02.sh` using POSIX shell plus Ubuntu `flock(1)`.
- [x] Resolve the ops workspace independently of the caller's current directory.
- [x] Create `ops/.runtime/` with permissions suitable for the service user.
- [x] Ignore `ops/.runtime/` in `ops/.gitignore`.
- [x] Open `ops/.runtime/weekly-flow-02.lock` on a dedicated file descriptor.
- [x] Acquire the lock atomically with `flock --nonblock`.
- [x] On success, print the PID and replace the shell with the compiled Node coordinator using `exec` while retaining the locked descriptor.
- [x] On occupied lock, print a timestamped explanation to stderr and exit 75.
- [x] On missing `flock`, directory failure, or another guard error, exit nonzero with a status other than 75.
- [x] Do not inspect file contents, timestamps, or a stored PID to decide ownership.
- [x] Forward every launcher argument to Node unchanged with `"$@"`.

### Invocation contract

- [x] Change `weekly-flow-02:start` to use the launcher.
- [x] Keep `weekly-flow-02:dev` as an unguarded macOS development command.
- [x] Document that the development command must not target a shared server database.
- [x] Document direct compiled entry-point execution as unsupported operationally.
- [x] Reserve exit 75 for occupied-lock rejection.
- [x] Record that the future systemd service must include `SuccessExitStatus=75`.
- [x] Record that guard setup failures remain service failures.
- [x] Do not add or enable the Friday timer yet.

### Guard verification

- [x] Run `sh -n` against the launcher on macOS.
- [x] Test the success, conflict, and guard-error branches with command stubs where practical.
- [x] Test that CLI arguments reach the Node command unchanged and in order.
- [x] Confirm the guarded start command remains absent from local automated tests.
- [x] Defer real lock contention and crash-release tests to Ubuntu.

## Implementation phase 6: Documentation and local closeout

- [x] Update `ops/README.md` with persistence, recovery, CLI, lock, and schema-checkpoint behavior.
- [x] Document that all current Phase 1–3 runs remain incomplete at the Phase 4 boundary.
- [x] Document the difference between an incomplete row and an active process.
- [x] Document manual forced-termination checks for orphaned phase children.
- [x] Document the future systemd `SuccessExitStatus=75` and process-group requirement.
- [x] Document the required ops PostgreSQL variables and application-role rule.
- [x] Document that a continuation stopping at the unimplemented Phase 4 boundary exits 0.
- [x] Warn that a default trigger more than 72 hours later starts a new run and repeats Phases 1–3 while Phase 4 remains unimplemented.
- [x] Add all new compiled test paths to the explicit ops test script.
- [x] Run the complete ops suite and record test files and counts.
- [x] Run ops type checking and a clean production build.
- [x] Build `db-models`, db-manager, and ops in dependency order.
- [x] Confirm production output contains no tests or stale modules.
- [x] Confirm no `.env`, runtime lock, database artifact, backup, log, or generated output is staged.
- [x] Inspect the complete diff for unrelated changes.
- [x] Commit the implementation and todo progress before the server checkpoint.

### Local verification record

- The complete ops suite passed: 83 tests across 16 suites, with no failures, skips, or todos.
- Db-manager regression coverage passed: 232 tests across 14 suites.
- Ops type checking and its clean production build passed.
- Dependency-order builds passed for `db-models`, db-manager, and ops.
- Production output contains runtime modules and source maps only. It contains no compiled tests or stale modules.
- `git diff --check` passed, and the complete diff contains only the planned model, persistence, coordinator, launcher, tests, documentation, and dependency metadata.
- Ignored `.env`, runtime, build, log, and local artifact paths remain untracked and unstaged.
- No local test loaded a package `.env` file, connected to PostgreSQL, or invoked the guarded production command.

## Operator checkpoint: Development-server persistence and lock test

Do not cross this checkpoint until the operator is ready to rebuild and replenish `newsnexus_dev`.

### Before pulling the model change

- [ ] Stop API and worker services that hold development-database connections.
- [ ] Confirm no weekly-flow or phase child process is active.
- [ ] Take the replenish backup with the current server build.
- [ ] Verify that backup before changing the exported model set.

### Schema rebuild

- [ ] Pull the reviewed commit.
- [ ] Build `db-models`, db-manager, and ops in dependency order.
- [ ] Drop, create, and replenish `newsnexus_dev` with the bootstrap owner role.
- [ ] Confirm `WeeklyArticleFlowRuns02` exists with the planned columns and defaults.
- [ ] Confirm the application role has table and sequence access.
- [ ] Add the PostgreSQL settings to the untracked server `ops/.env`.
- [ ] Set `PG_USER` to the application role `newsnexus_app`, not the bootstrap owner.
- [ ] Confirm `SELECT current_user` reports the application role without displaying a password or other credential.
- [ ] Confirm ops can create and update a controlled `WeeklyArticleFlowRuns02` row as the application role.
- [ ] Remove the controlled verification row before the persisted coordinator run.
- [ ] Confirm the tested db-manager child environment still excludes every inherited ops `PG_*` value.
- [ ] Restart the stopped services.
- [ ] Run and verify db-manager backup after the rebuild.
- [ ] Run and verify the API backup path after the rebuild.

### Real lock behavior

- [ ] Confirm Ubuntu provides `flock(1)`.
- [ ] Hold the real lock externally with `flock --nonblock ops/.runtime/weekly-flow-02.lock sleep 120` from the repository root.
- [ ] Run `npm run weekly-flow-02:start` while the external holder is active and verify immediate exit 75 with the expected message.
- [ ] Confirm rejection creates no run row and starts no phase.
- [ ] Release the external holder.
- [ ] Put a temporary fake `node` executable first in `PATH` and have it block without database work.
- [ ] Invoke the real launcher so it acquires the lock and `exec`s the fake Node process.
- [ ] Verify a second launcher invocation is rejected while the fake Node process runs.
- [ ] Terminate the fake Node process and verify a later launcher invocation can acquire the lock.
- [ ] Remove the temporary executable and confirm no test process remains.

### Persisted coordinator run

- [ ] Run the supported guarded weekly-flow command once against `newsnexus_dev`.
- [ ] While the real run is in Phase 2, invoke the supported command from a second terminal.
- [ ] Verify that second command exits 75, proving the coordinator retains the lock after launcher `exec`.
- [ ] Confirm the rejected trigger creates no row and starts no phase.
- [ ] Verify Phase 1–3 logs include one run ID and the existing validated results.
- [ ] Verify the row contains the typed backup fields and Phase 1–3 JSONB results.
- [ ] Verify `lastPhaseStarted=3`, `lastPhaseCompleted=3`, and `runCompleted=false` at the Phase 4 boundary.
- [ ] Trigger the default command again within 72 hours.
- [ ] Verify it continues the same run at Phase 4 without repeating Phases 1–3.
- [ ] Verify no second run row is created by that continuation.
- [ ] Verify the no-work continuation exits 0.
- [ ] Do not kill only the real coordinator while a db-manager child is active.
- [ ] Record that manual forced termination requires confirming the child has ended before another trigger.
- [ ] Record sanitized commands, row values, logs, backup evidence, and results below.

### Development-server verification record

- Pending.

## Final closeout

- [ ] Resolve every failed verification or record a blocker.
- [ ] Update all completed checkboxes and evidence records.
- [ ] Confirm the approved plan and PRD remain aligned with implementation.
- [ ] Confirm no systemd timer was installed or enabled.
- [ ] Confirm production was not changed.
- [ ] Commit the completed todo and any server-tested fixes.
- [ ] Stop before Phase 4 implementation planning.
