---
created_at: 2026-10-03T18:28:22Z
updated_at: 2026-10-03T18:28:22Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Weekly Combined Flow PRD V06 Assessment

## Summary

V06 adds the single-execution policy cleanly:

- one active coordinator;
- immediate rejection of any extra trigger, whether manual or from systemd, with nothing queued;
- no lock or queue columns in `WeeklyArticleFlowRuns02`;
- the guard checked before stopped-run recovery.

That is consistent with the persistence plan and with how systemd timers behave: a timer that fires while its service is still active does not queue a second run.

One requirement contradicts decisions the operator already made and the PRD's own default-trigger table, so it qualifies.

## Concern 1: "Verify uncertain destructive-operation outcomes before starting replacement work" conflicts with the agreed rerun behavior

Criteria: contradictory requirement; implementers would be confused.

Progress and recovery, item 3 (carried over unchanged from V05) says: "Leave the old run incomplete and verify uncertain destructive-operation outcomes before starting replacement work."

This conflicts with three things:

1. **The operator's Phase 1 decision.** Recorded in the Phase 1 plan V02 assessment and Plan V03–V04: a failed or timed-out Phase 1 stops the run, and "the next run starts again at Phase 1 without a manual outcome check." The operator said this explicitly: "We don't need to know and I don't want to add extra logic to check."
2. **The Phase 2 and Phase 3 implementations.** On failure they stop, keep their artifacts and start fresh on the next run. Phase 3 reports a timeout as an "uncertain, potentially partial deletion" and relies on the new Phase 2 backup plus an idempotent rerun, not on a verification step.
3. **The PRD's own scheduling table.** "Incomplete and stopped during phases 1–3 → Start a new run at phase 1, regardless of age." That is the *automatic* action of a no-argument trigger, including the unattended Friday 05:00 timer. Nothing in an unattended trigger can carry out a verification step. An implementer must either ignore this sentence or invent a gate, such as refusing to start or requiring an operator flag, that blocks the schedule after any Phase 1–3 failure.

Recommendation: replace the sentence with the agreed behavior, for example:

> Leave the old run incomplete. Phases 1–3 are safe to repeat: clearing is idempotent, each attempt creates a new backup before deletion, and deletion only removes rows that are still eligible. The next trigger starts a new run at phase 1 without an outcome check. The operator may inspect the old run's recorded error and artifacts, but this is not required before replacement work.

If the operator does want a gate after an uncertain *Phase 3* outcome specifically, the PRD should say so and say how an unattended trigger behaves when that gate is active, for example by refusing with a logged reason. That would be a new decision, not the current one.

## Non-blocking notes

- **"Past phase 3" needs one sentence of definition.** The scheduling table has the row "Incomplete, past phase 3", and Run completion and checkpoints says "If phase 3 completed and phase 4 has not started, the next phase is 4." Defining "past phase 3" as "phase 3 recorded as completed" in one sentence would remove the remaining ambiguity about a row whose Phase 3 started but did not complete.
- **The guard's dependency on the database should be stated.** Single execution and trigger policy, item 6, leaves the guard's implementation open, and the persistence plan chooses a PostgreSQL advisory lock. That makes the guard depend on database reachability. The PRD could note that when the database is unreachable, the trigger fails closed (rejected with a logged reason) rather than running unguarded.
