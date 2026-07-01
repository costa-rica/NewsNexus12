---
created_at: 2026-06-23
updated_at: 2026-06-23
created_by: claude (opus-4.8)
modified_by: claude (opus-4.8)
---

# Assessment of weekly continuation plan v01

## Summary

The plan is technically sound overall and aligns with the existing architecture. The
target database is Postgres (`db-models/src/models/_connection.ts`, `PG_DIALECT`
defaulting to `postgres`), so the proposed JSONB `continuationPlan` column and the
nullable linkage columns are feasible. Note that `db-models/AGENTS.md` still describes
the package as "SQLite via Sequelize"; that doc is stale — anyone implementing schema
work should rely on the actual Postgres connection, not that file, and use `DataTypes.JSONB`
(not generic JSON).

The recommendations on AI Approver in-place updates and on deferring report-only
continuation are well-judged. The concerns below are about under-specification and a few
implementation risks that could prevent the eligibility contract from behaving
deterministically. None require restructuring the approach; they sharpen it for V02.

## Qualifying concerns

### 1. Eligibility logic keys off step states that reconciliation corrupts; anchor it on run-level bounds instead (focus #6)

**Evidence.** `reconcileOrphanedRuns` (`worker-node/src/modules/orchestrator/repository.ts:119`)
runs at worker boot (`worker-node/src/server.ts:62`) and does two things with no run-id
scope:
- marks every `running` run as `failed`;
- updates **all** steps `where: { status: ['running', 'pending'] }` to `failed` with the
  same `endingReason: 'worker_restart'`.

This collapses two distinct states — a step that was *in flight* (`running`) and a step
that *never started* (`pending`) — into one indistinguishable `failed/worker_restart`
state, across every run, not just the affected one. Meanwhile the plan's eligibility
shapes (plan lines 146–169) are written in terms of those exact step fields, e.g.
"Google RSS has a running, failed, timed-out, or canceled step," and the test plan asks
that "reconciliation only updates steps for affected runs."

