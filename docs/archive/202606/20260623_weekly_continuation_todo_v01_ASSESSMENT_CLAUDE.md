---
created_at: 2026-06-23
updated_at: 2026-06-23
created_by: claude (opus-4.8)
modified_by: claude (opus-4.8)
---

# Assessment of weekly continuation implementation TODO v01

## Summary

The TODO tracks plan v02 closely and is well structured: phases map cleanly onto the
plan sections, ordering matches the plan's implementation sequence, and the v01
plan-assessment concerns (run-level bounds as primary signal, two-tier eligibility,
deferring `queryRowId`, in-place AI-score retry) are reflected. Most phases are
implementation-ready.

Three qualifying concerns remain. They are not approach problems; they are gaps where an
implementer would either be confused, wire an integration point incompletely, or silently
break the run-14 resume semantics because the existing coordinator code does the opposite
of what the plan requires. Each is fixable with a more explicit task in the next TODO
version.

## Qualifying concerns

### 1. Run-14 continuation re-runs Google RSS, but the coordinator re-captures `articleIdMinExclusive` — TODO never says to inherit the source value on the RSS-replay path

**Evidence.**
- The coordinator unconditionally captures a fresh lower bound whenever it executes the
  `google_rss` step: `if (stepConfig.stepName === 'google_rss') { articleIdMinExclusive =
  await captureMaxArticleId(); await updateRunStatus(runId, 'running', {
  articleIdMinExclusive }); }` (`worker-node/src/modules/orchestrator/coordinator.ts:322-324`),
  and that value is what feeds every downstream step body
  (`coordinator.ts:331-333`, `448-449`).
- The plan requires the *source* run's `articleIdMinExclusive` to be the downstream lower
  bound for **all** continuation paths after Google RSS, including the run-14 RSS-replay
  case (plan lines 318, 497-498).
- TODO Phase 5 states this only as "For downstream continuation after Google RSS, use the
  source `articleIdMinExclusive`" (todo line 123). Read against the code, that task reads as
  the run-11 *skip-RSS* path. For run 14 the `google_rss` step is itself a **runnable** step
  (todo lines 222-223), so the existing line 323 path runs and overwrites the inherited
  source min with a fresh capture taken *after* the source run already harvested part of its
  RSS output.
- TODO Phase 9's run-14 validation checklist (todo lines 217-231) lists `articleIdMinExclusive`
  is set, but unlike the run-11 checklist it has **no** "lower bound comes from source
  `articleIdMinExclusive`" assertion, so this defect would pass validation unnoticed.

**Why it risks success.** A fresh capture at continuation time is strictly greater than the
source min (the source's own partial Google RSS, plus any unrelated ingestion, raised the
max in between). Downstream steps would then process only `(continuation-capture, currentMax]`
and silently **exclude the source run's already-fetched Google RSS articles** — exactly the
articles the run-14 continuation exists to finish processing. The run completes "successfully"
while skipping its target rows.

**What to change in V02.** Make explicit that on a continuation run the coordinator must
**not** re-capture `articleIdMinExclusive` from `captureMaxArticleId()`; it must seed the
run-level lower bound from the source run's `articleIdMinExclusive` (the inherited
`continuationPlan` value) and keep it fixed even while the `google_rss` step re-runs. Only
the *upper* bound is captured fresh (after resumed Google RSS completes). Add a run-14
validation line asserting the downstream lower bound equals the source `articleIdMinExclusive`,
not a freshly captured value, so the regression is caught.

### 2. Cheap-signal delivery is left as an either/or, but only one of the two options has a matching API-proxy task — the batched-endpoint option has no proxy and no portal reachability

**Evidence.**
- Phase 3 offers two delivery shapes: "Add a cheap list-level continuation signal to recent
  runs, **or** expose a cheap batched endpoint" (todo line 62), mirroring the plan
  (plan lines 150, 408).
- Phase 7 (API proxy) adds only the two continuation routes plus "Preserve cheap continuation
  signal fields through **any runs-list proxy path**" (todo line 167). There is no task to add
  a proxy route for a separate batched cheap-signal endpoint.
