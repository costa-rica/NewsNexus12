---
created_at: 2026-10-02T23:11:05Z
updated_at: 2026-10-02T23:25:34Z
created_by: codex (gpt-6) nicksmacbookair
modified_by: codex (gpt-6) nicksmacbookair
---

# Weekly Flow 02 Phase 3 Todo V01

## Basis and scope

- Accepted plan: [Weekly Flow 02 Phase 3 Plan V02](20261002_weekly_flow_02_phase_3_plan_v02.md).
- V01 assessment: [Assessment by Claude](20261002_weekly_flow_02_phase_3_plan_v01_assessment_claude.md).
- Earlier plan: [Weekly Flow 02 Phase 3 Plan V01](20261002_weekly_flow_02_phase_3_plan_v01.md).
- Product requirements: [Weekly Combined Flow PRD V05](20261001_weekly_combined_flow_prd_v05.md).
- Previous implementation record: [Weekly Flow 02 Phase 2 Todo V01](20261002_weekly_flow_02_phase_2_todo_v01.md).
- Review process: [Plan and Vet](../PLAN_AND_VET.md).

Codex is the todo creator. Claude is the assessor unless the operator changes either role.

This todo adds the Phase 3 old-article deletion contract, reuses the db-manager child-process machinery, integrates the phase after the verified backup, and ends with one approved deletion run on `nws-nn12dev`.

This increment does not add RSS collection, run persistence, retries, overlap prevention, systemd units, notifications, or production rollout.

## Working agreement

1. Complete implementation phases in order.
2. Continue between internal phases after verification and commits pass.
3. Use one operator checkpoint immediately before the real development-server deletion.
4. Keep the fixed production command in code. Do not add a command-path or article-age configuration override.
5. Keep automated tests and local fixtures away from PostgreSQL, worker-python, and package `.env` files unless an existing db-manager test explicitly uses its disposable test database.
6. Do not run the normal weekly-flow entry point locally.
7. Preserve unrelated operator changes.
8. Check off only completed work and record actual evidence.
9. Treat a Phase 3 timeout or process failure as an uncertain, potentially partial deletion.
10. Never restore a backup automatically.
11. Do not push unless the operator requests it.

## Planning files

Preserve these files as the Phase 3 planning history:

- `20261002_weekly_flow_02_phase_3_plan_v01.md`
- `20261002_weekly_flow_02_phase_3_plan_v01_assessment_claude.md`
- `20261002_weekly_flow_02_phase_3_plan_v02.md`
- This todo.

Do not replace or rename earlier versions.

## Implementation phase 0: Baseline and planning commit

- [x] Review all Phase 3 planning files for secrets, generated output, and unresolved blocking concerns.
- [x] Confirm V02 resolves the eligible/deleted count ambiguity identified in the V01 assessment.
- [x] Record current Node and npm versions.
- [x] Record the complete db-manager baseline suite count and result.
- [x] Record the complete ops baseline suite count, explicit compiled test paths, and result.
- [x] Run baseline ops type checking.
- [x] Build db-models, db-manager, and ops in dependency order.
- [x] Confirm the worktree contains only the expected uncommitted planning files.
- [x] Commit the Phase 3 planning history and this todo before changing runtime code.
- [x] Continue directly to implementation phase 1.

### Phase 0 verification record

- Environment: macOS on nicksmacbookair, Node v24.11.0, npm 11.6.1.
- Phase 3 planning files contained no credentials or generated runtime output.
- Claude's V01 count-semantics concern is resolved in V02 with eligible, processed, and deleted counts plus a bounded pass.
- Db-manager baseline: 219 tests passed across 13 suites.
- Ops baseline: 42 tests passed across eight suites using config, Phase 1, and Phase 2 compiled test files.
- Ops type checking passed.
- Db-models, db-manager, and ops builds passed in dependency order.
- The worktree contained only the four expected Phase 3 planning and todo files.

## Implementation phase 1: Db-manager deletion contract

### Shared cutoff calculation

