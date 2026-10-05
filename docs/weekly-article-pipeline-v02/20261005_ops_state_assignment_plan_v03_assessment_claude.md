---
created_at: 2026-10-05T22:48:15Z
updated_at: 2026-10-05T22:48:15Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Ops State Assignment Plan V03 Assessment

## Summary

V03 resolves the V01 concerns and applies the operator's decisions:

- Only an aborted queue signal ends processing early. Abort-like messages count as Article failures, and enrichment errors fall through to assignment.
- Every normal worker return that is not a cancellation saves a result.
- Missing queue parameters stop the phase instead of allowing replacement, so an old worker cannot cause repeated jobs.
- The 12-hour limit is reviewed policy. The README will explain that a replacement does not resume only the unfinished Articles.
- The threshold column is authoritative, and `phaseData.phase6.input` is a checked mirror.

One concern qualifies. It comes from the V02 fix for missing parameters.

## Concern 1: The missing-contract stop never clears

Criteria: the plan will not work as intended; following the plan's own fix instructions does not unblock the run.

Recovery rule 8 says: "Stop on missing or malformed queue parameters; do not replace that job automatically." The error tells the operator to deploy and restart a compatible worker-node. But nothing in the plan lets the run continue after they do that.

Here is the sequence if ops reaches Phase 6 before worker-node is updated:

1. Ops starts a job and saves its ID. The first status lookup has no `parameters`, so ops stops with the incompatible-contract error. The job keeps running in worker-node.
2. The operator deploys and restarts worker-node, as instructed. Startup maintenance (`queueMaintenance.ts`) marks the running job `failed` with `worker_restart`. It keeps the record, still without `parameters`.
3. The operator continues the run. Ops loads the saved job, finds no parameters again, and stops under rule 8.
4. Every later continuation does the same thing. The saved job ID never changes, and the record stays in the store for 30 days.

The only exit is `--new-run`. Within 72 hours, worker-node's RSS repeat suppression means the new run collects almost nothing, so its `articleCount` is near zero. This week's Articles would not reach Phase 7. That is the outcome the V01 assessment was trying to prevent.

The planned test "Missing worker parameters stop without starting a replacement" checks the first stop. It does not cover the continuation after a fix.

Recommendation:

- Keep stopping without replacement while a missing-contract job is still `queued` or `running`.
- Once a saved missing-contract job is inactive (`failed`, `canceled`, or `completed`), allow one replacement. Never trust its result.
- Record the decision in a marker tied to job ID and `createdAt`, like `monitoringLimit`. If the replacement also lacks the contract, stop with no further replacement. That limits an unfixed worker to one extra job.
- Optionally, cancel an active missing-contract job that ops started in the current invocation. Its result can never be accepted. Its assignments would still help Phase 7, so this is the operator's choice.
- Add a phase test that continues past an inactive missing-contract job (`worker_restart`) and completes with a compatible replacement. Add a second test showing that a second incompatible replacement stops.

## Non-blocking notes

- With 12 hours and a full newest-first reselection, a very large week might keep reaching the limit. Logging elapsed time with `selectedCount` and `articleCount` at cancellation would help the operator spot this.
