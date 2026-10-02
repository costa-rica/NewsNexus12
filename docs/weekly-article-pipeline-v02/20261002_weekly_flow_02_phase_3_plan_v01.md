---
created_at: 2026-10-02T23:02:27Z
updated_at: 2026-10-02T23:02:27Z
created_by: codex (gpt-6) nicksmacbookair
modified_by: codex (gpt-6) nicksmacbookair
---

# Weekly Flow 02 Phase 3 Plan V01

## Purpose

Implement Phase 3 of weekly-flow-02: delete old, unapproved, and non-relevant articles through db-manager after the Phase 2 backup has been verified.

The module will run db-manager's existing default `--delete_articles` behavior. It will wait for a verified completion result before the coordinator reaches the Phase 4 boundary.

## Basis

- Product requirements: [Weekly Combined Flow PRD V05](20261001_weekly_combined_flow_prd_v05.md).
- Overall direction: [Weekly Pipeline Ops Plan V01](20261001_weekly_pipeline_ops_plan_v01.md).
- Previous increment: [Weekly Flow 02 Phase 2 Plan V03](20261002_weekly_flow_02_phase_2_plan_v03.md).
- Current implementation record: [Weekly Flow 02 Phase 2 Todo V01](20261002_weekly_flow_02_phase_2_todo_v01.md).
- Review process: [Plan and Vet](../PLAN_AND_VET.md).

## Scope

This increment will:

1. Add a stable machine-readable result for db-manager's old-article deletion command.
2. Add an independently runnable Phase 3 module under `ops/src/weekly-flow-02/phases/`.
3. Run the fixed compiled db-manager command with `--delete_articles` and no threshold argument.
4. Preserve db-manager's 180-day default and existing article-protection rules.
5. Wait for normal process completion and validate exactly one result record.
6. Log the deletion threshold, cutoff date, eligible count, and deleted count.
7. Stop before Phase 4, which remains unimplemented in this increment.
8. Add automated tests, controlled local harnesses, documentation, and one development-server verification.

This increment will not implement:

- RSS collection or its first request and Article IDs.
- `articleCount` calculation.
- `WeeklyArticleFlowRuns02` or other run persistence.
- Resume behavior, automatic retries, or overlap prevention.
- Semantic scoring, state assignment, or AI Approver V02.
- systemd units, notifications, or production rollout.
- A configurable article-age threshold for Phase 3.
- A new deletion algorithm or a new direct database dependency in ops.

## Current db-manager behavior

The existing `--delete_articles` command has these semantics:

- With no value, it uses `DEFAULT_DELETE_DAYS`, currently 180 days.
- It selects Articles whose `publishedDate` is before the calculated cutoff date.
- It protects every Article referenced by `ArticleApproved` or `ArticleIsRelevant`.
- A null `publishedDate` does not satisfy the old-date condition.
- It counts eligible Articles before deletion.
- It deletes selected IDs in batches of 5,000.
- When more than 5,000 Articles are eligible, it first deletes a 1,000-row sample and logs an estimated remaining duration.
- A zero-row result is currently a successful no-work outcome.
- After the command work, db-manager runs its ordinary database-status query and exits unsuccessfully if later work fails.

Phase 3 will call this existing behavior. It will not pass a days value or combine deletion with another db-manager flag.

## Decisions

1. Use the fixed command `node db-manager/dist/index.js --delete_articles` with no shell.
2. Keep the 180-day threshold owned by db-manager's `DEFAULT_DELETE_DAYS`.
3. Do not add a threshold setting to ops configuration.
4. Add a dedicated overall timeout named `DB_MANAGER_DELETE_ARTICLES_TIMEOUT_SECONDS`.
5. Set the example timeout to 1800 seconds.
6. Treat zero eligible and zero deleted rows as successful completion.
7. Require a verified Phase 2 result before Phase 3 starts.
8. Treat timeout or process failure as an uncertain deletion outcome and stop before Phase 4.
9. Do not attempt rollback. The verified Phase 2 backup remains the recovery artifact.
10. Use one operator checkpoint immediately before real deletion on `nws-nn12dev`.

## Db-manager deletion result

### Typed result

Extend the old-article deletion result so db-manager can report:

```ts
interface DeleteOldArticlesResult {
  daysOldThreshold: number;
  cutoffDate: string;
  eligibleCount: number;
  deletedCount: number;
}
```

Requirements:

