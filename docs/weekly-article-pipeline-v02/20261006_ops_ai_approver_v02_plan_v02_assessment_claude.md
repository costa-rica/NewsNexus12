---
created_at: 2026-10-06T18:00:00Z
updated_at: 2026-10-06T18:00:00Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Ops AI Approver V02 Plan V02 Assessment

## Summary

V02 resolves both V01 concerns:

- **Unlimited continuation.** The plan now allows unlimited continuation invocations, starts at most one job per invocation, and keeps attempt history keyed by `v02RunId`. It removes `replacementConsumed`, the replacement-exhausted error, and the third-attempt ban.
- **404 handling.** A 404 is now split by whether acceptance was observed. A pre-acceptance 404 is continuation-eligible. A post-acceptance 404 stops.

All the non-blocking notes from V01 are also incorporated.

One new concern qualifies. It comes from combining two V02 rules:

- the preview is persisted before start;
- a single `aiApproverV02JobId` column holds the current job ID.

Together these can stop a weekly run permanently.

## Concern 1: A stale `aiApproverV02JobId` blocks recovery of a continuation attempt

Criteria: the plan will not work for start ambiguity on any attempt after the first. The run is then stuck until an operator repairs it by hand.

The plan contains these rules:

- "The existing `aiApproverV02JobId` column identifies the current queue job."
- The continuation operation appends the new preview attempt and makes it current. It preserves prior attempts, but nothing says it clears or replaces `aiApproverV02JobId`.
- Detail validation rule 6: "A present V02 `jobId` matches the attempt and `aiApproverV02JobId`."
- Start-ambiguity step 2: "Adopt a valid attached job ID when the weekly row lacks it."
- Zero work: "Leave `aiApproverV02JobId` null when no earlier attempt supplied a job ID." This implies the column keeps a prior attempt's job ID.

Failing sequence:

1. Attempt A (V02 run 41) starts as job `0007`. The weekly row stores `aiApproverV02JobId = '0007'`. The run ends `failed`.
2. A later invocation persists continuation attempt B (V02 run 42) as current. `aiApproverV02JobId` is still `'0007'`.
3. The start request for B times out after the worker accepted it and attached job `0008`. The invocation stops, as the plan requires.
4. The next continuation queries run 42 and sees `jobId = '0008'`.
   - The weekly row does not "lack" a job ID, so step 2 does not adopt `0008`.
   - Detail rule 6 compares `0008` with `aiApproverV02JobId = '0007'`, so the response is treated as malformed and the run is classified as an identity mismatch.
5. The plan says malformed or mismatched state "cannot complete the weekly run or authorize another attempt." Every later invocation repeats step 4. Phase 7 can never finish, even when run 42 completes successfully.

The same stale value causes a second problem. Even without a timeout, any validation between B's preview persistence and B's start compares B against job `0007`.

Phase 6 does not have this problem. `stateAssignerJobId` is written at the moment a replacement starts, and there is no persisted pre-start state.

Recommendation (choose one and state it in the plan):

- **Preferred:** The atomic continuation operation clears `aiApproverV02JobId` to null when it makes a new attempt current. The prior job ID survives in that attempt's history entry. Adoption then works through the existing "weekly row lacks it" rule.
- **Alternative:** Treat the attempt's own `jobId` as authoritative for validation. Write `aiApproverV02JobId` only as a mirror of the current attempt's job. Allow adoption whenever the column is null or equals a job ID recorded on a non-current attempt.

Also:

- Update the zero-work rule to match the chosen option. With the preferred option, `aiApproverV02JobId` is null at zero-work completion after prior attempts, and `zeroWorkAfterPriorAttempts` plus attempt history carry that audit.
- Require the successful-completion operation to confirm that `aiApproverV02JobId`, the current attempt's `jobId`, and `currentV02RunId` all describe the completing run.
- Add a phase test for: attempt A fails, continuation attempt B's start is ambiguous, and the next invocation adopts B's job ID and completes.

## Non-blocking notes

1. **Clock source for chronology checks.** Detail rule 7 rejects a V02 run created before "the original Phase 7 start". The V02 `createdAt` comes from PostgreSQL's `CURRENT_TIMESTAMP`. Phase 7 `startedAt` is presumably the ops process clock. If those clocks differ by even a second, the first attempt's preview can look older than Phase 7 start. That attempt is then classified as malformed, which the plan says cannot authorize another attempt. Either set Phase 7 `startedAt` from the database clock, or compare against the preview's own `createdAt` only. The rule "Run creation is not older than the saved preview" already guarantees the binding.
2. **Unknown queue `createdAt`.** The 12-hour limit is measured from queue `createdAt`. If an attempt's job is adopted while its queue record is already missing (for example after a queue-store reset), there is no `createdAt`. State that this case cannot be monitored for the limit. It should resolve only through the durable V02 status, or stop as unverified while the durable run is still active. It should not get an invented start time.