- [x] Add the pure module at `db-manager/src/modules/deleteArticlesCutoff.ts` with no database or environment imports.
- [x] Export the exact function name `calculateOldArticleCutoffDate(daysOldThreshold, now = new Date())` because the compiled server preflight command depends on this filename and export.
- [x] Preserve the current algorithm: subtract days with local `Date.setDate()`, then return the UTC `YYYY-MM-DD` portion.
- [x] Change `deleteOldUnapprovedArticles()` to use this helper.
- [x] Add deterministic unit tests with fixed dates.
- [ ] Use the compiled helper during server preflight so the pre-run SQL does not use a hand-calculated cutoff.

### Typed bounded-pass result

- [x] Extend `DeleteArticlesResult` with `daysOldThreshold`, `eligibleCount`, `processedCount`, and `deletedCount`.
- [x] Keep `cutoffDate` in `YYYY-MM-DD` form.
- [x] Define `eligibleCount` as the count snapshot before batch selection.
- [x] Define `processedCount` as valid Article IDs submitted to `Article.destroy()`.
- [x] Define `deletedCount` as the sum of numeric values returned by `Article.destroy()`.
- [x] Require all three counts to be non-negative safe integers.
- [x] Preserve zero eligible rows as a successful all-zero result.

### Bounded deletion loop

- [x] Preserve the approved and relevant ID protection snapshot.
- [x] Preserve ascending ID pagination.
- [x] Preserve the initial 1,000-row sample when more than 5,000 rows are eligible.
- [x] Preserve the ordinary 5,000-row batch size.
- [x] Limit each query to `Math.min(batchSize, eligibleCount - processedCount)`.
- [x] Stop when `processedCount` reaches `eligibleCount`.
- [x] Treat an empty later batch as successful exhaustion.
- [x] Throw when a nonempty model result contains no valid primary-key IDs.
- [x] Advance `lastId` with the highest valid ID in the returned batch.
- [x] Add valid IDs to `processedCount` before the next selection.
- [x] Add the numeric `Article.destroy()` return to `deletedCount`.
- [x] Throw if a destroy return is not a non-negative safe integer.
- [x] Preserve existing human-readable progress and estimate logs with corrected count meanings.
- [x] Do not process more IDs than the initial `eligibleCount`.

### Stable result event

- [x] Add a pure formatter for one `old_articles_deleted` JSON line.
- [x] Include `daysOldThreshold`, `cutoffDate`, `eligibleCount`, `processedCount`, and `deletedCount`.
- [x] Emit the line exactly once after successful deletion completion.
- [x] Do not emit the line when deletion throws.
- [x] Keep the later database-status query and normal exit behavior.
- [x] Return exit status 1 if the later status query fails, even after emitting the result.

### Db-manager tests

- [x] Preserve CLI coverage proving bare `--delete_articles` uses `DEFAULT_DELETE_DAYS`.
- [x] Update existing deletion expectations for the expanded result.
- [x] Test zero-row success.
- [x] Test approved and relevant protection.
- [x] Test ordinary and multi-batch completion.
- [x] Update the existing batching test near `deleteArticles.test.ts:209` so its two destroy calls return `10` and `5` instead of `null`.
- [x] Make that batching test assert `processedCount=15` and `deletedCount=15` separately.
- [x] Do not weaken the invalid destroy-return check to preserve the old `null` mock behavior.
- [x] Test the initial sample batch.
- [x] Test that the last batch is capped by the remaining initial count.
- [x] Test overshoot prevention when more rows appear after the initial count.
- [x] Test an empty later batch as successful concurrent-disappearance exhaustion.
- [x] Test `processedCount` separately from actual `deletedCount`.
- [x] Test a nonempty batch with no valid IDs.
- [x] Test an invalid destroy return.
- [x] Test `deletedCount <= processedCount <= eligibleCount` for successful results.
- [x] Test the stable formatter independently from Winston.
- [x] Test exactly one stdout result after successful deletion.
- [x] Test no result after deletion failure.
- [x] Test exit status 1 after a later status-query failure.
- [x] Do not add a real production or development database dependency.

### Phase 1 verification and closeout

