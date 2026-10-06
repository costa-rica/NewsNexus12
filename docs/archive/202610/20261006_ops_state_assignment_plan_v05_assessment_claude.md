---
created_at: 2026-10-06T16:48:42Z
updated_at: 2026-10-06T16:48:42Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Ops State Assignment Plan V05 Assessment

## Summary

V05 is a policy change on top of the implemented Phase 6. It removes the lifetime replacement cap and keeps one new job per invocation. I checked it against the implemented code:

- `runSelection.ts` already matches the stated continuation model. The 72-hour rule applies only to default selection. Explicit `--continue-run` has no age limit.
- Ordinary failed, canceled, and unavailable recovery in `06_runStateAssignment.ts` already allows another replacement on each later invocation. That holds only while no incompatible marker exists.
- The plan names the runner messages that need to be removed: "no second replacement is allowed", "already been consumed", and "ended unsuccessfully".
- An unfixed worker cannot cause unlimited AI cost. Each invocation checks the new job's status immediately and cancels an incompatible job right away.

One concern qualifies. Two existing V04 behaviors are not fully addressed, and either can still reject a valid later job.

## Concern 1: V04 replacement identity can still block a valid job

Criteria: the plan poses a risk to existing functionality; Phase 6 could reject a valid completed job.

### 1a. The V04 marker cannot tell which job it describes

The plan says to normalize a V04 marker into attempt history and "preserve both identities ... when sufficient validated data exists." But the implemented runner writes the replacement's observations into the same singular marker:

- When the replacement is incompatible, `recordPhaseSixProgress` writes `markerInput(contractMarker, { lastStatus: job.status, missingParameterFields })` using the replacement's status.
- `cancelIncompatibleJob` writes the replacement's cancellation time, outcome, and verification into that same marker.

So in a V04 marker, `lastStatus`, `missingParameterFields`, and the cancellation fields may describe the replacement and not the source. `replacementJobId` only records that a job was started. It does not record whether that job lacked the contract.

If normalization adds the replacement to `incompatibleContractRecovery.attempts`, a compatible replacement is now recorded as incompatible. Phase 6 completion must then reject it. The planned rule is to reject "a job recorded as incompatible". A legacy run whose replacement is healthy or already completed could then never complete Phase 6.

### 1b. The existing completion check is not on the removal list

`recordPhaseSixCompleted` in `sequelizePersistence.ts` (and the in-memory version in `persistenceTestSupport.ts`) currently refuses any completion when `replacementJobId` is set and does not equal the completing job. The plan lists the completion checks to keep, but not this check to remove.

Under V05, this sequence becomes normal:

1. Incompatible job A.
2. Compatible replacement B fails, for example with `worker_restart`.
3. Ordinary replacement C completes.

If the old check survives, or is rewritten as a match against the new `latestAttemptJobId`, C's valid completion is rejected. The plan does not say what `latestAttemptJobId` is for, which makes that rewrite more likely.

Recommendation:

- When normalizing a V04 marker, create an attempt only for the source job, identified by `sourceJobId` and `sourceJobCreatedAt`. Keep the source's missing fields, status, and cancellation details only if the marker has no `replacementJobId`. Otherwise record them as of unknown attribution or leave them out.
- Do not create an attempt for the V04 `replacementJobId`. It is already the saved `stateAssignerJobId`, so the next status lookup classifies it as compatible or incompatible, and only an incompatible result adds an attempt.
- Remove the `replacementJobId` completion check from both persistence implementations. Define `latestAttemptJobId` as audit-only, or drop it, and say that completion never compares against it.
- Identify incompatible attempts by `jobId` plus `jobCreatedAt`, for removing duplicates and for rejecting completion, as the monitoring marker does. This keeps a reused job ID from being mistaken for an older attempt.
- Add tests for:
  - a legacy marker with a compatible replacement that completes;
  - incompatible A, failed compatible B, then completed C.
- If no incomplete development or production run holds a V04 marker, the operator may choose to skip legacy normalization and treat any V04 marker as an invalid run state. That removes this risk entirely.

## Non-blocking notes

- Without a cap, the systemd unit added later must not use `Restart=on-failure` or a similar setting. Otherwise the process restarts itself after every nonzero exit, which this plan forbids. A one-line warning in `ops/AGENTS.md` would protect that.
- The plan says a continuation-start operation records "the continuation start time and reason." It does not say whether ordinary replacements also use it, or whether they still save their job ID through `recordPhaseSixProgress`. Either works. Choosing one makes the audit record consistent.