**Why it risks success.** For a hard-restart run (run 14's shape), after reconciliation
the `google_rss` step and every downstream step look identical (`failed/worker_restart`),
so step state alone cannot tell the assessment *where* the run actually died. If the
assessment derives "inherited vs runnable" from per-step terminal status, it will read
already-corrupted data and can mis-plan the continuation.

**What to change in V02.**
- Make the reconciliation fix an explicit prerequisite (the plan already says this — keep
  it) and specify *what correct looks like*: scope the step update to the reconciled run
  ids, and preserve the never-started vs in-flight distinction (leave `pending` steps
  `pending`, or give them a distinct status/`endingReason`).
- Independently, state that the assessment's **primary** failure-locating signal should be
  the run-level bounds, which are robust regardless of step-state corruption:
  `articleIdMinExclusive` is written the moment Google RSS starts
  (`coordinator.ts:323-324`) and `articleIdMaxInclusive` only after it completes
  (`coordinator.ts:409,417`). So `min set + max null` ⇒ interrupted during Google RSS;
  `min set + max set` ⇒ Google RSS completed, failed downstream; `min null` ⇒ never
  reached Google RSS. Treat per-step status as advisory detail layered on top of these
  bounds, not as the source of truth.

### 2. Portal per-row continuation-assessment will trigger spreadsheet I/O and NewsApiRequests scans on every render/poll (focus #4)

**Evidence.** The portal currently loads `runs?limit=10` and filters out running runs
(`portal/src/components/automations/OrchestratorSection.tsx:216-221`). The plan has the
portal "request continuation assessments for incomplete runs shown in the table" (plan
line 348), and the assessment for a Google-RSS-interrupted run reads the query spreadsheet
and scans `NewsApiRequests` for matches (plan lines 232-242). The orchestrator section
also polls/refreshes.

**Why it risks success.** Running the *full* assessment — including Google RSS resume
planning (ExcelJS spreadsheet read + `NewsApiRequests` fallback matching) — once per
incomplete row on each table render or poll is disproportionately expensive for a UI list
and re-does heavy work just to decide whether to show a button.

**What to change in V02.** Split eligibility into two tiers:
- A **cheap** eligibility signal computed from the runs list itself (status shape, presence
  of `articleIdMinExclusive`/`articleIdMaxInclusive`, no active run) — enough to decide
  whether to render `continue`. Consider returning this as a field on the runs-list
  response so the table needs no extra round-trips.
- The **expensive** full assessment (Google RSS resume planning, warnings, inherited/
  runnable breakdown) computed lazily only when the user opens the confirmation modal, and
  re-validated server-side inside `POST /continue` (which the plan already does).

### 3. "Current max article id" includes articles from unrelated runs, not just "newer articles" — under-warned (focus #3)

**Evidence.** The upper bound is the global `SELECT COALESCE(MAX(id),0) FROM "Articles"`
(`coordinator.ts:137-143`). Between a source run's failure and its continuation, other
weekly/continuation runs or manual ingestion can add articles. For a run-11-style
continuation that skips Google RSS, downstream steps would then process the entire id
range from the source `articleIdMinExclusive` to the current global max — which can include
articles harvested by a completely different run (e.g. run 14's Google RSS output).

**Why it risks success.** The plan frames this only as "newer articles above the original
run max" (plan lines 264, 395, 425), which understates it. The practical harm is bounded
because AI Approver and semantic scorer are idempotent — the UNIQUE(articleId,
promptVersionId) constraint and the existing "skip already-scored" selection prevent
duplicate work — but the continuation's article counts and report range will silently
cover articles outside the source run's scope, which is exactly the kind of thing that
surprises an operator reading the report.

**What to change in V02.** Make the warning explicit that the continuation processes the
full id range regardless of which run created the articles, and state plainly that
downstream idempotency (unique score rows + skip-existing) is the safety net that keeps
this from double-processing. Optionally surface `articlesAddedCount` and a note that some
of those articles may belong to later runs.

### 4. New NewsApiRequests columns add cost with little benefit for the actual recovery targets, and the fallback list leans on a non-discriminating field (focus #1)

**Evidence.** The plan adds `orchestratorRunId` and `queryRowId` to `NewsApiRequests`
(`db-models/src/models/NewsApiRequest.ts`) but acknowledges run 14's existing rows are
`NULL` and must use fallback matching (plan lines 87-95). The fallback evidence list
includes `notString` (plan lines 95, 238), but the Google RSS job hardcodes
`notString: null` for automation rows (`requestGoogleRssJob.ts:577`), so it carries zero
discriminating power. `queryRowId` maps to a required numeric `id` column already present
in the query spreadsheet (`requestGoogleRssJob.ts:332,345-353`), and the resume planner
re-reads that spreadsheet at continuation time anyway, so the stored `queryRowId` is an
optimization rather than a necessity.

**Why it risks success.** Not a blocker, but the columns deliver nothing for the immediate
goal (recover runs 11 and 14) and the matching strategy is described as relying partly on a
field that is always null.

**What to change in V02.**
- Keep `orchestratorRunId` — it is cheap, clearly useful for future linkage, and feeds the
  report. Wire it through `storeRequestAndArticles` (`requestGoogleRssJob.ts:569`), which
  will require threading the run id into the Google RSS job.
- Treat `queryRowId` as optional/deferred, or justify it explicitly; the resume marker can
  be recovered by URL matching against the re-read spreadsheet without it.
- Remove `notString` from the documented fallback-matching evidence (or first fix the job
  to actually persist it), and base fallback matching on exact `url` first, then
  `andString`/`orString`/`isFromAutomation`/status/counts/timestamps.

### 5. In-place AI-score retry is the correct path, but the retry-selection logic is net-new and the current repo cannot update rows (focus #2)

**Evidence.** `AiApproverArticleScores` has a real UNIQUE(articleId, promptVersionId)
constraint (`db-models/src/models/AiApproverArticleScore.ts:152-156`), and the eligibility
query selects only articles that *lack* a score row for the prompt version
(`worker-python/src/modules/ai_approver/repository.py:127-250`, NOT-EXISTS/COUNT-DISTINCT
shape). The repository today exposes only `insert_score_row` (INSERT-only,
`repository.py:399-464`) with no update method.

**Why it matters.** The plan's recommendation to update failed rows in place is the
*lower-risk* choice precisely because of that unique constraint: an attempt-history table
would force either dropping the constraint or adding a new table and reworking the existing
eligibility queries — a larger restructure. So the plan is right. The risk is that the
current selection logic makes failed rows invisible (a row exists, so the article is
skipped), so retry requires brand-new selection logic plus a new UPDATE method, and the
"skip if a row exists" behavior must be bypassed *only* for the configured retryable
statuses without re-touching successful rows.

**What to change in V02.** State explicitly that v01 must add (a) a retry-selection query
that finds rows whose `resultStatus` is in the configured retryable set, and (b) an
`update_score_row` method that overwrites the failed row while preserving prior result/
error/job context in `metadata`. Confirm the eligibility/skip query is not accidentally
re-introduced into the retry path. Keep the attempt-history table out of scope.

## Note on focus #5 (report-only continuation)

The plan already marks report-only continuation as low priority and "should not be part of
the first continuation implementation" (plan lines 167-169, 305). Deferring it is the right
call and is not a qualifying concern; no change requested beyond keeping it out of v01
scope so the eligibility contract stays small.