- [x] Run focused deletion, cutoff, CLI, and index-routing tests.
- [x] Run the complete db-manager suite.
- [x] Build db-models before db-manager.
- [x] Run the db-manager TypeScript build.
- [x] Inspect the scoped diff for unrelated behavior changes.
- [x] Confirm no `.env`, database dump, ZIP, CSV, log, or generated output is staged.
- [x] Record commands, versions, test files, counts, and results below.
- [x] Commit only the db-manager deletion contract, tests, and this todo update.
- [x] Continue directly to implementation phase 2.

### Phase 1 verification record

- Environment: Node `v24.11.0`; npm `11.6.1`.
- Focused verification: 83 tests passed across deletion, cutoff, CLI, and index-routing suites.
- Full verification: 232 tests passed across 14 db-manager suites, including the final eligible-count assertion.
- Build order: `db-models` followed by `db-manager`; both TypeScript builds passed.
- Scope inspection: no unrelated runtime changes or generated artifacts were present.

## Implementation phase 2: Shared db-manager process runner

### Extraction

- [x] Extract the command specification and launcher types from `02_createDatabaseBackupCommand.ts` into one focused shared module.
- [x] Extract fixed db-manager entry resolution and child-environment isolation.
- [x] Extract spawn handling without a shell.
- [x] Extract continuous stdout and stderr draining.
- [x] Preserve `StringDecoder` handling across UTF-8 chunk boundaries.
- [x] Preserve incomplete-line retention and final unterminated-line processing.
- [x] Preserve the 64 KiB line limit.
- [x] Preserve independent 32 KiB stdout and stderr diagnostic tails.
- [x] Preserve result candidates separately from diagnostic retention.
- [x] Preserve normal-exit, signal, nonzero-exit, timeout, SIGTERM, and delayed SIGKILL handling.
- [x] Preserve the five-second production termination grace period.
- [x] Preserve spawn, timeout, exit, and output-contract categories.
- [x] Keep original errors as causes where applicable.
- [x] Keep failure messages concise and free of environment values.
- [x] Do not retain a second copy of the process runner.

### Phase-specific ownership

- [x] Keep Phase 2 command arguments, result parsing, and artifact verification in the Phase 2 module.
- [x] Keep `artifact_verification` as a Phase 2-specific failure.
- [x] Preserve the `CreateDatabaseBackupResult` public shape.
- [x] Preserve Phase 2's fixed `--create_backup` command.
- [x] Preserve every Phase 2 coordinator log field.
- [x] Allow code-only command and launcher injection for tests and temporary harnesses.
- [x] Do not add environment, CLI, or file-based command overrides.

### Environment isolation

- [x] Start with a copy of the parent environment.
- [x] Remove every previously isolated ops key.
- [x] Add `DB_MANAGER_DELETE_ARTICLES_TIMEOUT_SECONDS` to the removed keys.
- [x] Remove every inherited `PG_*` key.
- [x] Preserve ordinary operating-system and Node values.
- [x] Confirm production children load db-manager's `.env` through the fixed working directory.
- [x] Never log child environment values or credentials.

### Regression tests

- [x] Preserve every Phase 2 parser and artifact test.
- [x] Preserve split-chunk and UTF-8-boundary coverage.
- [x] Preserve large-output and no-blocking coverage.
- [x] Preserve missing, duplicate, malformed, oversized, and incorrectly typed result coverage.
- [x] Preserve spawn, exit, signal, timeout, and force-termination coverage.
- [x] Preserve missing-file, directory, empty-file, size, and checksum verification coverage.
- [x] Test the new timeout key is removed from the production child environment.
- [x] Confirm ordinary environment sentinels remain present.
- [x] Confirm errors remain bounded and exclude sentinels.

### Phase 2 verification and closeout

- [x] Run the complete ops suite after extraction.
- [x] Run ops type checking and a clean production build.
- [x] Run the complete db-manager suite and build.
- [x] Confirm all currently expected compiled test files exist and execute.
- [x] Confirm production output contains no tests or stale modules.
- [x] Inspect the diff for unintended Phase 2 behavior changes.
- [x] Record commands, versions, test paths, counts, and results below.
- [x] Commit only the shared-runner extraction, Phase 2 adaptations, tests, and this todo update.
- [x] Continue directly to implementation phase 3.

