---
created_at: 2026-10-04T17:07:32Z
updated_at: 2026-10-04T17:07:32Z
created_by: codex (gpt-6.1-sol) nicksmacbookair
modified_by: codex (gpt-6.1-sol) nicksmacbookair
---

# Ops RSS Collection Plan V01 Assessment

## Qualifying Concerns

### 1. New-run zero additions cannot reach completion

The coordinator flow calculates `articleCount` before applying the zero-article rule. A new run that inserts no Articles has no `firstRssArticleId`, so `COUNT(*) WHERE id >= firstRssArticleId` cannot be performed as specified. The plan also says an unverifiable count fails Phase 4, which conflicts with its required zero-work completion outcome.

Revise the flow to branch on the run-level RSS-added total after verified collection. For a genuinely zero-addition run, persist the agreed zero-work Phase 4 result and complete the run without requiring a first Article ID. Only calculate from `firstRssArticleId` when the run has recorded additions.

### 2. Zero-work completion has a recovery gap

The existing persistence interface records Phase 4 completion and run completion in separate writes. If Phase 4 completion succeeds and `recordRunCompleted` fails, the run is left incomplete with `lastPhaseCompleted = 4`. A later invocation can treat Phase 5 as next even though the PRD requires the run to stop after zero RSS additions.

Define either one atomic persistence operation for the zero-work Phase 4 and run-completion transition, or explicit continuation logic that recognizes this persisted state and finishes the run without starting or advancing to Phase 5. Add a test for interruption between those two state changes.

## Todo Determination

A todo is needed after the plan passes assessment because Phase 4 is a multi-step change spanning worker-node integration, persistence, coordinator behavior, configuration, documentation, and tests.
