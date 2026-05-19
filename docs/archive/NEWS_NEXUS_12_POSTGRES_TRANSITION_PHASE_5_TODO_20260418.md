# News Nexus 12 Postgres Transition Phase 5 TODO

Phase 5 covers production cutover onto Postgres. The goal is to prepare the VM, protect rollback options, restore the production dataset from the final SQLite-based backup, verify core flows, and bring the system back out of maintenance with confidence.

## Phase goal

- Complete the production cutover work described in Phase 5 of `docs/20260418_POSTGRES_TRANSITION_PLAN.md`.
- Finish with production services running against Postgres and the portal restore flow working without user-facing workflow changes.
- Preserve a clear rollback reference and enough validation evidence to trust the cutover.

## Task list

### 1. Production Postgres preparation

- [ ] Install and verify Postgres 16 on the Ubuntu production VM.
- [ ] Configure Postgres to run under systemd with appropriate restart behavior.
- [ ] Restrict access according to the plan’s localhost-focused security model.
- [ ] Confirm the production data directory lives on the intended persistent volume.
- [ ] Create the production application database.

### 2. Production roles and credentials

- [ ] Create the production app role with read/write table access only.
- [ ] Create the production bootstrap role with schema-management privileges needed for replenish and bootstrap flows.
- [ ] Confirm normal runtime services use the app role.
- [ ] Confirm restore or replenish flows use the bootstrap role only where required.
- [ ] Verify the app role cannot perform unexpected DDL.

### 3. Deployment readiness

- [ ] Confirm all earlier phases are complete and validated before cutover.
- [ ] Prepare production env vars for all affected services.
- [ ] Update service configuration so production points to Postgres instead of SQLite.
- [ ] Confirm the deployment artifact contains the Postgres-ready codepaths.
- [ ] Prepare a rollback note that references the pre-cutover code and the final SQLite backup.

### 4. Cutover preparation

- [ ] Tag `main` as `pre-postgres` before the production switchover.
- [ ] Turn the portal maintenance banner on.
- [ ] Verify no critical background workflow should still be writing to SQLite when cutover begins.
- [ ] Take the final SQLite CSV backup intended for cutover restore.
- [ ] Verify the final backup artifact is readable and complete before proceeding.

### 5. Production restore and bootstrap

- [ ] Deploy the Postgres-enabled build to production.
- [ ] Run the production replenish or restore flow from the final backup.
- [ ] Confirm schema bootstrap succeeds in production.
- [ ] Confirm CSV import completes without unresolved table failures.
- [ ] Confirm sequence reset completes after restore.

### 6. Production validation

- [ ] Compare post-restore row counts against the source backup for key tables.
- [ ] Run core smoke tests after restore:
  - [ ] api health and startup
  - [ ] key portal login or authenticated access path
  - [ ] representative article read path
  - [ ] representative write path
  - [ ] representative worker-backed path if safe during cutover
- [ ] Confirm no runtime service is still pointing at SQLite.
- [ ] Confirm logs do not show startup schema-creation regressions or dialect failures.
- [ ] Confirm worker bursts no longer encounter SQLite lock-contention behavior.

### 7. Exit maintenance mode

- [ ] Turn the portal maintenance banner off after validation passes.
- [ ] Confirm the application is fully available again.
- [ ] Record cutover timing and any deviations from the expected window.

### 8. Post-cutover follow-up notes

- [ ] Capture any issues found during production restore that should become follow-up work.
- [ ] Record the final backup location and the production validation evidence.
- [ ] Confirm the rollback reference remains easy to find.

## Validation

### 1. Required checks before marking the phase complete

- [ ] Production Postgres is running and reachable by the deployed services.
- [ ] Production restore from the final SQLite backup completes successfully.
- [ ] Key row counts match the source backup for the validated dataset.
- [ ] Core smoke tests pass after cutover.
- [ ] `pre-postgres` tag exists and points to the intended rollback reference.
- [ ] The portal returns to normal availability after maintenance mode ends.

### 2. Suggested commands and checks during completion

1. Verify the Postgres service status on the production VM.
2. Confirm database roles and permissions behave as expected.
3. Record the final backup artifact path and checksum if available.
4. Run the production replenish or restore command.
5. Compare row counts for key tables before declaring success.
6. Run health checks and representative smoke tests.
7. Review service logs for:
   - schema bootstrap failures
   - connection failures
   - lingering SQLite references
   - sequence or insert-collision errors

## Completion workflow

1. Finish all checklist items for this phase in order.
2. Run the required validation checks before ending maintenance mode.
3. Check off completed items only after the checks pass.
4. Commit any post-cutover documentation updates with a message that references this TODO file and Phase 5 completion progress when applicable.

## Commit note

- Reference this file in the commit body for any cutover-related documentation or follow-up commits.
- Mention that the commit completes all or part of Phase 5 when appropriate.
- Keep post-cutover commits focused and easy to audit.
