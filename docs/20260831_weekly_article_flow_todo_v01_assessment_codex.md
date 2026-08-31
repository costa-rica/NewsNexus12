---
created_at: 2026-08-31T22:46:18Z
updated_at: 2026-08-31T22:46:18Z
created_by: codex (gpt-5.6-sol) nicksmacbookair
modified_by: codex (gpt-5.6-sol) nicksmacbookair
---

# Weekly Article Flow Todo V01 Assessment

## Scope

This assessment applies the todo threshold in `docs/PLAN_AND_VET.md`.

Reviewed authorities:

- `docs/20260829_weekly_article_processing_cron_prd_v03.md`
- `docs/20260831_weekly_article_flow_plan_v01.md`
- `docs/20260831_weekly_article_flow_todo_v01.md`
- current database, worker, and AI Approver V02 code

The todo is well ordered and covers most implementation, recovery, verification, and operator gates. Two omissions could allow safety-critical behavior to reach Ubuntu or production without proving the required contract.

## 1. Live schema behavior is not tested

Phase 1 calls only for mocked schema-installer tests. Those tests can verify generated calls or SQL, but cannot prove PostgreSQL behavior for:

- the partial unique active-run index
- the nullable foreign key
- `ON DELETE RESTRICT`
- cohort joins after installation

PRD V03 requires tests for foreign keys, deletion restrictions, and cohort queries. Plan V01 also assigns database behavior to a disposable Postgres test database where behavior matters.

Phase 6 mentions a disposable Postgres database for coordinator tests, but its tasks do not explicitly exercise the installed schema constraints. Phase 10 likewise does not name these cases.

An implementation could therefore complete every listed task while testing only mocked installer calls. Invalid index or constraint behavior might first appear during Ubuntu deployment.

Required todo change:

- Add focused disposable-Postgres integration tests after running the installer.
- Prove a second `pending` or `running` run is rejected.
- Prove terminal runs do not block a new active run.
- Prove nullable request rows remain valid.
- Prove referenced weekly runs cannot be deleted.
- Prove the exact cohort join returns the associated articles.

## 2. Dev alert-helper validation is missing

PRD V03 assigns alert-helper validation to Ubuntu dev before production. The helper crosses account and privilege boundaries:

- the coordinator runs as `limited_user`
- the fixed helper or oneshot is root-installed
- vault sync and publication run as `nick`
- sudo access must permit only the fixed service

Phase 11 validates helper prerequisites and alert staging, but it does not install or execute the scoped helper on Ubuntu dev. Phase 13 first installs and validates the helper in production.

This leaves the account transition, sudoers restriction, fixed-path publication, atomic vault write, and both real sync calls unproven until production.

Required todo change:

- Install the alert helper, oneshot service, and scoped sudoers rule on Ubuntu dev without installing the weekly timer.
- Invoke it through the exact `limited_user` path used by the coordinator.
- Verify both sync calls run as `nick` and the fixed alert is atomically published.
- Verify arbitrary service arguments, paths, and commands are rejected.
- Verify helper or sync failure is recorded in journald and JSONL.
- Record cleanup or retention of the dev-only installed helper assets.

## Recommendation

Create Todo V02 with these two additions. No operator decision is required because both changes implement validation already required by PRD V03 and Plan V01.
