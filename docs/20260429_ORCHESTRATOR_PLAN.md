# Weekly Orchestrator — Implementation Plan

Source documents:
- `docs/20260429weeklyOrchestratorAutomation.md` — original requirements
- `docs/20260429_ORCHESTRATOR_ASSESSMENT_CLAUDE.md` — feasibility assessment
- This file — implementation plan, incorporating user clarifications dated 2026-04-29

---

## Locked decisions

| Topic | Decision |
| --- | --- |
| Where the orchestrator lives | Inside `worker-node`, as a new module + route surface |
| Where it runs | Outside the global queue; coordinator is a long-lived async task. Children still go through the queue normally. |
| Concurrency lock | While an orchestrator run is `running`, both `worker-node` and `worker-python` reject new external start-job requests (orchestrator-issued requests carry a token bypass) |
| `db-manager --delete_articles` | Absorbed into `worker-node` as `POST /delete-articles/start-job` |
| Step coordination | Polling `/queue-info/check-status/:jobId` every **60s** |
| Article cursor | Capture `maxArticleId` before & after step 2, pass `maxArticleIdBefore` (exclusive) to steps 3/4/5 |
| Persistence | Two new Postgres tables: `OrchestratorRun`, `OrchestratorRunStep` |
| Failure policy | Fail-fast. No `continueOnFailure` flag in v1. |
| Crash policy | If `worker-node` restarts, in-flight orchestrator run is marked `failed`. No auto-resume. Excel report contains whatever was written before crash. |
| Re-entrance | At most one `running` orchestrator run; reject second start with 409. |
| Steps 1, 5, 6 (delete / google-rss / state-assigner) | **Mandatory.** Show as disabled (always-checked) checkboxes in the portal. The other steps are toggleable. |
| Early exit | If step 2 (google-rss) completes but produces 0 new articles, the run ends successfully. The Excel report's job-status sheet describes why google-rss ended (e.g. "completed, 0 articles added", "google rate-limited", "spreadsheet exhausted", "error: …"). |
| Excel report path | `PATH_UTILTIES/orchestrator/reports/YYYYMMDD-HHMMSS-orchestration-report.xlsx` |
| Excel write cadence | Job-status sheet written incrementally after each step; article sheet written at end (or on early exit/failure). |
| Auth | Any logged-in portal user can trigger. |
| Schedule | Manual trigger only in v1. Cron deferred. |

User clarification I read but want to confirm separately: "block worker-python from triggering a job" — I'm implementing as "while orchestrator is running, both workers reject external start-job requests; orchestrator-issued calls bypass the lock via a shared token." If only ai-approver needed to be locked, the design narrows but the structure is the same.

---

## Architecture overview

```
Portal (automations page → "Orchestrator" section)
  │
  ▼
api  (POST /orchestrator/start, GET /orchestrator/runs, GET /orchestrator/runs/:id, POST /orchestrator/cancel/:id, GET /orchestrator/runs/:id/report)
  │
  ▼
worker-node
  ├── routes/orchestrator.ts                 — thin HTTP surface
  ├── modules/orchestrator/
  │     ├── coordinator.ts                   — main async loop (runs OUTSIDE the queue)
  │     ├── steps/                           — one file per step
  │     │     ├── deleteArticles.ts
  │     │     ├── googleRss.ts
  │     │     ├── stateAssigner.ts
  │     │     ├── aiApprover.ts              — calls worker-python over HTTP
  │     │     └── semanticScorer.ts
  │     ├── childJobClient.ts                — start + poll helpers (in-process for worker-node, HTTP for worker-python)
  │     ├── lock.ts                          — orchestrator lock (process-wide, persisted)
  │     ├── repository.ts                    — DB reads/writes for OrchestratorRun, OrchestratorRunStep
  │     ├── reportWriter.ts                  — incremental xlsx writer
  │     └── types.ts
  ├── modules/jobs/deleteArticlesJob.ts      — absorbed from db-manager
  └── routes/deleteArticles.ts

worker-python
  └── exposes a "busy because orchestrator" rejection on /ai-approver/start-job & friends
     (honors a header-based bypass token issued by orchestrator)
```