- `daysOldThreshold` is the positive safe integer passed to the deletion function.
- `cutoffDate` remains a `YYYY-MM-DD` string.
- `eligibleCount` is the count calculated before batch deletion begins.
- `deletedCount` is the count reported by the completed deletion operation.
- Both counts are non-negative safe integers.
- A result with both counts equal to zero is valid.

### Completion integrity

The deletion loop must not silently report success after it stops before processing its initially selected work.

- Preserve ID-ordered pagination and existing batch sizes.
- Track progress independently from the database's initial eligible count.
- If the loop cannot obtain usable IDs while unprocessed eligible work remains, throw an error.
- Do not emit the success event when the deletion function throws.
- Preserve the existing protection for approved and relevant Articles.

The implementation todo should define focused tests for early empty batches, unusable IDs, and multi-batch completion before changing this logic.

### Stable stdout event

Add a pure formatter that produces one compact JSON line:

```json
{
  "event": "old_articles_deleted",
  "daysOldThreshold": 180,
  "cutoffDate": "2026-04-05",
  "eligibleCount": 24,
  "deletedCount": 24
}
```

Emit this line exactly once after deletion completes. Continue to run the existing database-status query afterward.

If the later status query fails, db-manager must still exit with status 1. Ops must reject the command even if it saw a valid result line.

## Shared db-manager process runner

Phase 2 and Phase 3 use the same child-process requirements. Extract only the proven shared mechanics from `02_createDatabaseBackupCommand.ts` into a focused shared module.

The shared module will own:

- The command specification and launcher types.
- Fixed db-manager entry-point resolution.
- Child-environment isolation.
- Spawn and no-shell execution.
- Continuous stdout and stderr draining.
- UTF-8-safe line decoding.
- The 64 KiB incomplete-line limit.
- The 32 KiB diagnostic tail per stream.
- Overall timeout handling.
- Normal termination followed by a five-second force-termination grace period.
- Exit-code and signal validation.
- Exactly-one-result-candidate enforcement.
- Spawn, timeout, exit, and output-contract failure categories.

Phase-specific modules will own:

- Command arguments.
- Event names and result validation.
- Phase-specific error messages.
- Backup artifact verification for Phase 2.
- Deletion result validation for Phase 3.

Keep compatibility aliases only when they make the existing Phase 2 code easier to read. Do not retain duplicate process runners after the extraction.

## Fixed Phase 3 command

Add these files:

- `ops/src/weekly-flow-02/phases/03_deleteOldArticles.ts`
- `ops/src/weekly-flow-02/phases/03_deleteOldArticlesCommand.ts`

The production command specification will use:

- Executable: `process.execPath`.
- Entry point: the fixed absolute path to `db-manager/dist/index.js`.
- Argument: `--delete_articles`.
- Working directory: `db-manager/`.
- Shell: disabled.

Do not add an environment, CLI, or file-based command override. Tests and temporary harnesses may inject a controlled command only through function arguments.

Do not combine `--create_backup` and `--delete_articles` in one db-manager invocation. The coordinator must preserve distinct Phase 2 and Phase 3 completion boundaries.

## Environment isolation

Reuse the Phase 2 child-environment policy.

Remove inherited ops and database values before starting db-manager:

- `NODE_ENV`
- `NAME_APP`
- `NEXT_PUBLIC_MODE`
- `URL_BASE_NEWS_NEXUS_PYTHON_QUEUER`
- `WORKER_PYTHON_REQUEST_TIMEOUT_SECONDS`
- `DB_MANAGER_BACKUP_TIMEOUT_SECONDS`
- `DB_MANAGER_DELETE_ARTICLES_TIMEOUT_SECONDS`
- `PATH_TO_LOGS`
- `LOG_MAX_SIZE`
- `LOG_MAX_FILES`
- `PATH_DB_BACKUPS`
- Every key beginning with `PG_`

Preserve ordinary operating-system and Node values such as `PATH`, `HOME`, locale, temporary-directory settings, and `NODE_OPTIONS`.

The production child will load db-manager's `.env` from its fixed working directory. Never log the child environment or credentials.

## Phase 3 result validation

Keep parsed JSON typed as `unknown` until validation succeeds.

Require:

- An object with `event` equal to `old_articles_deleted`.
- `daysOldThreshold` equal to the db-manager default of 180.
- A valid `YYYY-MM-DD` cutoff date.
- Non-negative safe-integer eligible and deleted counts.
- `deletedCount` not greater than `eligibleCount`.
- Exactly one valid result candidate.
- A normal child exit with code 0 after both output streams end.

