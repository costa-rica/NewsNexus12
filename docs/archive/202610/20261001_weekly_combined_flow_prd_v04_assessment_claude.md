---
created_at: 2026-10-01T20:58:38Z
updated_at: 2026-10-01T21:21:49Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Weekly Combined Flow PRD V04 Assessment

## Scope of this assessment

- Reviewed `20261001_weekly_combined_flow_prd_v04.md` as the assessor in the plan-and-vet workflow.
- Threshold: requirement ambiguity that would block or misdirect implementation.
- Phase module details (start commands, polling, timeouts, article-level failures) were given leeway. V04 explicitly defers them to inside-out implementation with the operator.

## What checks out

These PRD references match the codebase:

- `worker-node/src/modules/logger.ts` format, environment behavior (`development`, `testing`, `production`), `NAME_APP`, `PATH_TO_LOGS`, and the workflow-start separator.
- db-manager `--create_backup` and `--delete_articles` flags exist in `db-manager/src/modules/cli.ts`.
- `DEFAULT_REQUEST_GOOGLE_RSS_REPEAT_WINDOW_HOURS = 72` and `articlesAddedCount` exist in `worker-node/src/modules/jobs/requestGoogleRssJob.ts`. The PRD correctly notes first IDs are not exposed.
- `targetArticleStateReviewCount` and `targetArticleThresholdDaysOld` exist in `worker-node/src/modules/articleTargeting.ts`.
- AI Approver V02 accepts `selectionMode = article_position_count`, `requestedArticleCount`, `allowDescriptionFallback`, and `allowPastApprovedBoundary`.
- `ArticleDuplicateAnalyses` is the table name for `ArticleDuplicateAnalysis`.
- `ops/` exists and is empty. Adding it to the root `workspaces` list is straightforward.

The terminology, inside-out increments, counting rules, and phase order are clear. Most of V04 is ready.

## Concern 1: scheduled continuation of a stale run

This is the one concern that meets the threshold. It drives core scheduler behavior and the run table design, so it is not a phase module detail.

### What V04 says

Scheduling item 2: when an incomplete run is older than the RSS repeat window, the timer continues that existing run with the same run ID. Otherwise it fails loudly.

### Why it is ambiguous

- The V03 operator response said the stale run "should restart." V04 reads this as "continue the existing run." It could also mean "start a new run."
- The timer fires every 7 days, and the window is 72 hours. So almost any incomplete run the timer finds will be older than 72 hours. Continuation becomes the normal Friday behavior after any failure.
- The outcome depends on where the old run stopped:
  - Stopped in phases 1–3: restarts from phase 1 under the old run ID. This works.
  - Stopped in phase 4: RSS resumes a week later. Nearly all queries repeat because the 72-hour window expired. `articleCount` then spans more than a week of articles from last week's first Article ID.
  - Stopped in phases 5–7: the Friday run finishes last week's work only. No new backup, deletion, or RSS collection happens that week.
- The last case means a single failure can cost a full week of collection. The operator may or may not want this.

### Related gap: run lifecycle states

The staleness rule depends on "incomplete run," but V04 does not define which run outcomes are terminal. Each of these affects what the timer and the CLI default will pick up:

- A run that stops on the zero-RSS-article rule. If it counts as incomplete, the next Friday would try to continue it.
- A V02 preview with no eligible articles. V04 calls it a zero-work outcome but not a run status.
- An older incomplete run left behind when the operator forces a new run. Without an abandoned or superseded state, the "latest incomplete run" CLI default and the timer may keep finding it.

### Suggested resolution

- State which action the stale-run rule takes: continue the old run, or close it and start a new run.
- If continuing, say whether this applies to every interrupted phase, or only to some (for example phases 1–4).
- Define a small set of run statuses. For example: running, completed, completed with zero work, failed, abandoned. State which ones count as incomplete.
- Clarify whether staleness is measured from original start time (as written) or from last recorded progress. "Stale" in the V03 response suggests last progress.

These decisions can be brief. The table columns and exact CLI arguments can still be settled during implementation.

## Minor notes (below threshold)

These do not require a new version on their own. Address them if V05 is written.

- Phase 1 clears `ArticleDuplicateAnalyses` before the phase 2 backup, so the backup never contains those rows. This is fine if they are disposable, but worth stating as intentional.
- The coordinator will likely share an `.env` layout with worker-node. Note that `NAME_APP` must differ so the coordinator log file does not collide with `worker-node`'s log file.

## Recommendation

- Write V05 that resolves Concern 1 and defines run statuses.
- No other changes are needed before implementation begins with the first increment.
- The first increment (scaffolding, logger, trigger phase 1, log the start) does not depend on Concern 1. Work on it may begin in parallel if the operator prefers.

## Open Questions

### 1. Stale run timer action

When the Friday timer finds an incomplete run older than the RSS repeat window, should it continue that run or close it and start a new run?

#### Operator Response
When triggered without arguments, the coordinator looks only at the last run in `WeeklyArticleFlowRuns02`. It does not search for older incomplete runs.

1. No previous run exists: start a new run.
2. Last run is complete (`runCompleted = true`): start a new run.
3. Last run is incomplete and stopped during phases 1–3: start a new run. Phases 1–3 are never resumed.
4. Last run is incomplete, stopped after phase 3, and started more than 72 hours ago (the RSS repeat window): start a new run.
5. Last run is incomplete, stopped after phase 3, and started within 72 hours: continue that run from the phase where it stopped, keeping its run ID.

An incomplete run replaced by a new run stays `runCompleted = false`. Because only the last run is checked, it needs no abandoned status.


### 2. Run statuses

Which run statuses count as incomplete for the timer and the CLI default? Should zero-RSS and zero-work runs count as completed?

#### Operator Response
Use a boolean column `runCompleted` in `WeeklyArticleFlowRuns02`: `false` means incomplete, `true` means complete. No other run statuses are needed.

- Zero-RSS and zero-work outcomes set `runCompleted = true`.
- The run also records the last phase reached, so the coordinator can tell whether an incomplete run stopped during phases 1–3.


### 3. Staleness reference time

Should staleness be measured from the run's original start time or from its last recorded progress?

#### Operator Response
the runs' original start time.