### Phase 2 verification record

- Ops verification: 42 tests passed across eight suites; type checking and the clean production build passed.
- Compiled test paths: config, Phase 1, and Phase 2 test files were present and executed from `ops/dist-test/tests/`.
- Production inspection: `ops/dist/` contained runtime modules only, including the shared runner; no tests or stale modules were present.
- Db-manager verification: 232 tests passed across 14 suites and the TypeScript build passed.
- Environment regression: the new Phase 3 timeout key and all `PG_*` sentinels were removed while ordinary operating-system and Node values remained.

## Implementation phase 3: Ops Phase 3 module

### Configuration

- [x] Add `dbManagerDeleteArticlesTimeoutSeconds` to `OpsConfig`.
- [x] Parse required `DB_MANAGER_DELETE_ARTICLES_TIMEOUT_SECONDS` as a positive safe integer.
- [x] Test missing, zero, negative, fractional, nonnumeric, and valid values.
- [x] Add `DB_MANAGER_DELETE_ARTICLES_TIMEOUT_SECONDS=1800` to `ops/.env.example`.
- [x] Describe it as the overall child-process timeout.
- [x] Do not add deletion-threshold or command-path configuration.

### Public phase and fixed command

- [x] Add `03_deleteOldArticles.ts` as the public Phase 3 function.
- [x] Add `03_deleteOldArticlesCommand.ts` for command construction and result validation.
- [x] Use `process.execPath`.
- [x] Resolve the fixed compiled entry at `db-manager/dist/index.js`.
- [x] Set the working directory to `db-manager/`.
- [x] Pass only `--delete_articles`.
- [x] Do not invoke a shell.
- [x] Use the shared isolated child environment.
- [x] Keep command substitution available only through code arguments.

### Result validation

- [x] Keep parsed JSON as `unknown` until validation succeeds.
- [x] Require event `old_articles_deleted`.
- [x] Require `daysOldThreshold=180`.
- [x] Require a real calendar date formatted as `YYYY-MM-DD`.
- [x] Require non-negative safe-integer eligible, processed, and deleted counts.
- [x] Require `deletedCount <= processedCount <= eligibleCount`.
- [x] Accept an all-zero result.
- [x] Require exactly one valid candidate and normal exit status 0.
- [x] Reject malformed expected events, duplicate candidates, signals, nonzero exits, timeouts, and oversized lines.
- [x] Allow unrelated log lines.

### Phase 3 tests

- [x] Add `ops/tests/weekly-flow-02/03_deleteOldArticles.test.ts` before changing the explicit test script.
- [x] Test the fixed executable, entry point, working directory, and only argument.
- [x] Test the code-only fixture seam.
- [x] Parse one valid result among unrelated lines.
- [x] Parse a final result without a trailing newline.
- [x] Parse split chunks and UTF-8 boundaries.
- [x] Preserve a result around output larger than both diagnostic caps.
- [x] Confirm output beyond the caps cannot block child completion.
- [x] Accept zero-row success.
- [x] Accept concurrent-disappearance counts below the initial eligible count.
- [x] Reject missing, duplicate, malformed, oversized, and incorrectly typed results.
- [x] Reject the wrong threshold and invalid calendar dates.
- [x] Reject every invalid count relationship.
- [x] Cover spawn failure, nonzero exit after a result, signal exit, timeout, and forced termination.
- [x] Confirm failure text is bounded and excludes environment values.
- [x] Append the compiled Phase 3 test path to `ops/package.json` only after the source file exists.

### Phase 3 verification and closeout

- [x] Confirm config, Phase 1, Phase 2, and Phase 3 compiled test files exist.
- [x] Run the complete ops test command and record every executed file and total count.
- [x] Run ops type checking and a clean production build.
- [x] Run the complete db-manager suite and build.
- [x] Confirm generated output remains ignored and production output has no tests.
- [x] Confirm no command-path or threshold override was added.
- [x] Confirm no `.env`, artifact, fixture, temporary directory, or log is staged.
- [x] Record commands, versions, test counts, and results below.
- [x] Commit only Phase 3 configuration, command module, tests, documentation updates, and this todo update.
- [x] Continue directly to implementation phase 4.