Reject malformed expected events, duplicate events, nonzero exits, signal exits, timeouts, and oversized output lines.

Unrelated db-manager log lines remain allowed. Output larger than the retained diagnostic caps must continue draining without hiding the result or blocking the child.

## Failure and repeat behavior

### Before deletion starts

Phase 3 must not start unless both earlier phases have completed:

1. Phase 1 confirmed duplicate-analysis clearing.
2. Phase 2 created and verified the backup artifact.

Any earlier failure prevents the Phase 3 start log and command invocation.

### During deletion

On spawn failure, timeout, signal exit, nonzero exit, malformed output, or missing result:

1. Log the Phase 3 failure category and concise error.
2. Do not log Phase 3 completion.
3. Do not reach the Phase 4 boundary.
4. Exit the weekly flow unsuccessfully.
5. Leave the Phase 2 backup untouched.

A timeout or unexpected process termination can occur after partial deletion. Report the outcome as unverified. Do not claim rollback or attempt to restore automatically.

### Rerun

Until durable run persistence is implemented, rerunning weekly-flow-02 starts again at Phase 1. It creates a new Phase 2 backup before attempting Phase 3 again.

The deletion command is expected to find only remaining eligible rows on a rerun. No automatic retry occurs inside one coordinator execution.

## Coordinator integration

After Phase 2 completion:

1. Log Phase 3 start.
2. Run the Phase 3 module with the configured timeout.
3. Await the validated db-manager result.
4. Log Phase 3 completion with:
   - `phase=3`
   - `daysOldThreshold`
   - `cutoffDate`
   - `eligibleCount`
   - `deletedCount`
5. Stop at the boundary before unimplemented Phase 4.

Extend the existing coordinator dependencies object with a Phase 3 code-only dependency. Production defaults must retain the fixed command.

## Configuration

Add this required ops setting:

```dotenv
# Overall limit for the db-manager old-article deletion child process, in seconds.
DB_MANAGER_DELETE_ARTICLES_TIMEOUT_SECONDS=1800
```

Parse it as a positive safe integer. Reject missing, zero, negative, fractional, and nonnumeric values.

Do not add settings for the db-manager entry point, deletion threshold, event name, or command arguments.

## Automated tests

### Db-manager tests

- Preserve current CLI coverage proving bare `--delete_articles` selects the 180-day default.
- Test the expanded typed deletion result.
- Test zero eligible rows.
- Test protected approved and relevant Articles.
- Test ordinary and multi-batch deletion.
- Test the initial sample batch for large work.
- Test early termination when expected work remains.
- Test the stable JSON formatter.
- Test that the success line is emitted exactly once after deletion completes.
- Test that a later status failure still returns exit status 1.
- Preserve all unrelated db-manager tests.

### Shared runner regression tests

- Preserve all Phase 2 success and failure coverage after extraction.
- Confirm backup artifact verification remains unchanged.
- Confirm split chunks, UTF-8 boundaries, diagnostic caps, and force termination still work.
- Confirm child environment isolation includes the new timeout key.
- Confirm no command-path configuration is introduced.

### Phase 3 ops tests

Add `ops/tests/weekly-flow-02/03_deleteOldArticles.test.ts` before adding its compiled path to the explicit test script.

Cover:

- The fixed executable, entry point, working directory, and sole argument.
- The code-only fixture seam.
- One valid event among unrelated output.
- A final result line without a trailing newline.
- Split chunks and output beyond diagnostic caps.
- Zero-row success.
- Missing, duplicate, malformed, oversized, and incorrectly typed results.
- Incorrect threshold, invalid date, and impossible count relationships.
- Spawn failure, nonzero exit after a result, signal exit, timeout, and force termination.
- Bounded error text that excludes environment values.

Append this compiled path only after the source test exists:

```text
dist-test/tests/weekly-flow-02/03_deleteOldArticles.test.js
```

### Coordinator tests

- Confirm the call order is Phase 1, Phase 2, Phase 3, then the Phase 4 boundary.
- Confirm Phase 3 receives the configured timeout.
- Confirm Phase 1 and Phase 2 failures prevent Phase 3 start.
- Confirm every Phase 3 failure category prevents completion and later work.
- Confirm zero-row deletion is logged as successful completion.
- Preserve all Phase 1 and Phase 2 assertions.