Coordinator is **not** a queued job. It's a long-lived async task started by the start route handler. Each child step the coordinator runs gets enqueued into the appropriate worker's queue, gets a `jobId`, and is polled to completion.

---

## Database changes (`db-models`)

### `OrchestratorRun`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | int PK | |
| `triggeredByUserId` | int FK → User | nullable for safety, but in practice always set |
| `startedAt` | timestamptz | |
| `endedAt` | timestamptz nullable | |
| `status` | enum | `running` \| `completed` \| `completed_no_new_articles` \| `failed` \| `canceled` |
| `config` | JSONB | `{ steps: { delete: {enabled, args}, googleRss: {...}, ... } }` |
| `articleIdCursorBefore` | int nullable | captured before step 2 |
| `articleIdCursorAfter` | int nullable | captured after step 2 |
| `reportFilePath` | text nullable | absolute path under `PATH_UTILTIES` |
| `failureReason` | text nullable | terminal-state explanation |

### `OrchestratorRunStep`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | int PK | |
| `runId` | int FK → OrchestratorRun, ON DELETE CASCADE | |
| `stepName` | enum | `delete_articles` \| `google_rss` \| `state_assigner` \| `ai_approver` \| `semantic_scorer` \| `report` |
| `stepOrder` | int | 1..6 |
| `enabled` | bool | |
| `worker` | enum | `node` \| `python` \| `internal` |
| `endpointName` | text nullable | e.g. `/state-assigner/start-job` |
| `workerJobId` | text nullable | id returned by the child queue |
| `startedAt` | timestamptz nullable | |
| `endedAt` | timestamptz nullable | |
| `status` | enum | `pending` \| `skipped` \| `running` \| `completed` \| `completed_no_new_articles` \| `failed` \| `canceled` \| `timed_out` |
| `result` | JSONB nullable | counts, descriptive messages |
| `failureReason` | text nullable | |

Sequelize model files added to `db-models/src/models/`, registered in `_index.ts` and `_associations.ts`. `worker-node` runs `sequelize.sync()` on startup as it already does.

---

## Step-by-step build phases

### Phase 0 — Confirm clarifications, branch setup
- [ ] Confirm worker-python lock scope (all routes vs. ai-approver only).
- [ ] Branch `dev_03_orchestrator_<short_desc>` off current dev branch.

### Phase 1 — Absorb `db-manager` deletion into `worker-node` (~1 day)
- [ ] Copy/refactor `db-manager/src/modules/deleteArticles.ts` into `worker-node/src/modules/jobs/deleteArticlesJob.ts`. Use the project logger; reuse `ensureDbReady`.
- [ ] Add `worker-node/src/routes/deleteArticles.ts`: `POST /delete-articles/start-job`, accepts `{ daysOld?: number, trimCount?: number }`. Returns 202 with `jobId`.
- [ ] Mount route in `app.ts`.
- [ ] Smoke + unit test mirroring `semanticScorer` tests.
- [ ] Verify on a snapshot DB that behavior matches the existing CLI (counts identical).
- [ ] Document in `worker-node/AGENTS.md` and `worker-node/docs/.../API_REFERENCE.md`.
- [ ] db-manager CLI keeps `--delete_articles`; add a note that worker-node also exposes it.

### Phase 2 — DB models (~½ day)
- [ ] Add `OrchestratorRun` and `OrchestratorRunStep` Sequelize models in `db-models/src/models/`.
- [ ] Register in `_index.ts`, declare associations in `_associations.ts`.
- [ ] Build & publish locally (file: dependency).

### Phase 3 — Cursor support on downstream endpoints (~1 day)
- [ ] Extend `worker-node` `state-assigner`, `semantic-scorer` request bodies with optional `articleIdCursorMin` (exclusive). When present, candidate-selection SQL filters `WHERE article.id > :cursor`.
- [ ] Extend `worker-python` `ai-approver` start-job body with the same `articleIdCursorMin`.
- [ ] Tests for both new code paths (with cursor, without cursor — current behavior unchanged).
- [ ] Document the new arg in each worker's API reference.

