---
created_at: 2026-10-23T22:47:16Z
updated_at: 2026-10-23T22:47:16Z
created_by: hermes (gpt-6.1-sol) nws-nn12dev
modified_by: hermes (gpt-6.1-sol) nws-nn12dev
---

# Google RSS 503 Retry TODO v03 Assessment

Reviewed PRD v04 and TODO v03 against the current worker implementation, with an independent read-only Codex review. No additional PRD concerns were found. The operator-accepted testing deviations are not reopened.

## 1. Header summary waits behind body capture

- TODO lines 142–150 capture the body inside `fetchRssItems()`, but lines 169–173 emit the summary only after returning to the main loop.
- This undermines PRD line 101's requirement that key clues survive body-read problems.
- Emit the summary immediately after capturing headers, before awaiting the body. Keep the full-response entry afterward with the same correlation fields.
- Add a stalled-stream test verifying the summary exists while the body remains pending, and a timeout test verifying headers and partial body survive.

## 2. Cancellation can bypass both diagnostic entries

- TODO lines 90–95 retain cancellation checks before 503 handling. The current implementation breaks at `requestGoogleRssJob.ts:574–583` when canceled after fetching.
- Cancellation during the newly added body read can therefore return captured details and then skip the planned main-loop logs entirely.
- Emit available 503 diagnostics before taking the cancellation exit. Preserve the canceled outcome, with no retry or persistence afterward.
- Add cancellation-during-body tests for both attempts, asserting diagnostic retention and no additional fetches.

## Disposition

Implementation has not started. Resolve these TODO issues before implementation. No source code, services, production environment files, or databases were changed.
