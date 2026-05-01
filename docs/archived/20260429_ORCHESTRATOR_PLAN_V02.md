# Weekly Orchestrator — Implementation Plan V02

Supersedes `docs/20260429_ORCHESTRATOR_PLAN.md`.

Source documents:
- `docs/20260429weeklyOrchestratorAutomation.md` — original requirements
- `docs/20260429_ORCHESTRATOR_ASSESSMENT_CLAUDE.md` — feasibility assessment
- `docs/20260429_ORCHESTRATOR_PLAN.md` — V01 plan
- `docs/20260429_ORCHESTRATOR_PLAN_ASSESSMENT_CODEX.md` — Codex's review of V01

V02 incorporates all user clarifications and all accepted Codex revisions.

---

## What changed from V01

| Area | V01 | V02 |
| --- | --- | --- |
| New-table rollout | "worker-node runs `sequelize.sync()`" (incorrect — `ensureSchemaReady` only validates) | Tables come into existence via the planned DB rebuild: backup → drop → rebuild schema from `db-models` → restore data with `db-manager`. No runtime migration. |
| Article targeting | `articleIdCursorMin` (exclusive) only | Bounded **range**: `articleIdMinExclusive` + `articleIdMaxInclusive`. Stable even if rows leak in during the run. |
| State-assigner / AI approver / semantic-scorer payloads | Cursor argument added | Full validated targeting object honored end-to-end; semantic-scorer gains targeting support (currently has none); state-assigner stops dropping `articleIds` etc. |
| Worker-node queue records | Used today for status only | Extended with optional `parameters`, `result`, `logs` fields (worker-python already has these). Child jobs write structured summaries the orchestrator and Excel report consume. |
| Per-step timeout | Mentioned implicitly | First-class field on every step; default `google-rss = 24h`, others smaller. On timeout: cancel child, mark `timed_out`, fail-fast. |
| Locking | File-based locks in `PATH_UTILTIES` + signed tokens | Postgres-backed "is there a running run" check; lightweight middleware on both workers. No lock files. No bypass tokens — orchestrator-issued requests are made by the coordinator code that already runs *in-process* in worker-node, and to worker-python over HTTP with a simple `X-Orchestrator-Run-Id` header that the worker-python middleware accepts as the bypass signal. (Trust boundary is acceptable: workers are not internet-exposed.) |
| Worker-python lock scope | Open question | All worker-python start-job routes block while a run is active. Confirmed by user. |
| Mandatory steps | Mistakenly written as "1, 5, 6" in one row | Steps 1, 2, 3 (delete_articles, google-rss, state-assigner) are mandatory, always pre-checked & disabled in UI, server overrides `enabled=false` for those. |
| Report step | Toggleable | Always-on at backend. UI may show it but cannot disable it. Report is written on every terminal state (completed, early-exit, failed, timed_out, canceled). |
| Excel library | `xlsx` (would have been a new dep) | `exceljs` — already a dependency in `worker-node`/`api`. |
| API surface | New `/orchestrator/*` family | Mounted under existing automations namespace: `/automations/orchestrator/*`. |
| Phase ordering | Coordinator early | Platform primitives first (queue results, targeting, delete job), then DB tables, then coordinator. Reduces rework. |

---

## Locked decisions (consolidated)

| Topic | Decision |
| --- | --- |
| Where the orchestrator lives | `worker-node`, new module + route surface |
| Coordinator runtime | Long-lived async task **outside** the global queue; child jobs go through the queue normally |
| Polling interval | 60s |
| Article targeting | Bounded id range `(articleIdMinExclusive, articleIdMaxInclusive]` |
| Concurrency lock | Postgres: at most one `OrchestratorRun.status = 'running'`. Workers expose middleware that blocks external start-jobs while such a run exists. Worker-python blocks **all** of its start-job routes. |
| Bypass for orchestrator's own child calls | `X-Orchestrator-Run-Id` header (no signing in v1) |
| `db-manager --delete_articles` | Absorbed into worker-node as a queue-backed job |
| Failure policy | Fail-fast |
| Mandatory steps | 1 delete, 2 google-rss, 3 state-assigner — UI-locked, server-enforced |
| Report step | Always on backend; runs on every terminal state |
| Crash policy | On worker restart, in-flight `running` runs reconciled to `failed`. No auto-resume. |
| Re-entrance | 409 if a `running` run already exists |
| Auth | Any logged-in user |
| Schedule | Manual only in v1 |
| DB rollout | Backup → drop → rebuild from `db-models` build → `db-manager` restore from zip. No migration script. |
| Excel library | `exceljs` |
| API path | `/automations/orchestrator/*` |
| Report path | `PATH_UTILTIES/orchestrator/reports/YYYYMMDD-HHMMSS-orchestration-report.xlsx` |

