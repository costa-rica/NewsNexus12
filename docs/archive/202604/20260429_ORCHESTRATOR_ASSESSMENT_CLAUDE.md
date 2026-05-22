# Weekly Orchestrator — Feasibility Assessment & Recommendations

Companion review of `docs/20260429weeklyOrchestratorAutomation.md`. Scope:
1. Is this feasible?
2. Answers / recommendations for the open questions.
3. Issues and gaps not yet covered in the plan.
4. A recommended shape for the implementation.

---

## 1. Feasibility — short answer: yes

Nothing in this plan requires new infrastructure. The building blocks already exist:

- `worker-node` exposes queue-backed start-job routes for `request-google-rss`, `state-assigner`, `semantic-scorer`, `article-content-scraper-02`, with a shared global queue (concurrency 1, FIFO, durable JSON store, cancellation, and `GET /queue-info/check-status/:jobId` + `GET /queue-info/latest-job?endpointName=...`).
- `worker-python` exposes the same queue contract for `/ai-approver/start-job` (and deduper / location-scorer).
- Both workers already persist job lifecycle (queued → running → completed/failed/canceled) so polling-based completion detection is a solved problem.
- `db-manager` `--delete_articles` is a CLI; the only piece missing is a way to invoke it without a child process (see Q1).

The "weekly long-running orchestration" use case is a thin coordinator on top of those existing primitives. It does not need a new queue engine, new auth, or new database infrastructure.

The two real risks are operational, not architectural:
- **Long total wall-clock time** (potentially 24+ hours for the RSS step alone). The orchestrator must survive worker restarts, network blips, and not hold an HTTP connection open.
- **Cancellation semantics** across nested jobs. Canceling the parent must cancel whichever child job is currently running.

Both are tractable but need to be designed in from day one, not bolted on.

---

## 2. Open questions — recommendations

### Q1. Should `db-manager --delete_articles` be duplicated into `worker-node` / `worker-python`, or invoked as a child process?

**Recommendation: absorb it into `worker-node` as a new queue-backed job.**

Reasons:
- It matches the direction `worker-node`'s AGENTS.md already states explicitly: "Build for absorption, not for one-off scripts. The long-term direction of this project is to absorb legacy microservices into stable in-process modules."
- The deletion logic in [src/modules/deleteArticles.ts](db-manager/src/modules/deleteArticles.ts) is already TypeScript on top of `@newsnexus/db-models` — same stack as `worker-node`. Lifting the module is mechanical.
- Going through a child process means: a second logger, a second DB connection, a second env-resolution path, no shared cancellation, and harder failure reporting back to the orchestrator.
- Once it lives in `worker-node`, the orchestrator just calls `POST /delete-articles/start-job` and polls the same way it polls everything else. Uniformity is the win here.

