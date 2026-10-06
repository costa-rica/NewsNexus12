---
created_at: 2026-10-06T17:30:00Z
updated_at: 2026-10-06T17:30:00Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Ops AI Approver V02 Plan V01 Assessment

## Summary

I checked the plan against the PRD V10, the Phase 6 V05/V06 plans and implementation, and the worker-python V02 code:

- `worker-python/src/routes/ai_approver_v02.py`
- `worker-python/src/modules/ai_approver_v02/repository.py` and `orchestrator.py`
- `worker-python/src/modules/queue/engine.py` and `job_ids.py`

Most of the plan matches the worker:

- The preview, start, detail, and cancel routes exist with the described shapes.
- `no_eligible_articles` is a typed HTTP 400.
- `parameters.runId` is already persisted on the queue record.
- The counter invariants hold for a `completed` run.
- Startup reconciliation behaves as the plan describes.

Two concerns qualify.

## Concern 1: The replacement policy contradicts the operator's answer

Criteria: the plan will not implement the operator's requirement. It also repeats a design the operator already replaced in Phase 6.

Open Question 2's operator response says:

> Allow unlimited Phase 7 continuation attempts … Each invocation starts at most one new Phase 7 job and exits if that job fails.

The plan body still uses the one-replacement design throughout:

- "Allow at most one replacement V02 execution for the weekly run."
- Safeguard 3 persists that the replacement allowance is consumed. Safeguard 4 says "stop for operator review without a third execution."
- Start-ambiguity step 4 says to "use the one replacement allowance."
- The durable state includes `replacementConsumed`.
- The error categories include `replacement exhausted`.
- The tests include "No third execution after replacement failure" and "One replacement for failed, canceled, …".
- "Use dedicated persistence operations for … replacement consumption."

This is the same move Phase 6 made from V04 to V05/V06. That move required removing a singular replacement slot, a completion check tied to it, and runner messages like "no second replacement is allowed". If Phase 7 is built on the V01 body, the same cleanup will be needed right after implementation.

The singular `monitoringLimit` node also does not fit unlimited attempts. Rejecting a "monitoring-limited late completion" requires keeping every limited attempt, not only the latest one.

Recommendation:

- Rewrite the recovery section to match the operator's answer, using the Phase 6 V06 model:
  - Unlimited continuation attempts.
  - At most one new V02 start per invocation.
  - The invocation exits after an unsuccessful attempt.
- Remove `replacementConsumed`, the `replacement exhausted` category, the "replacement consumption" persistence operation, and the "no third execution" test.
- Replace `currentAttempt` + `monitoringLimit` with repeatable attempt history.
  - Identify each attempt by `v02RunId` plus `jobId` and queue `createdAt`.
  - Worker-python job IDs are not globally unique. `get_next_job_id` derives them from the highest ID in the queue store file, so a reset store reuses `0001`.
  - `v02RunId` is a database serial and is the stable key.
- Mark monitoring-limited attempts inside that history. Completion must reject any `v02RunId` that is marked.
- Use one protected "continuation start" persistence operation for every replacement reason. This mirrors Phase 6 V06 and avoids a separate operation per reason.
- Keep the positional-window and AI-cost warning. With unlimited attempts it matters more, because each replacement re-reads the newest `articleCount` positions.
- Add tests for:
  - three or more invocations, each starting one replacement;
  - a late completion of a monitoring-limited attempt that is rejected after a later attempt has started.

## Concern 2: A 404 detail response is treated as replacement-eligible in cases where it should stop

Criteria: the plan will not work as written for start ambiguity, and it risks a duplicate or misdirected AI run.

`GET /ai-approver-v02/runs/:runId` calls `repository.get_run(run_id, include_preview=False)`. That query adds `AND status NOT IN ('draft', 'expired')`. As a result:

1. Ops can never see `draft` or `expired`. Start-ambiguity step 4, "If it remains a draft or expires without starting", cannot be observed. A draft, an expired preview, and a purged preview (deleted after `expired_preview_retention_days`, default 7) all return the same 404 `run_not_found`.
2. Accepted V02 runs are never deleted. Once a run reaches `queued`, the worker keeps that row in every status. A 404 for a run ops already knows was accepted cannot mean "unavailable". It means ops is talking to a different database or worker than the one that accepted the run, or the identity is corrupted.

The plan lists "an unavailable execution whose persisted identity cannot resolve to an active or completed V02 run" as replacement-eligible. In case 2, that starts a new V02 execution against an environment that does not match the saved attempt. It also discards a run that may still be active elsewhere.

Recommendation:

- Treat a 404 on the saved `v02RunId` as an unaccepted preview, and therefore replacement-eligible, only when both hold:
  - the attempt has no saved job ID;
  - no detail lookup ever observed it in `queued`, `running`, or a terminal execution status.
- Persist an "accepted" observation (job ID, or first observed execution status) on the attempt so this distinction survives restarts.
- When an attempt is known to be accepted and the detail lookup returns 404, classify it as an identity mismatch or unverified outcome and stop. Do not replace it.
- Reword start-ambiguity step 4 to: "404 before any acceptance was observed → unaccepted preview." Drop the draft/expired distinction, which ops cannot see.
- Add a test for each case: a pre-acceptance 404 that is replaced, and a post-acceptance 404 that stops.

## Non-blocking notes

1. **Start conflict with a manual V02 run.** `accept_preview` returns 409 `v02_run_conflict` ("Another V02 run is queued or running") when a portal or manual V02 run is active. This is a realistic collision, but the plan lists "preview conflict" without defining what happens. Specify the behavior:
   - Stop the invocation.
   - Record the attempt as unaccepted, not failed.
   - Never cancel the other run.
   - Let the draft expire.

   Also tell the operator that a manual V02 run blocks Phase 7.
2. **Queued run with no job ID can be momentary.** `start_run` commits `queued` in `accept_preview`, then enqueues, then calls `attach_job_id`. A detail lookup right after a timed-out start can briefly see `queued` with `jobId = null`. Classify an orphaned accepted run as a stop for this invocation only. Do not save it as a permanent disqualifier, so a later continuation can adopt the job ID once it is attached.
3. **Cancel can return `not_found`.** `queue_engine.cancel_job` returns `outcome = not_found` when the durable run is `queued`/`running` but the in-memory queue does not hold the job. The plan already rejects anything except `canceled` and `cancel_requested`. Add an explicit client test for `not_found`.
4. **Zero work after an earlier attempt.** A replacement preview can return `no_eligible_articles` because an earlier failed attempt already predicted most Articles. Failed and invalid Articles with `attemptCount = 2` are also excluded. Completing the run is correct, but the Phase 7 result should not look like a weekly run that did no AI work. For example, record `zeroWorkAfterPriorAttempts: true` alongside the attempt history.
5. **Worker changes are likely tests only.** `parameters.runId` is already enqueued. The detail route already returns the full `SELECT *` run, including all counters, `startedAt`, `endedAt`, and `endingReason`, plus the full queue record. `previewToken` is already null after acceptance, and drafts are hidden. Before changing anything, the implementer should confirm that each worker item in "Worker Contract Adjustments" is a contract-locking test, not new route code. That avoids redundant changes to a route the portal and API proxy already use.
6. **Queue wait counts against the 12-hour limit.** Because the limit is measured from queue `createdAt`, time a V02 job spends waiting behind other worker-python jobs (deduper, location scorer) counts toward it. This matches the operator's answer. Mention it in the README so a limit hit caused by a long queue wait is not read as a slow V02 run.