---

## Architecture

```
Portal (automations page → "Orchestrator" section)
  │
  ▼
api  (/automations/orchestrator/start, /runs, /runs/:id, /runs/:id/cancel, /runs/:id/report)
  │
  ▼
worker-node
  ├── routes/orchestrator.ts                 — thin HTTP surface
  ├── modules/orchestrator/
  │     ├── coordinator.ts                   — async loop, OUTSIDE global queue
  │     ├── steps/                           — one runner per step
  │     │     ├── deleteArticles.ts
  │     │     ├── googleRss.ts               — captures range, reads structured result
  │     │     ├── stateAssigner.ts
  │     │     ├── aiApprover.ts              — HTTP into worker-python
  │     │     └── semanticScorer.ts
  │     ├── childJobClient.ts                — start + 60s poll + cancel helpers
  │     ├── activeRunGuard.ts                — Postgres "any run running?" check
  │     ├── repository.ts                    — DB I/O for OrchestratorRun(Step)
  │     ├── reportWriter.ts                  — exceljs, incremental
  │     └── types.ts
  ├── modules/queue/                         — extended with result/parameters/logs
  ├── modules/jobs/deleteArticlesJob.ts
  └── routes/deleteArticles.ts

worker-python
  └── middleware on every /start-job route: 423 if a run is active and X-Orchestrator-Run-Id is absent
```

---

## DB models

### `OrchestratorRun`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | int PK | |
| `triggeredByUserId` | int FK → User | |
| `startedAt` | timestamptz | |
| `endedAt` | timestamptz nullable | |
| `status` | enum | `running` \| `completed` \| `completed_no_new_articles` \| `failed` \| `timed_out` \| `canceled` |
| `config` | JSONB | `{ steps: { delete: {...}, googleRss: {...}, ... } }` (mandatory three forced on at insert) |
| `articleIdMinExclusive` | int nullable | captured before step 2 |
| `articleIdMaxInclusive` | int nullable | captured after step 2 |
| `reportFilePath` | text nullable | absolute |
| `failureReason` | text nullable | |

### `OrchestratorRunStep`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | int PK | |
| `runId` | int FK → OrchestratorRun (cascade) | |
| `stepName` | enum | `delete_articles` \| `google_rss` \| `state_assigner` \| `ai_approver` \| `semantic_scorer` \| `report` |
| `stepOrder` | int | 1..6 |
| `enabled` | bool | |
| `worker` | enum | `node` \| `python` \| `internal` |
| `endpointName` | text nullable | |
| `workerJobId` | text nullable | |
| `startedAt` | timestamptz nullable | |
| `endedAt` | timestamptz nullable | |
| `status` | enum | `pending` \| `skipped` \| `running` \| `completed` \| `completed_no_new_articles` \| `failed` \| `timed_out` \| `canceled` |
| `result` | JSONB nullable | summary, counts, descriptive message |
| `failureReason` | text nullable | |
| `timeoutSeconds` | int nullable | per-step cap |

### Rollout (no migration)

1. Implement models in `db-models` and merge to main.
2. Operator: `db-manager -- --create_backup` to produce the zip.
3. Operator: drop the Postgres database (or recreate the schema cleanly).
4. Operator: `cd db-models && npm run build` so consumers pick up the new model package.
5. Operator: `db-manager -- --zip_file <path>` to restore data into the freshly-built schema. The two orchestrator tables exist (empty) by virtue of the rebuilt schema.
6. Restart `api`, `worker-node`, `worker-python`.

`worker-node` startup keeps using `ensureSchemaReady` and will assert the two new tables exist; if missing, startup fails clearly with table names and the rebuild instructions referenced in the error.

---

## Phased build

### Phase 1 — Worker-node queue result support (~1 day)
- Extend `QueueJobRecord` with optional `parameters`, `result`, `logs` (mirroring worker-python).
- Add a queue execution helper (`updateOwnResult`) jobs can use to write structured summaries during/at end.
- Backwards compatible: existing jobs ignore the new fields.
- Tests for read/write of new fields and for backwards compat.

### Phase 2 — Article range targeting end-to-end (~1.5 days)
- `worker-node/src/modules/articleTargeting.ts`: add `articleIdMinExclusive`, `articleIdMaxInclusive`.
- `state-assigner` route: pass the **full** validated targeting object to the job (stop dropping `articleIds` and friends). Range filter wired into candidate-selection SQL.
- `semantic-scorer` route: introduce request-body targeting (does not exist today). Range filter wired into candidate-selection SQL. Default behavior unchanged when targeting is absent.
- `worker-python` ai-approver: extend request schema with `articleIdMinExclusive`, `articleIdMaxInclusive`. SQL filter added.
- Tests: each endpoint, both default and range-limited paths.

