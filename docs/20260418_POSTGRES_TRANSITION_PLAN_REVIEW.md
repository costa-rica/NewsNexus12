# Postgres Transition Plan Review

This review captures the three plan improvements that look most important before implementation starts. The goal is to keep the feedback narrow and high-signal: only issues that could cause major delivery friction, unstable testing, or avoidable runtime risk are included here.

1. Test database isolation needs to be explicit

- The current plan uses a shared `newsnexus_test` database that gets dropped and recreated at suite start.
- That is risky because `db-manager` currently runs `jest` without `--runInBand`, and CI/package-level parallelism can also cause one suite to wipe the database while another suite is still using it.
- This can create flaky failures, false negatives, and confusing test behavior during the transition.
- The plan should require isolated test targets from the start:
  - one database or schema per package, or
  - one unique database or schema per CI job or test worker.

2. The raw SQL audit should be promoted to a first-class task

- The plan mentions reviewing some raw SQL and doing a grep pass, but the repo currently has several active query surfaces beyond the single example called out in the plan.
- Important areas include:
  - `api/src/modules/queriesSql.ts`
  - `api/src/modules/analysis/state-assigner-sql.ts`
  - `api/src/modules/analysis/llm04.ts`
  - `api/src/routes/analysis/llm02.ts`
  - `worker-python/src/standalone/setup_ai_approver_prompt.py`
- At least one of these already contains SQLite-specific date syntax, which is a good sign that the audit scope is larger than the plan currently implies.
- The plan should require a repo-wide inventory of:
  - `sequelize.query(...)`
  - `sqlite3`
  - `sqlite_master`
  - `PRAGMA`
  - `datetime('now')`
  - `?` placeholders
- Phase 1 should not be considered complete until that inventory is built and each item is either converted or explicitly ruled safe.

3. Runtime schema creation should be removed from normal app and job startup

- The plan currently says to verify some startup behavior under Postgres, but the stronger improvement is to remove runtime DDL from normal service startup altogether.
- Right now `sequelize.sync()` or related schema setup runs during normal startup paths in:
  - `api/src/app.ts`
  - `worker-node/src/modules/db/ensureDbReady.ts`
  - `worker-node/src/modules/jobs/requestGoogleRssJob.ts`
  - `worker-node/src/modules/jobs/semanticScorerJob.ts`
- This was more tolerable with SQLite, but under Postgres it increases the chance that long-lived services and background jobs attempt schema creation during normal runtime.
- That becomes especially risky once replenish is defined as dropping and recreating the schema.
- The plan should require:
  - only the explicit bootstrap or replenish path may run `sequelize.sync()` or schema-changing DDL
  - normal api and worker startup should authenticate, confirm schema availability, and fail fast if the schema is missing instead of trying to create it
  - runtime roles should not need broader schema-management privileges than necessary
