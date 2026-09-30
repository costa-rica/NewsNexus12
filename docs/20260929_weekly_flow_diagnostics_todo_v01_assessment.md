---
created_at: 2026-09-29T22:45:09Z
created_by: hermes (gpt-5.6-sol) independent assessor
assesses: docs/20260929_weekly_flow_diagnostics_todo_v01.md
source_plan: docs/20260929_weekly_flow_diagnostics_plan_v04.md
---

# Assessment of weekly flow semantic diagnostics TODO v01

## Verdict

**CONCERNS REQUIRE V02**

## Material concern

### 1. Phase 1 requires configuration propagation that its file scope and test order cannot implement safely

**TODO evidence:** Phase 1 says to thread the resolved flag from `startServer()` into app/semantic-route construction without reparsing the environment (line 82), then run semantic-route tests and commit only the Phase 1 files (lines 89–91). Its file list, however, includes only `startup/config.ts`, `startupConfig.test.ts`, `server.ts`, and `app.ts` (lines 61–67). The route-to-job RED test and route/job changes are deferred to Phase 3 (lines 162–175).

**Repository evidence:** `worker-node/src/app.ts:5,41` imports and mounts the already-created default `semanticScorerRouter`; it does not construct the route from app configuration. `worker-node/src/routes/semanticScorer.ts:13-17,43-48` defines the route dependency contract and default factory, while `worker-node/src/routes/semanticScorer.ts:68` calls `createSemanticScorerJobHandler` with only the scorer directory and targeting. Therefore the validated boolean cannot actually cross the app-to-route/job boundary without changing the route (and its typed test/handler contract), files expressly postponed until Phase 3. Completing line 82 in Phase 1 would either exceed the stated file/commit scope or introduce untested route production changes, contrary to the TODO's strict RED-before-production-code boundary at line 28.

**Concrete correction:** Make the phase boundaries internally consistent in v02. Prefer either:

1. move the route-to-job RED test and the corresponding `semanticScorer.ts`, route-test, and typed handler plumbing into Phase 1, add those files to the Phase 1 file/commit scope, and require that RED test before the plumbing changes; or
2. limit Phase 1 to parsing/validation plus typed `startServer()` → `createApp()` input, explicitly defer app → route → job propagation to Phase 3, and remove the Phase 1 claim that the flag has reached semantic-route construction.

In either version, preserve a disabled/default-compatible `createApp` path for the existing default app export and smoke tests, and do not read `process.env` again for this flag.

## Other review results

No additional material concern was found in the bounded collector requirements, lifecycle boundaries, behavior-preservation gates, deployment restrictions, manual production observation, exclusion of the pre-existing lockfile/drill units, or prohibition on weekly unit/timer changes and db-manager restart.