### Phase 3 verification record

- Ops verification: 55 tests passed across 11 suites using the explicit config, Phase 1, Phase 2, and Phase 3 compiled test paths.
- Ops type checking and the clean production build passed.
- Db-manager verification: 232 tests passed across 14 suites and the TypeScript build passed.
- Production inspection: Phase 3 runtime files were present in `ops/dist/`; tests remained only under ignored `ops/dist-test/`.
- Configuration inspection: the command and 180-day threshold remained fixed in code; only the required overall timeout was configurable.
- Scope inspection: no `.env`, artifact, fixture, temporary directory, generated output, or log was staged.

## Implementation phase 4: Coordinator, documentation, and harnesses

### Coordinator integration

- [ ] Extend the dependencies object with a Phase 3 code-only dependency and production default.
- [ ] Preserve the default global fetch request for Phase 1.
- [ ] Preserve the fixed production backup command for Phase 2.
- [ ] Require validated Phase 1 and Phase 2 completion before logging Phase 3 start.
- [ ] Log Phase 3 start with `phase=3`.
- [ ] Await the validated deletion result.
- [ ] Log Phase 3 completion with threshold, cutoff, eligible, processed, and deleted counts.
- [ ] Replace the Phase 3 boundary with the boundary before unimplemented Phase 4.
- [ ] Categorize and log every Phase 3 failure without exposing child output or environment values.
- [ ] Let every Phase 3 error reach the top-level handler and produce nonzero exit.
- [ ] Confirm Phase 3 failure never logs completion or the Phase 4 boundary.
- [ ] Preserve rerun behavior beginning again at Phase 1.

### Coordinator tests

- [ ] Confirm order: Phase 1, Phase 2, Phase 3, Phase 4 boundary.
- [ ] Confirm Phase 3 receives its configured timeout.
- [ ] Confirm Phase 1 failure prevents Phase 2 and Phase 3.
- [ ] Confirm Phase 2 failure prevents Phase 3.
- [ ] Test each Phase 3 failure category and confirm no later work.
- [ ] Confirm all-zero deletion completes normally.
- [ ] Confirm completion metadata uses distinct count fields.
- [ ] Preserve every existing Phase 1 and Phase 2 assertion.

### Operator documentation

- [ ] Update `ops/README.md` for the three-phase sequence and Phase 4 boundary.
- [ ] Document the bare `--delete_articles` command and 180-day default.
- [ ] Document approved and relevant protection.
- [ ] Document the Phase 3 timeout.
- [ ] Explain eligible, processed, and deleted counts.
- [ ] Document all-zero completion.
- [ ] Document partial and uncertain failure outcomes.
- [ ] Document the verified Phase 2 backup as the recovery artifact.
- [ ] Document that the protection snapshot can become stale during deletion.
- [ ] Document that the sequential backup can miss an Article inserted before deletion.
- [ ] Document that every rerun creates another full backup.
- [ ] Warn that the normal weekly-flow entry point performs real deletion.
- [ ] Preserve the dependency build order.

### Local source and compiled harnesses

- [ ] Create all harnesses, commands, artifacts, and logs outside the tracked tree.
- [ ] Construct configuration explicitly without loading package `.env` files.
- [ ] Inject a successful Phase 1 response.
- [ ] Inject a verified Phase 2 fixture artifact and result.
- [ ] Inject a controlled Phase 3 command.
- [ ] Exercise ordinary success, zero-row success, and concurrent-disappearance counts.
- [ ] Exercise nonzero exit after a result, malformed output, duplicate output, oversized output, and delayed forced termination.
- [ ] Confirm source and compiled success reach the Phase 4 boundary.
- [ ] Confirm every failure exits unsuccessfully without Phase 3 completion or later work.
- [ ] Confirm large output does not block or hide the result.
- [ ] Do not replace or edit compiled db-manager files for fixture testing.
- [ ] Do not run the normal weekly-flow entry points.
- [ ] Remove every temporary harness, fixture, artifact, and log.