- The existing API `/runs` proxy forwards `response.data` verbatim
  (`api/src/routes/automations/orchestrator.ts:67-82`), and the portal reads the signal off
  the `runs` list it already fetches (`portal/src/components/automations/OrchestratorSection.tsx:213-221`,
  `fetchPastRuns` → `runs?limit=10`). So the **embed-in-runs-list** option works end-to-end
  with no new proxy. The **batched-endpoint** option does not — it would be unreachable from
  the portal.

**Why it risks success.** If the Phase 3 implementer picks the batched-endpoint branch
(legitimate per the TODO as written), Phase 7 has no task to proxy it and Phase 8 has no task
to fetch it, leaving the portal unable to render the `continue` button. The phases would each
look "complete" while the feature is dead at the integration boundary.

**What to change in V02.** Either (a) commit the TODO to embedding the cheap signal as fields
on the existing runs-list response (preferred — it rides the existing verbatim `/runs` proxy
and the portal's existing `fetchPastRuns`), or (b) if a separate batched endpoint is allowed,
add the corresponding Phase 7 proxy-route task and a Phase 8 fetch task so the choice stays
wired through api → portal.

### 3. Worker-node status-code contract for assessment/continue is never pinned at the source, yet the proxy and portal phases depend on it

**Evidence.**
- Phase 3 says the GET assessment should "Reject missing, running, completed,
  `completed_no_new_articles`, pre-Google-RSS, already-active-continuation, and unrecognized
  failure shapes" (todo line 79) without saying whether "reject" means an HTTP error status or
  a `200` carrying `eligible: false` + `blockingReasons`. The plan lists `blockingReasons` as a
  *response field* (plan line 191) and the API-proxy plan says "`200` for assessment"
  (plan line 412), implying GET assessment is always `200`-with-body — but the TODO never
  states this.
- Phase 5's POST `/continue` rejection task is only "Reject no-longer-eligible requests with an
  appropriate status and response body" (todo line 115) — no mapping of which reason yields
  `404` vs `409` vs `422`. (For reference, the existing `/start` handler returns `409` for an
  active run and `202` on success, `worker-node/src/routes/orchestrator.ts:113-138`.)
- Phase 7 must "Preserve worker-node response bodies and status codes" and verify `200/202/404/
  409/422`, but conditions `422` on "if worker-node uses that style" (todo lines 160-166), and
  Phase 8 must "Surface no-longer-eligible and unsupported-shape responses clearly"
  (todo line 193). Both consume a contract the producing phases never fix.

**Why it risks success.** The proxy is a transparent pass-through and the portal branches on
status, so if Phase 3/5 don't pin the codes, Phase 7's "preserve" tests have no fixed target
and Phase 8 can't deterministically distinguish "no longer eligible" (re-fetch/disable) from
"unsupported shape" (explain) from "not found." The cross-package behavior becomes
implementer-dependent and likely inconsistent.

**What to change in V02.** In Phase 3/5 define the concrete contract the later phases must
preserve and branch on, e.g.: GET assessment always returns `200` with `eligible` +
`blockingReasons` (never an error for a recognized-but-ineligible run); POST `/continue`
returns `202` + new run id on success, `404` for missing source, `409` for active run or
now-ineligible, `422` for recognized-but-unsupported shapes. Then Phase 7/8 reference that
fixed table instead of "if worker-node uses that style."

## Minor note (not a blocking concern)

Phase 5's "Ensure active-run guard treats standard and continuation runs the same"
(todo line 121) is correct, but the existing guard is an **inline** check in the route
handler (`getActiveOrchestratorRunId()` returning `409`) followed by `invalidateActiveRunCache()`
after run creation (`worker-node/src/routes/orchestrator.ts:112-137`), not shared middleware.
The new POST `/continue` handler must replicate both the inline check and the
`invalidateActiveRunCache()` call, or a continuation could be created without busting the
active-run cache. Worth a one-line reminder in the next TODO; not a standalone blocker.