### Phase 4 — Orchestrator lock + worker-python lock honoring (~½ day)
- [ ] In `worker-node/src/modules/orchestrator/lock.ts`: a process-wide flag persisted to `PATH_UTILTIES/orchestrator/lock.json` so it survives view from other code paths. Held by orchestrator coordinator for the run's duration.
- [ ] Middleware in `worker-node` that rejects external start-job requests (all `/start-job` routes except `/orchestrator/*` and `/delete-articles/...` when called *with* the orchestrator bypass header) when the lock is held. Returns 423 Locked + run id.
- [ ] Worker-python: equivalent middleware, queries `worker-node` for lock state on each external start-job (cached briefly), or accepts a shared signed token. Implementation note: simpler to have worker-node `POST /internal/orchestrator-lock` set/clear the state on worker-python; worker-python stores it in `PATH_UTILTIES/orchestrator/lock-python.json`.
- [ ] Bypass mechanism: orchestrator includes `X-Orchestrator-Run-Id: <id>` + `X-Orchestrator-Token: <token>` headers; the workers honor those for their own start-job calls.

### Phase 5 — Orchestrator coordinator (~2–3 days)
- [ ] `coordinator.ts`: given a run config, executes steps sequentially. For each enabled step:
  1. Insert/update `OrchestratorRunStep` row → `running`.
  2. Start child job (in-process for node steps, HTTP for python step).
  3. Poll every 60s via `check-status/:jobId` until terminal.
  4. Translate child status → step status, persist, call report writer to update the job-status sheet.
  5. On failure → fail-fast: mark run `failed`, write report with what we have, release lock, exit.
- [ ] `childJobClient.ts`: helpers for (a) calling worker-node's existing job entry points directly via the queue engine (no self-HTTP) and (b) HTTP calls into worker-python with the bypass headers.
- [ ] Special handling for step 2 (google-rss):
  - Capture `maxArticleId` before & after; persist on `OrchestratorRun`.
  - If `after - before == 0`: mark run `completed_no_new_articles`, populate the google-rss step's `result.message` with a descriptive reason (read from the worker-node job's result if available, else "completed, 0 articles added"), skip remaining downstream steps, write report.
- [ ] Cancellation: `coordinator` checks an `AbortSignal` between polls and after each child-status return. On abort: cancel current child via `POST /queue-info/cancel_job/:jobId`, mark step + run `canceled`, write report, release lock.
- [ ] Crash safety: on `worker-node` startup, scan `OrchestratorRun.status = 'running'` and reconcile to `failed` with reason `worker_restarted_before_completion`; reconcile any `running` `OrchestratorRunStep` rows similarly. Also clear the lock files if their owning run is no longer running.

