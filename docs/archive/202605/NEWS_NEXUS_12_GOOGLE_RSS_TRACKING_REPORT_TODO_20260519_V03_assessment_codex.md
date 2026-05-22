---
title: Codex assessment: Google RSS tracking report TODO V03
date: 2026-05-19
reviewer: codex
source_document: docs/NEWS_NEXUS_12_GOOGLE_RSS_TRACKING_REPORT_TODO_20260519_V03.md
status: assessment
---

# Codex assessment: Google RSS tracking report TODO V03

1. Moderate concern: the TODO asks for direct `buildQuery` unit tests while also forbidding new exports or test seams.

- The V03 TODO fixes the blank-keyword decision by making `buildQuery` return `query: ''` when no AND/OR terms are present.
- However, §2.1 asks for unit tests that call `buildQuery(...)` directly.
- In the current code, `buildQuery` is a file-private helper inside `worker-node/src/modules/jobs/requestGoogleRssJob.ts`.
- The TODO also says not to add new exports or dependency-injection seams for testing, which conflicts with direct helper-level tests.
- An implementation agent following the TODO literally may either be blocked or export a private helper against the TODO's own testing strategy.
- Suggested adjustment: test the blank-row behavior through the public job handler instead. Assert that a blank keyword row does not call `global.fetch`, records `skipped / empty_query`, creates no `NewsApiRequest`, and allows the next row to continue. For the non-empty regression, assert the URL passed to `global.fetch` or persisted in `NewsApiRequest.url` still includes `when:<timeRange>`.

Overall: V03 is otherwise close to implementation-ready. Resolving this test-scope contradiction should make the task list safe for an AI coding agent to follow without inventing a refactor.