### Phase 4 verification and closeout

- [ ] Run the complete db-manager suite and build.
- [ ] Run the complete ops suite, typecheck, and clean build.
- [ ] Confirm all expected compiled test paths and record the total count.
- [ ] Confirm generated output remains ignored and no temporary files remain.
- [ ] Inspect the scoped diff for secrets, artifacts, logs, and unrelated changes.
- [ ] Record commands, versions, test counts, harness modes, and results below.
- [ ] Commit only coordinator integration, documentation, harness-driven fixes, tests, and this todo update.
- [ ] Continue directly to Phase 5 read-only development-server preflight.

### Phase 4 verification record

- Pending.

## Implementation phase 5: Development-server read-only preflight

### Server code and environment preflight

- [ ] Confirm the server is on the approved branch and commit.
- [ ] Record server Node and npm versions.
- [ ] Confirm execution as `limited_user` from the intended repository.
- [ ] Confirm worker-python and db-manager target the intended development database.
- [ ] Confirm the configured backup destination and write access without displaying credentials.
- [ ] Record available disk space.
- [ ] Confirm `DB_MANAGER_BACKUP_TIMEOUT_SECONDS=1800`.
- [ ] Confirm `DB_MANAGER_DELETE_ARTICLES_TIMEOUT_SECONDS=1800`.
- [ ] Build db-models, db-manager, and ops in order.
- [ ] Run the complete db-manager suite and record its count.
- [ ] Run the complete ops suite and record its explicit test files and count.
- [ ] Run ops type checking.
- [ ] Confirm production builds contain no tests or stale modules.

### Cutoff and read-only pre-run counts

- [ ] Invoke the compiled pure cutoff helper on `nws-nn12dev`; do not calculate the date by hand.
- [ ] Use the helper's 180-day cutoff literal in both pre-run SQL queries.
- [ ] Record the cutoff beside the pre-run eligible and protected-old counts.
- [ ] Run the queries as `limited_user` against the same configured database and schema as db-manager.
- [ ] Wrap the psql verification in `BEGIN TRANSACTION READ ONLY` and `COMMIT`.
- [ ] Do not display or copy database credentials.
- [ ] Run the preflight count close to the weekly flow invocation.
- [ ] If execution crosses a cutoff boundary, preserve the original pre-run cutoff and compare post-run results using the reported Phase 3 cutoff.
- [ ] Treat a pre-run count using a different cutoff as contextual evidence, not a direct before/after comparison.

Use the compiled helper from the repository root:

```bash
phase3_cutoff=$(node -e 'const { calculateOldArticleCutoffDate } = require("./db-manager/dist/modules/deleteArticlesCutoff.js"); process.stdout.write(calculateOldArticleCutoffDate(180));')
printf '%s\n' "$phase3_cutoff"
```

Eligible count SQL:

```sql
SELECT COUNT(*) AS eligible_count
FROM "Articles" AS a
WHERE a."publishedDate" < DATE 'YYYY-MM-DD'
  AND NOT EXISTS (
    SELECT 1 FROM "ArticleApproveds" AS aa
    WHERE aa."articleId" = a.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM "ArticleIsRelevants" AS air
    WHERE air."articleId" = a.id
  );
```

Protected-old count SQL:

```sql
SELECT COUNT(*) AS protected_old_count
FROM "Articles" AS a
WHERE a."publishedDate" < DATE 'YYYY-MM-DD'
  AND (
    EXISTS (
      SELECT 1 FROM "ArticleApproveds" AS aa
      WHERE aa."articleId" = a.id
    )
    OR EXISTS (
      SELECT 1 FROM "ArticleIsRelevants" AS air
      WHERE air."articleId" = a.id
    )
  );
```

Use the configured schema or schema-qualify all three table names when it is not already on the psql search path.

### Phase 5 verification and closeout