`db-manager` keeps its CLI (it's still the maintenance tool for backup/import). This is not a deprecation, just a duplication of one function into the worker runtime — and AGENTS.md already endorses that pattern (state-assigner deliberately reuses scraper logic instead of forking).

Rough effort: a day. Move `deleteArticles.ts`, add a route + job module mirroring `semanticScorer`, add a smoke test.

### Q2. How does the orchestrator know each step is done?

**Recommendation: poll `GET /queue-info/check-status/:jobId` on a fixed interval per step (e.g. every 30–60s).**

This is the contract both workers already expose, and it's exactly what the portal's `WorkerNodeJobStatusPanel` / `WorkerPythonJobStatusPanel` already use. Don't invent a webhook / callback channel — it's a second contract to maintain and the queue store is already the source of truth.

A 30s poll over a 24-hour run is ~2,880 cheap requests; trivial.

Add a per-step **maximum wall clock**: if a step exceeds N hours (24 for RSS, smaller for the others), the orchestrator cancels it via `POST /queue-info/cancel_job/:jobId`, marks the step `timed_out`, and decides per the run config whether to continue or abort.

### Q3. Track orchestrator runs in a Postgres table or in JSON under `PATH_UTILTIES`?

**Recommendation: Postgres table(s), but only one or two.**

Two tables is plenty:

- `OrchestratorRun` — one row per run. Columns: `id`, `triggeredByUserId`, `startedAt`, `endedAt`, `status` (running/completed/failed/canceled/partial), `config` (JSONB: which steps enabled, args), `articleIdRangeStart`, `articleIdRangeEnd` (the count/range from step 2 — see issue #3 below), `reportFilePath`, `failureReason`.
- `OrchestratorRunStep` — one row per step within a run. Columns: `id`, `runId`, `stepName`, `stepOrder`, `enabled`, `workerJobId`, `worker` (`node`/`python`), `endpointName`, `startedAt`, `endedAt`, `status`, `result` (JSONB: counts, etc.), `failureReason`.

Why a table over JSON-in-`PATH_UTILTIES`:
- The portal already talks to Postgres via the api. Listing past runs / showing live progress is one more router, no new transport.
- Reporting (the Excel sheet 2 — job statuses) becomes a single query.
- The two workers already use JSON-backed queue stores for their own jobs; layering a third JSON store for run metadata would fragment status data across three locations.

The actual run data fits trivially in two tables. Don't over-model — these are not first-class business entities, they're operational records.

### Q4. Should the orchestrator be an API or a standalone CLI?

**Recommendation: an HTTP service that the existing `api` proxies to, following the same pattern as worker-node and worker-python.**

The plan already states the desired UX: kick off from the portal automations page, with cancellation. That requires HTTP. A CLI-only orchestrator forces the user onto the server and gives up the cancel UX entirely.

But — and this is the meaningful refinement — **don't build a brand-new fourth service**. Put the orchestrator inside `worker-node`. Reasons:

- It already has the queue engine, durable JSON store, cancellation, logger, error contract, DB initialization, and route conventions. The orchestrator is just one more queue-backed job whose body is "call other endpoints and poll."
- It already speaks to `worker-python` over HTTP (or will, easily) — same pattern as the api proxy.
- One more deployment unit (a fourth service) means another systemd unit, another reverse-proxy block, another `.env`, another set of logs to chase. No payoff.
- The "concurrency 1" constraint of `worker-node`'s queue is a feature here: it prevents the orchestrator from running concurrently with a manually-kicked job that would step on it.

So:
- New route in worker-node: `POST /orchestrator/start-job`, `GET /orchestrator/runs`, `GET /orchestrator/runs/:id`, `POST /orchestrator/cancel/:id` (or reuse `/queue-info/cancel_job/:jobId`).
- The orchestrator job itself loops through enabled steps, calling the worker-node endpoints as in-process function calls (no need for self-HTTP) and the worker-python endpoints over HTTP.
- The api adds a thin proxy router; the portal adds a new section on the automations page.

There is one wrinkle: if the orchestrator job sits in `worker-node`'s single global queue and holds it for 24+ hours, **no other worker-node job can run during that window**. That's actually what the user wants weekly (the whole point is that these steps run sequentially without interference) but it must be acknowledged. See issue #1.

---

## 3. Issues / gaps in the current plan

### Issue 1 — The orchestrator job will starve worker-node's global queue

`worker-node`'s queue is `concurrency: 1`. If the orchestrator runs as a queued job there, and step 2 takes 24h, nothing else in worker-node can run for 24h — including manually-kicked jobs from the portal.

**Mitigations:**
- Acceptable for a weekend run. Document it. The portal UI should show "orchestrator running" prominently and disable other start-job buttons.
- Or: run the orchestrator *outside* the queue (a regular long-lived async task) and have it enqueue the **child** steps into the queue normally. The orchestrator itself never occupies the queue slot; only the currently-executing child step does. This is cleaner. It does require a small extension to the queue engine to allow non-queue-managed work, or simply run the orchestrator directly as a background async chain not registered in the queue.

I'd lean toward the second: the orchestrator is a coordinator, not a worker.

### Issue 2 — Tracking "articles added in step 2" needs care

The plan suggests "first and last articleId added." That's almost right but assumes monotonically-increasing IDs and no concurrent inserts. Both assumptions are usually true in this system but not guaranteed forever.

**Recommendation:** capture `(maxArticleIdBefore, maxArticleIdAfter)` immediately before and after step 2, and pass `maxArticleIdBefore` (exclusive) downstream. Steps 3, 4, 5 then operate on `WHERE article.id > :cursor`. This is a stable, well-defined "articles added in this run" cursor. Store both on `OrchestratorRun`.

The `state-assigner` and `ai-approver` endpoints currently take a `targetArticleStateReviewCount` / count argument, not a cursor. Either:
- Add an optional `articleIdCursor` argument to those endpoints (preferred — counts are racy), or
- Compute the count as `maxAfter - maxBefore` and pass that count, accepting the small race window.

### Issue 3 — "Run scraping piggybacked off RSS" — verify this is still true

The plan says step 2 should include scraping. Per worker-node AGENTS.md, `requestGoogleRss` does seed/follow-up scrape inline, but **only on first ingestion path**, and the standalone `article-content-scraper-02` exists for automation use. Worth confirming with a small audit: after step 2, what fraction of newly-added articles still have no `ArticleContents02` row? If non-trivial, the orchestrator should run `article-content-scraper-02` as a step 2.5 over the new article cursor before state-assigner. The plan should either include that step or explicitly justify omitting it.

### Issue 4 — Failure policy is unspecified

When step 3 fails, do steps 4–6 still run? Options:
- **Fail-fast:** abort run on any step failure. Simplest.
- **Continue on failure:** mark the step failed in the report and proceed. Useful when, e.g., state-assigner times out but you still want the approver to run on what's there.
- **Per-step toggle.** Overkill for v1.

Recommendation: fail-fast by default, with a per-step `continueOnFailure` flag in the config (default false). The Excel report already has a "reason for ending" column that supports this.

### Issue 5 — Concurrency / re-entrance

If a user clicks "Start Orchestrator" twice, or the previous run is still going, what happens? Recommend: at most one orchestrator run in `running` status at any time. Reject the second start with 409. Easy DB constraint or app-level check.

### Issue 6 — Excel report timing & location

- Where does the file land? Likely under `PATH_UTILTIES/orchestrator/reports/`. Add a route to download it through the api like the existing `/downloads` router.
- Should the second sheet (job statuses) be written **incrementally** as steps complete, or only at the end? Incremental is much more useful — if the run dies at step 4, you still have step 1–3 status. Recommendation: write the job-status sheet at the end of each step (cheap), write the article sheet only at the end.
- Filename collision rule in the plan ("add HHMM_SS to following files") is slightly ambiguous — does the *first* file of the day get the date-only name and subsequent ones get HHMMSS, or do all files get HHMMSS when there's more than one? Cleaner rule: always append `-HHMMSS` if there's any chance of collision, i.e. always include time. `YYYYMMDD-HHMMSS-orchestration-report.xlsx` is unambiguous and trivially sortable.

### Issue 7 — Auth and trigger source

The plan implies portal-triggered. Add: who can trigger? Probably gate behind an admin-role check in the api proxy router. Also decide whether a cron-style schedule should auto-fire weekly, or whether human-trigger is enough for v1. Recommend human-trigger only for v1; layer cron later via a simple systemd timer that hits the api endpoint.

### Issue 8 — Cancellation propagation

Canceling an orchestrator run must:
1. Cancel the currently-running child job via `POST /queue-info/cancel_job/:jobId` on the appropriate worker.
2. Stop the orchestrator's polling loop.
3. Mark the run and the active step as `canceled`.
4. Skip remaining steps and still write the Excel report (as a partial run).

This is straightforward but needs explicit handling in the orchestrator loop — if the loop just `await`s the next poll and then checks an abort flag, cancellation latency is bounded by the poll interval, which is fine.

### Issue 9 — Idempotency on worker restart

If `worker-node` restarts mid-run, its queue reconciliation marks running jobs as `failed`. The orchestrator's child step then reports failed. The orchestrator should **not** automatically retry — silent retries on a 24h job are dangerous. Surface the failure, let a human decide. Optionally, allow "resume from step N" as a manual operation later.

### Issue 10 — Logging / observability

Centralize orchestrator logs (use the existing `worker-node` Winston logger). Each step transition should log `runId`, `stepName`, `workerJobId`. With those three you can pivot between orchestrator logs, worker-node logs, and worker-python logs during incident review.

---

## 4. Recommended shape (concise)

- **Where:** new module inside `worker-node` (`src/modules/orchestrator/` + `src/routes/orchestrator.ts`). One new job module type, but the orchestrator itself runs *outside* the global queue as a long-lived async task; it enqueues child jobs into the queue normally.
- **Db:** two new Sequelize models in `db-models`: `OrchestratorRun`, `OrchestratorRunStep`. Sync runs on worker-node startup like any other model.
- **Db-manager delete:** absorbed into worker-node as `POST /delete-articles/start-job`.
- **Step coordination:** call worker-node steps in-process; call worker-python over HTTP. In both cases, poll `/queue-info/check-status/:jobId` on a 30s interval with a per-step max wall-clock.
- **Cursor:** capture max(article.id) before and after step 2; pass cursor to steps 3–5 (extending those routes' arguments).
- **Report:** write to `PATH_UTILTIES/orchestrator/reports/YYYYMMDD-HHMMSS-orchestration-report.xlsx`. Two sheets: articles in cursor range, and run-step statuses.
- **API:** new router `api/src/routes/orchestrator.ts` that proxies start/list/get/cancel into worker-node. Admin-only.
- **Portal:** new "Orchestrator" section on the automations page with: 6 step checkboxes, optional per-step args, "Start" button, live status panel reusing the existing `WorkerNodeJobStatusPanel` shape, list of past runs with download-report links.
- **Failure policy:** fail-fast by default; `continueOnFailure` opt-in per step.
- **Concurrency:** at most one `running` orchestrator run at a time, enforced in the start handler.
- **No cron in v1.** Human-triggered only.

---

## 5. Sequencing / rough effort

A reasonable phased delivery:

1. Absorb `deleteArticles` into worker-node as a queue-backed job. (~1 day)
2. Add `OrchestratorRun` / `OrchestratorRunStep` models + db-models export. (~½ day)
3. Add cursor support (`articleIdCursor`) to state-assigner, ai-approver, semantic-scorer route bodies. (~1 day, plus tests)
4. Build the orchestrator coordinator (modular per-step runner, poll loop, cancellation, run/step persistence). (~2–3 days)
5. Excel report generator (`xlsx` lib already conventional). (~½ day)
6. api proxy routes + portal section. (~1–2 days)
7. End-to-end smoke run on a low-traffic window before declaring done.

Roughly a one-developer week, possibly two with testing and the inevitable yak-shaves.

---

## 6. Things I'd want answered before coding

1. Is it acceptable that the weekly orchestrator run blocks all other worker-node work for its duration, or do we need the "orchestrator outside the queue, only its children inside" arrangement?
2. Confirm step 2 actually scrapes inline reliably enough to skip a dedicated scraper step, or commit to including `article-content-scraper-02` as step 2.5.
3. Confirm the article-cursor approach (vs. the count approach) is acceptable, since it requires extending three worker-node/worker-python endpoints.
4. Confirm "fail-fast by default" matches operational expectation.
5. Who should be allowed to trigger an orchestrator run from the portal (any logged-in user, or admin only)?
