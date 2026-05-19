---
title: Codex assessment: Google RSS tracking report TODO
date: 2026-05-19
reviewer: codex
source_document: docs/NEWS_NEXUS_12_GOOGLE_RSS_TRACKING_REPORT_TODO_20260519.md
status: assessment
---

# Codex assessment: Google RSS tracking report TODO

1. Moderate concern: several Phase 2 tests depend on spying on private helpers that are not currently exported or injected.

- The TODO asks for tests that spy on `wasRequestMadeRecently` and `storeRequestAndArticles`.
- In the current code, both helpers are module-private constants inside `worker-node/src/modules/jobs/requestGoogleRssJob.ts`.
- `RequestGoogleRssJobDependencies` only allows replacing `runLegacyWorkflow`, which bypasses the behavior under test rather than exposing those inner branches.
- An implementation agent following the TODO literally may either be blocked, over-export internals just for tests, or add a larger dependency-injection refactor that is not called out in the task list.
- Suggested adjustment: add a short testing strategy before Phase 2. Either:
  - export a deliberately small `runLegacyWorkflow` dependency seam for `fetchRssItems`, `wasRequestMadeRecently`, and `storeRequestAndArticles`, or
  - test these branches through existing public behavior by controlling global `fetch` and the db-model state, without asking for spies on private helpers.

2. Moderate concern: the non-503 RSS error test describes the wrong mock layer.

- The TODO says to "mock fetch returns `{ status: 'error', error: 'boom', statusCode: 500 }`."
- That object is the internal `fetchRssItems` return shape, not the `global.fetch` `Response` shape used by existing tests.
- If the implementation keeps testing through `global.fetch`, the correct mock is an HTTP-like response such as `ok: false`, `status: 500`, and optionally `text`.
- If the implementation introduces an injectable `fetchRssItems` seam, then the TODO should explicitly say that this test mocks the injected `fetchRssItems`, not `global.fetch`.
- Suggested adjustment: clarify which layer is being mocked so the agent does not write a test that passes the wrong object into the runtime path.

Overall: the TODO captures the desired behavior well, and V03 resolves the earlier control-flow concerns. I would tighten the testing strategy before implementation so the agent has an explicit, feasible way to verify the branch behavior without inventing a broad refactor mid-task.
