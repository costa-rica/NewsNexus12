---
created_at: 2026-10-01T20:18:39Z
updated_at: 2026-10-01T20:18:39Z
created_by: codex (gpt-6) nicksmacbookair
modified_by: codex (gpt-6) nicksmacbookair
---

# Weekly Combined Flow PRD V03

## Purpose

Build a weekly article-processing flow in `ops/` that the operator can understand, run by phase, diagnose, and recover. It will run on the Ubuntu 24.04.5 LTS development and production servers. A systemd `.timer` and `.service` will launch a source-controlled TypeScript coordinator.

The operator will review the coordinator, each module, its OS commands or API calls, monitoring method, completion criteria, and logs with the coding agent before implementation. The technical project overview supplies broader architecture. This version incorporates the operator's responses in V02 and the later decision to reuse one article count.

## Decisions

1. Keep the coordinator and independently runnable phase modules in `ops/`, using TypeScript so they can join the Node workspace.
2. Store durable run and phase progress in PostgreSQL. Prefer one new table, tentatively `WeeklyArticleFlowRuns02`, without changing existing tables for flow metadata. Do not restore the legacy `WeeklyArticleFlowRuns` CSV into it.
3. Use `docs/weekly-article-flow-v01/` only for warnings about permissions, ownership, service hardening, and configuration. Its design is not a basis for the new flow.
4. If RSS adds zero articles, record that outcome and stop before semantic scoring.
5. Do not save a list of RSS article IDs. Capture only the first Article ID inserted by this RSS run, then calculate one post-RSS article count. Save that count and pass it unchanged to state assignment and AI Approver V02.
6. Semantic scoring works through its existing unscored-article backlog. It receives neither the RSS count nor an RSS article-ID range.
7. The count is a practical recent-article window, not a promise that every processed article came from this RSS run. Eligible older articles within the selected work may also be useful; occasional missed RSS articles are accepted.

## Required phase order

1. Clear rows from `ArticleDuplicateAnalyses` while preserving the table and schema.
2. Create a database backup with db-manager's `--create_backup`. Record its outcome and location before proceeding.
3. Delete old articles using db-manager's default `--delete_articles` behavior.
4. Run worker-node Google News RSS collection. Record its added count, first newly inserted Article ID, query progress, and terminal outcome. If it added articles, query `COUNT(*)` from `Articles` where `id >= firstRssArticleId`; save the result as `articleCount` once. If the RSS added count is zero, stop.
5. Start worker-node semantic scoring with its ordinary untargeted behavior, which selects articles lacking a semantic-scorer result. Monitor and record its job outcome.
6. Start worker-node AI state assignment with `targetArticleStateReviewCount = articleCount` and an operator-reviewed `targetArticleThresholdDaysOld`. Monitor and record selected, completed, skipped, and failed work. The count is a selection limit, not a guarantee of that many successful assignments.
7. Use the same stored `articleCount` as AI Approver V02's `requestedArticleCount`, with `selectionMode = article_position_count`, description fallback enabled, and scanning past the approved boundary enabled. Preview, start, monitor, and record the result. Do not reduce or recalculate the count after state assignment.

AI Approver V02 selects the newest `articleCount` Article positions, then filters for a valid state assignment and its other eligibility rules. It may process fewer articles than requested. An article without a valid state assignment is skipped; a previously eligible article in the window may be processed even if this RSS run did not add it. A preview reporting no eligible articles is a logged zero-work outcome for the coordinator.

The RSS job currently returns `articlesAddedCount` but not the first inserted Article ID. Implementation must add a reliable way to report or recover that single ID before the coordinator can calculate `articleCount`. Record the RSS-added count separately from `articleCount`, since other inserts can make them differ.

## Coordination and recovery

1. Define each module's inputs, start call or command, job ID, status source, polling or other monitoring method, timeout, cancellation behavior, outputs, and safe repeat behavior. Persist the phase start before invoking work and its verified outcome before advancing.
2. Record run ID, phase statuses and timestamps, job IDs, first RSS Article ID, both counts, RSS query references, backup location, and actionable errors. Correlate structured coordinator logs with worker records and journald. Never log secret values.
3. If the flow stops during phases 1–3, a new attempt starts at phase 1. Before replaying destructive work, verify any uncertain backup or deletion outcome. Do not silently start duplicate jobs.
4. If phase 4 stops, use `NewsApiRequests` and saved run progress to identify completed RSS queries and restart safely. The exact query identity and replay procedure need operator review.
5. For later phases, inspect durable status and worker results before retrying or advancing. A completed queue job does not imply every article succeeded. Preserve partial failures for review.
6. Prevent concurrent manual and scheduled invocations from advancing the same run. Keep systemd units thin and review runtime user, working directory, permissions, environment paths, and log destinations with the operator.

## Schedule and verification

- Schedule Friday at 05:00 in `America/Los_Angeles`, using `OnCalendar=Fri *-*-* 05:00:00 America/Los_Angeles` in the timer.
- Verify phase order, backup result, count capture and reuse, zero-article stop, interrupted recovery, partial worker outcomes, and duplicate-start handling during a manual development run.
- Review the installed development service, timer, permissions, and logs. The operator reviews the scripts, database change, and systemd configuration and verifies a manual production run before relying on the production timer.

## Open Questions

### 1. RSS query recovery

Which `NewsApiRequests` fields will identify queries completed by this run after an interrupted RSS phase, and how will the restart avoid repeating them?

#### Operator Response
The coordinator will record the id from the first qeury recorded in `NewsApiRequests` in its `WeeklyArticleFlowRuns02` table and the first articleId. The RSS will run with its usual default of not repeating exact queries within a certain window. 

If the RSS decides to repeat a query becuase the query was so long since the first start happened. Then that is fine. The weekly flow will continue and the number of articles will still be calcuated based on the fist artilceId added. 

### 2. Partial worker outcomes

When semantic scoring, state assignment, or AI Approver V02 finishes with article-level failures, which outcomes allow the coordinator to advance, and which require a retry or operator review?

#### Operator Response
Let's address those wehn we start buildign the module. The coding will be implemented using inside out principals. We'll build a very light weight coordinator to trigger the first phase module and then build out from there. these artilce-level faliures will be discussed and handled during impelemntation of hte module.

The "first iteration" will not handle any failture cases. It will simpley trigger the start of a phase module and log that it started.


### 3. Timer overlap

If Friday's timer fires while a previous run remains incomplete, should it skip the new run, alert the operator, or take another action?

#### Operator Response

If a previous run remains incomplete and the run has been stale for longer than the default RSS query retry window then it should restart. Otherwise, it should fail loudly. Let's building options (arguments in the cli trigger) for the coordinator to contine an incomplete run, which includes the run id or default last run that is incomplete. And an option to run a new run when an incomplete run exists within the RSS re-query window.