- [ ] Record all read-only preflight evidence separately from local implementation evidence.
- [ ] Record the exact branch, commit, versions, database description, configured timeouts, disk space, test counts, cutoff, and both pre-run counts.
- [ ] Confirm no weekly-flow command or mutating database command ran.
- [ ] Record unavailable evidence as limitations.
- [ ] Confirm the documentation diff contains no credentials, `.env`, generated output, or artifacts.
- [ ] Commit only the preflight verification record and this todo update.
- [ ] Stop at the operator checkpoint before real deletion.

### Phase 5 verification record

- Pending.

## Operator checkpoint: Development deletion readiness

- [ ] Present the exact branch and commit intended for `nws-nn12dev`.
- [ ] Present local db-manager and ops test counts, builds, typecheck, and harness evidence.
- [ ] Confirm the intended development database and backup directory.
- [ ] Confirm the 180-day threshold and the preflight cutoff procedure.
- [ ] Present the pre-run eligible and protected-old counts with the cutoff used.
- [ ] Present the latest verified Phase 2 backup evidence.
- [ ] Present available disk space with capacity for the planned backup and one investigation rerun.
- [ ] Explain that the run performs real deletion and can partially delete before a timeout or failure.
- [ ] Ask the operator to approve the real development-server run.
- [ ] Do not run the weekly flow or any mutating development-database command before approval; the documented read-only preflight counts are allowed.

## Implementation phase 6: Real development-server deletion

### Real development run

- [ ] Record backup-directory contents before execution.
- [ ] Run the compiled weekly flow as `limited_user`.
- [ ] Use `/usr/bin/time -v` when available and record combined peak resident memory.
- [ ] Record process exit status.
- [ ] Confirm Phase 1 completes before Phase 2.
- [ ] Confirm Phase 2 creates and verifies a new backup before Phase 3.
- [ ] Confirm Phase 3 reports threshold 180 and a valid cutoff.
- [ ] Confirm `deletedCount <= processedCount <= eligibleCount`.
- [ ] Confirm completion logs all five result fields.
- [ ] Confirm coordinator and db-manager logs agree.
- [ ] Confirm successful exit at the Phase 4 boundary.
- [ ] Do not restore the backup during routine verification.

### Read-only post-run verification

- [ ] Run both count queries with the cutoff reported by Phase 3.
- [ ] Record the reported cutoff with both post-run counts.
- [ ] Confirm the eligible post-count is zero when no concurrent change occurred.
- [ ] Reconcile a nonzero eligible post-count with timestamps and bounded-pass counts before deciding whether to rerun.
- [ ] Confirm the protected-old count remains stable unless a concurrent change explains the difference.
- [ ] If pre-run and reported cutoffs differ, do not compare their counts as if they used the same cohort.
- [ ] Preserve the Phase 2 backup and record its path, size, SHA-256, owner, and permissions.

### Phase 6 verification and closeout

- [ ] Record all operator-supplied evidence separately from commands observed by the implementing agent.
- [ ] Record the branch, commit, versions, database description, cutoffs, counts, backup metadata, exit status, memory result, and limitations.
- [ ] Record unavailable evidence as limitations rather than successes.
- [ ] Run final local verification only if server testing causes code changes.
- [ ] Confirm the final diff contains no secrets, `.env`, ZIP, CSV, log, generated output, or temporary file.
- [ ] Commit only server-verification documentation or fixes and this todo update.
- [ ] Do not push unless the operator requests it.

### Phase 6 verification record

- Pending.

## Shared phase closeout

At the end of every implementation phase:

1. Run applicable focused and complete tests, type checks, builds, and harness checks.
2. Fix failures without weakening behavior or deleting meaningful tests.
3. Confirm every expected compiled test path exists before relying on `node --test` output.
4. Inspect `git status`, the scoped diff, and `git diff --check`.
5. Keep credentials, `.env`, generated output, database artifacts, fixtures, and unrelated changes out of commits.
6. Record actual commands, versions, test paths, counts, and results.
7. Update completed checkboxes, the phase verification record, `updated_at`, and `modified_by`.
8. Commit only the completed phase using the repository commit-message guidance.
9. Continue to the next internal phase without an operator pause until the development deletion checkpoint.
10. Do not push unless the operator requests it.