### Phase 3 — Absorb `delete_articles` into worker-node (~1 day)
- New `worker-node/src/modules/jobs/deleteArticlesJob.ts` lifted from `db-manager/src/modules/deleteArticles.ts` (use project logger + `ensureDbReady`).
- New route `POST /delete-articles/start-job` accepts `{ daysOld?, trimCount? }`, returns 202 + `jobId`.
- Job writes a structured result (`{ deletedCount, daysOldThreshold, trimCount }`).
- Tests: route + job + parity check vs. db-manager CLI on a snapshot DB.
- Update `worker-node/AGENTS.md` and API reference doc.

### Phase 4 — Google-RSS structured completion result (~½ day)
- Update `requestGoogleRssJob` so that on every terminal path (queries exhausted, error, rate-limited, abort) it writes to its queue `result`:
  - `endingReason: 'queries_exhausted' | 'rate_limited' | 'error' | 'canceled' | 'aborted'`
  - `endingMessage: string` (human-readable)
  - `articlesAddedCount` (best-effort tally)
- Required because the orchestrator surfaces this in the Excel report on early-exit.

### Phase 5 — DB models + active-run guard (~1 day)
- Add `OrchestratorRun`, `OrchestratorRunStep` to `db-models`.
- Update `_index.ts`, `_associations.ts`.
- Worker-node startup `ensureSchemaReady` adds the two table names to the required list with a clear error message that points at the rebuild path.
- `activeRunGuard.ts` — single SQL: `SELECT id FROM "OrchestratorRun" WHERE status='running' LIMIT 1`. Cached in-memory for ~2s to avoid hammering on bursty automation traffic.

### Phase 6 — Workers' lock middleware (~½ day)
- `worker-node`: middleware on every `/start-job` route except `/orchestrator/*`. If `activeRunGuard` returns a run id and the request lacks `X-Orchestrator-Run-Id` matching that id, respond 423 with `{ orchestratorRunId, message }`.
- `worker-python`: middleware on **every** start-job route (including ai-approver, deduper, location-scorer). Same logic. Implementation: small HTTP call into worker-node at startup of each request: `GET /orchestrator/active-run` (cached ~2s). Or simpler: query the same DB. Pick whichever is more idiomatic for the project; lean toward DB query since worker-python already has the connection.