## Local runtime harnesses

Create temporary fixtures outside the tracked repository. They must not access PostgreSQL, worker-python, or package `.env` files.

Use source and compiled harnesses that inject:

- A successful Phase 1 response.
- A verified Phase 2 fixture artifact.
- A controlled Phase 3 command.
- Every configuration value explicitly.

Exercise:

- Successful deletion metadata.
- Zero-row success.
- Nonzero exit after a result.
- Malformed and duplicate output.
- Oversized output.
- Delayed timeout with force termination.

Confirm success reaches the Phase 4 boundary. Confirm every failure exits unsuccessfully without Phase 3 completion or later work.

Remove every temporary harness, fixture, artifact, and log afterward. Do not run the normal weekly-flow entry point against local package configuration.

## Operator documentation

Update `ops/README.md` with:

- The three-phase call sequence.
- The fixed `--delete_articles` command and 180-day db-manager default.
- Protected approved and relevant Articles.
- The Phase 3 timeout setting.
- Zero-row behavior.
- Logged completion fields.
- Partial and uncertain outcomes after failure or timeout.
- The verified Phase 2 backup as the recovery artifact.
- The fact that a normal weekly-flow run performs real deletion.
- The dependency build order before compiled execution.

## Build and local verification

1. Build db-models, then db-manager, then ops.
2. Run the complete db-manager suite and record its test count.
3. Run the complete ops suite and record every explicit compiled test file and total count.
4. Run ops type checking and a clean production build.
5. Confirm production output contains no tests or stale modules.
6. Confirm generated output remains ignored.
7. Run successful and failing source and compiled harnesses.
8. Inspect the scoped diff for secrets, `.env`, ZIP, CSV, logs, and unrelated changes.
9. Commit completed local implementation before the server checkpoint.

## Development-server verification

Use one operator checkpoint before the real deletion run.

Before approval, present:

- The exact branch and commit.
- Local test, typecheck, build, and harness results.
- The intended development database.
- The configured backup destination.
- The 180-day deletion threshold and current cutoff date.
- A read-only count of Articles currently eligible under the same protection rules.
- The most recent verified Phase 2 backup evidence.

After approval:

1. Confirm the server branch and commit.
2. Record Node and npm versions.
3. Confirm worker-python and db-manager target the intended development database.
4. Confirm both Phase 2 and Phase 3 timeout settings.
5. Confirm backup-directory write access and available disk space.
6. Build db-models, db-manager, and ops in order.
7. Run complete db-manager and ops tests plus ops type checking.
8. Record the eligible count before execution.
9. Run the compiled weekly flow as `limited_user`.
10. Record the exit status and combined peak memory when `/usr/bin/time -v` is available.

Verify:

- Phase 2 creates and verifies a new backup before Phase 3 starts.
- Phase 3 reports the expected 180-day threshold and cutoff date.
- Eligible and deleted counts are non-negative and internally consistent.
- A read-only post-run query confirms no unprotected Articles older than the reported cutoff remain.
- Protected approved and relevant Articles remain present.
- Coordinator and db-manager logs agree on the outcome.
- The process exits successfully at the Phase 4 boundary.

Do not restore the backup during routine verification. Retain it according to the existing backup policy.

## Review cadence

- Claude assesses this plan under `plan-and-vet`.
- After the plan passes, create and assess one implementation todo.
- Once implementation starts, continue through code, tests, and local harnesses without intermediate operator pauses.
- Use one operator checkpoint before the real development-server deletion.
- Report final development evidence without adding another mandatory checkpoint inside this module.

## Completion boundary

Phase 3 is ready when:

- Phase 1 and verified Phase 2 completion are required before deletion starts.
- Db-manager's bare `--delete_articles` command retains its 180-day default and protection rules.
- Db-manager emits exactly one validated deletion result after completed work.
- Ops continuously drains the child process and requires a normal zero exit.
- Zero eligible rows complete successfully.
- Failures and timeouts stop the flow before Phase 4 and preserve the Phase 2 backup.
- Existing Phase 2 behavior remains unchanged after shared-runner extraction.
- Db-manager and ops tests, type checking, builds, and local harnesses pass.
- One approved development-server run verifies deletion counts and reaches the Phase 4 boundary.

Implementation requires a task-style todo after this plan is accepted under [Plan and Vet](../PLAN_AND_VET.md).