### Phase 6 — Excel report writer (~½ day)
- [ ] `reportWriter.ts` using `xlsx` (already available in the monorepo via worker-node's existing usage; verify, otherwise add).
- [ ] Sheet 1 ("Articles") — one row per article in `(articleIdCursorBefore, articleIdCursorAfter]`. Columns: `articleId, title, scrapeStatus, aiAssignedState, aiApproverScore, semanticRating`. Single SQL query joining the relevant tables.
- [ ] Sheet 2 ("Jobs") — one row per `OrchestratorRunStep`. Columns: `jobName, startTime, endTime, duration, status, reasonForEnding`. Written/rewritten after each step transition.
- [ ] Path: `PATH_UTILTIES/orchestrator/reports/`. Directory created on demand.
- [ ] Filename: always `YYYYMMDD-HHMMSS-orchestration-report.xlsx` (use the run's `startedAt`).
- [ ] Persist final path on `OrchestratorRun.reportFilePath`.

### Phase 7 — worker-node HTTP surface (~½ day)
- [ ] `POST /orchestrator/start` — body: `{ steps: { delete: {enabled, args}, googleRss: {enabled, args}, stateAssigner: {enabled, args}, aiApprover: {enabled, args}, semanticScorer: {enabled, args} } }`. Server forces `googleRss` and `stateAssigner` and `delete`-? Actually: per user, mandatory are step 1 (delete? — re-read), step 2 (google-rss), step 3 (state-assigner). Re-clarify if needed; server will enforce these as always-enabled regardless of body. Returns 202 + `runId`.
- [ ] `GET /orchestrator/runs` — paged list.
- [ ] `GET /orchestrator/runs/:id` — full run + steps.
- [ ] `POST /orchestrator/cancel/:id` — cooperative.
- [ ] `GET /orchestrator/runs/:id/report` — streams the xlsx.
- [ ] 409 if a `running` run already exists.
- [ ] Tests: route contract + one happy-path coordinator test with mocked child workers.

### Phase 8 — api proxy (~½ day)
- [ ] `api/src/routes/orchestrator.ts`: thin proxy over the worker-node routes.
- [ ] Auth: standard logged-in middleware (no admin gate).
- [ ] Tests + mount in `api/src/routes/index.ts`.

### Phase 9 — Portal UI (~1–2 days)
- [ ] New `src/components/automations/OrchestratorSection.tsx`:
  - Six checkboxes, three of them disabled & always checked (delete, google-rss, state-assigner).
  - Per-step inputs where relevant (mostly pass-through to existing args).
  - "Start Orchestrator" button → POST.
  - Live status panel reusing the shape of `WorkerNodeJobStatusPanel`, polling `GET /orchestrator/runs/:id` every 5s once a run is active.
  - Past-runs table with download-report links.
  - 423 / 409 surfaced as friendly messages.
- [ ] Add to `src/app/(dashboard)/articles/automations/page.tsx`.
- [ ] No new global state — local component state + Redux only if pattern-consistent with the existing sections.

### Phase 10 — End-to-end shakedown
- [ ] Run on a non-production dataset weekend, watch logs, verify report.
- [ ] Tighten timeout / poll cadence if needed.
- [ ] Document operational runbook in `worker-node/docs/`.

---

## Mandatory steps & UI behavior

Per user clarification, steps 1 / 2 / 3 (delete_articles, google-rss, state-assigner) are **mandatory** — the checkboxes appear, are pre-checked, and are disabled. The server **also** enforces this: if the request body sets `enabled: false` for any of those three, the start handler overrides to `true` (and logs that override). This way the UI cannot drift from the contract.

Steps 4 (ai-approver), 5 (semantic-scorer), 6 (report) are toggleable in the body. Recommended default is all enabled; the report step is essentially free and should default on.

## Early-exit on zero-new-articles

If google-rss completes with `articleIdCursorAfter == articleIdCursorBefore`:
- `OrchestratorRun.status = 'completed_no_new_articles'`.
- The google-rss step's `result.message` is populated descriptively. Sources, in order of preference:
  1. The child job's own result payload (which today reports things like "queries exhausted", "rate-limited", "fetch error", etc — extend the google-rss job to surface this if it doesn't already).
  2. Otherwise: `"completed, 0 articles added"`.
- Downstream steps are marked `skipped` with reason `no_new_articles`.
- Article sheet of the report will be empty by construction; sheet 2 makes the cause obvious.

This requires a small enhancement to `requestGoogleRssJob` to ensure its `result` payload contains a human-readable termination reason. Add to phase 3.

---

## Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Lock files become stuck if process crashes during write | On startup, reconcile orphan locks against `OrchestratorRun.status` — if no run is `running`, clear locks. |
| Worker-python lock-honoring drift (if its lock file gets stale) | Same reconciliation on its startup; orchestrator always re-asserts the lock at start of every step. |
| 60s polling adds latency at run end | Acceptable per user. Total run is hours; 60s is noise. |
| `xlsx` write contention from incremental updates | Write to `*.tmp` then atomic rename on each update. |
| Cursor approach misses articles inserted by *other* processes during step 2 | Mitigated by the lock — no other workflows can run during the orchestrator. |
| Long-lived async task crash inside coordinator | Top-level try/catch persists `failed` state with stack trace before exiting. |

---

## Estimated effort

Roughly one focused developer-week (5 days) for phases 1–9 with tests; allow a second week for the end-to-end shakedown, doc updates, and corrections. Phases 1, 2, 3 can be parallelized if multiple developers are available — they touch separate packages.

---

## Out of scope for v1 (deferred)

- Cron / automatic weekly trigger (add a systemd timer hitting the api endpoint later).
- "Resume from step N" after failure.
- Per-step `continueOnFailure`.
- Admin-only gate.
- Email or webhook notification on completion.
- Multi-run concurrency.