### Phase 7 — Coordinator + step runners (~2 days)
- `coordinator.ts` runs as a regular async function spawned by the start route. Lifecycle:
  1. Insert `OrchestratorRun` (status `running`) and all six `OrchestratorRunStep` rows (`pending` / `skipped` per config). The mandatory three are always `pending` regardless of input.
  2. For each enabled step in order:
     - Update step → `running`, persist `startedAt`.
     - Apply per-step timeout. Defaults: `delete_articles` 30m, `google_rss` 24h, `state_assigner` 8h, `ai_approver` 8h, `semantic_scorer` 4h.
     - For step 2: capture `articleIdMinExclusive` (max id pre-step) before starting; capture `articleIdMaxInclusive` (max id post-step) after success.
     - Start child job (in-process call into worker-node's job runner with `X-Orchestrator-Run-Id` baked into the parameters; HTTP call into worker-python with the header).
     - Poll `check-status/:jobId` every 60s. Honor abort signal between polls.
     - On timeout: cancel child, mark step `timed_out`, fail-fast.
     - On child failure: mark step `failed`, fail-fast.
     - On success: mirror child's structured result into the step row.
     - After step 2: if `articleIdMaxInclusive == articleIdMinExclusive`, mark run `completed_no_new_articles`, mark steps 3–5 `skipped`, jump to report.
     - Update report after every step transition.
  3. Always run the report writer at the end (success, early-exit, failure, timeout, cancel).
  4. Persist final run status; release implicit lock by transitioning out of `running`.
- `childJobClient.ts`: two flavors — in-process (worker-node) and HTTP (worker-python). Both return a uniform `{ jobId, poll(): Promise<status>, cancel(): Promise<void> }`.
- Cancellation flow: `POST /automations/orchestrator/runs/:id/cancel` flips an in-memory abort signal; coordinator on next poll boundary issues child cancel, waits up to a small grace (e.g. 60s), marks step + run `canceled`, writes report.

### Phase 8 — Report writer (~1 day)
- `reportWriter.ts` using `exceljs`.
- Sheet 1 "Articles": one row per article in `(articleIdMinExclusive, articleIdMaxInclusive]`. Columns: `articleId, title, scrapeStatus, aiAssignedState, aiApproverScore, semanticRating`. Single SQL with joins.
- Sheet 2 "Jobs": one row per `OrchestratorRunStep` (skip the report row itself or include it last). Columns: `jobName, startTime, endTime, duration, status, reasonForEnding`. The Google-RSS row's `reasonForEnding` reads from its `result.endingMessage`.
- Path: `PATH_UTILTIES/orchestrator/reports/YYYYMMDD-HHMMSS-orchestration-report.xlsx` (use run's `startedAt`). Mkdir on demand. Atomic write via `*.tmp` → rename on every incremental update.
- Persist final path on `OrchestratorRun.reportFilePath`.

### Phase 9 — Worker-node HTTP routes (~½ day)
- `POST /orchestrator/start` — body: `{ steps: { aiApprover: {enabled, args?}, semanticScorer: {enabled, args?} } }`. The mandatory three are not toggleable in the body. Returns 202 + `runId`. 409 if a run is already `running`.
- `GET /orchestrator/runs` — paged list.
- `GET /orchestrator/runs/:id` — run + steps.
- `GET /orchestrator/active-run` — used by worker-python lock middleware; returns the running run id or null.
- `POST /orchestrator/runs/:id/cancel` — cooperative.
- `GET /orchestrator/runs/:id/report` — streams the xlsx.
- Tests: route contract + happy-path coordinator with mocked child workers + early-exit path + cancel path + timeout path.

### Phase 10 — api proxy (~½ day)
- `api/src/routes/automations/orchestrator.ts` (or extend an existing automations file): proxies under `/automations/orchestrator/*`.
- Standard logged-in middleware.
- Forward 423 / 409 / timeout statuses unchanged to portal.
- Tests.

### Phase 11 — Portal UI (~1.5 days)
- New `OrchestratorSection.tsx` near the top of the automations page:
  - Six rows. Three (delete, google-rss, state-assigner) shown checked + disabled.
  - ai-approver and semantic-scorer toggleable, default on.
  - report row shown, checked, disabled (informational).
  - "Start Orchestrator" button.
  - Live status panel polling `/automations/orchestrator/runs/:id` every 5s while active. Shows current step, child job id, elapsed, descriptive status.
  - Past-runs table with download-report links.
  - 423 / 409 surfaced as plain-language messages ("Another orchestrator run is in progress; cannot start a manual job until it finishes.")

### Phase 12 — Shakedown
- Run end-to-end on a non-prod dataset.
- Verify report contents, lock behavior, cancellation, timeout, early-exit (force step 2 to add 0 articles).
- Operational runbook in `worker-node/docs/`.

---

## Risks (residual)

| Risk | Mitigation |
| --- | --- |
| Article id ordering breaks if ingestion model changes | Documented as a v1 assumption. Long-term, add an explicit `orchestratorRunId` or batch id on articles created by Google RSS. |
| Worker-python lock middleware queries Postgres on every request | Cache 2s; cost is one tiny indexed query per cache miss. Acceptable. |
| Cancellation grace exceeds expectation | Per-step grace is 60s; documented; orchestrator force-cancels (worker `cancel_job` already SIGTERMs then SIGKILLs child processes). |
| Report file partially written on hard crash | Atomic `*.tmp` → rename; final-state run still has the latest committed snapshot. |
| Mandatory-step server override conflicts with future "skip" need | Document the override; if a real need arises, add an admin-only escape hatch. Out of scope for v1. |
| `ensureSchemaReady` failing after rollout because operator skipped DB rebuild | Failure message names the missing tables and points at this doc. |

---

## Estimated effort

About 9–11 working days for one engineer including tests:

- Phase 1: 1d
- Phase 2: 1.5d
- Phase 3: 1d
- Phase 4: 0.5d
- Phase 5: 1d
- Phase 6: 0.5d
- Phase 7: 2d
- Phase 8: 1d
- Phase 9: 0.5d
- Phase 10: 0.5d
- Phase 11: 1.5d
- Phase 12: 0.5–1d

Phases 1–4 can be parallelized across people if available. Phases 5–8 are the critical path.

---

## Out of scope for v1

- Cron / weekly auto-trigger (defer to a systemd timer).
- Resume-from-step-N after failure.
- Per-step `continueOnFailure`.
- Admin-only gate.
- Notifications (email/webhook) on completion.
- Multi-run concurrency.
- Article batch-id column on `Article` (cleaner long-term replacement for id-range targeting).
