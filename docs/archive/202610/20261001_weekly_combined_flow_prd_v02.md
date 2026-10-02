---
created_at: 2026-10-01T16:54:15Z
updated_at: 2026-10-01T16:54:15Z
created_by: codex (gpt-6) nicksmacbookair
modified_by: codex (gpt-6) nicksmacbookair
---

# Weekly Combined Flow PRD V02

## Purpose

Build a weekly article-processing flow in `ops/` that the operator can understand, run by phase, diagnose, and resume. It will run on the Ubuntu 24.04.5 LTS development and production servers. Installed systemd `.timer` and `.service` units will start the source-controlled flow.

This PRD incorporates the operator's answers in `docs/20260930_weekly_combined_flow_prd_light_v01.md`. The operator will work closely with the coding agent on the coordinator and each phase before implementation. The NewsNexus12 technical project overview supplies the broader architecture.

## Decisions already made

1. Use TypeScript for the coordinator and phase modules so they can join the Node workspace.
2. Store durable run and phase progress in PostgreSQL so an interrupted run can be inspected and resumed.
3. Prefer one new table, tentatively `WeeklyArticleFlowRuns02`. Do not reuse `WeeklyArticleFlowRuns`; backups may contain a CSV for that removed table, and the old CSV must not populate the new run state.
4. New tables may reference existing records. Avoid changing existing tables to carry flow metadata; any proposed exception needs explicit operator review.
5. If Google News RSS collection adds zero articles, stop the run. Record the result and do not start semantic scoring.
6. Use `docs/weekly-article-flow-v01/` only for operational warnings about permissions, ownership, service hardening, and configuration. Do not use its architecture or implementation as the design for this flow.

## Required phase order

1. Clear rows from `ArticleDuplicateAnalyses` while preserving the table and schema.
2. Create a database backup using db-manager's `--create_backup` command. Record the backup outcome and location before proceeding.
3. Delete old articles using db-manager's default `--delete_articles` behavior.
4. Run worker-node Google News RSS collection. Record the number of articles added and the identity of the collected cohort. Stop if the added count is zero.
5. Run worker-node semantic scoring for the phase 4 cohort.
6. Run worker-node AI state assignment for at least the number of articles collected in phase 4. Record how many cohort articles were selected, completed, skipped, or failed.
7. Run worker-python AI Approver V02 for every eligible phase 4 article. Enable description fallback and scanning beyond the approved boundary. Record eligibility and prediction outcomes.

The coordinator starts a phase only after the previous phase reaches an operator-approved terminal outcome. Queue completion alone does not prove that the phase met its article-level goal. A partial result, timeout, cancellation, or failed item must remain visible in the run record and logs.

## Modules and operator review

1. Keep each phase independently runnable for development checks. Define its inputs, command or API call, output, and safe repeat behavior before adding it to the coordinator.
2. For queued work, document the exact start call, job identifier, status source, polling or other monitoring method, timeout, and cancellation behavior.
3. Review OS commands, working directories, service users, permissions, environment-file paths, and log destinations with the operator. Never put secret values in source, logs, or the PRD.
4. Implement the coordinator in small, reviewable steps. The operator should be able to explain how each phase starts, reaches completion, stops, and resumes before the next phase is added.
5. Keep the systemd units thin. They should invoke the source-controlled coordinator, use the agreed runtime identity and environment, and expose service output through journald.

## Durable progress and recovery

- The new PostgreSQL run record must identify the run, current phase, per-phase status and timestamps, job IDs, article counts, cohort identity, relevant output references, and actionable failure details. The final schema remains subject to operator review.
- Persist a phase's start before invoking external work and persist its verified outcome before advancing. After a crash or deliberate stop, the operator must be able to see whether work was never started, is still running, completed, or has an uncertain outcome.
- Resume from recorded state without silently repeating destructive database work or starting duplicate jobs. An uncertain backup, deletion, or worker result requires verification before replay.
- Prevent two scheduled or manual invocations from advancing the same run concurrently. Define what a new timer trigger does while an earlier run remains incomplete.
- Keep the old `WeeklyArticleFlowRuns` CSV from matching or populating `WeeklyArticleFlowRuns02` during backup restore. Verify this in a restore test before production use.

## Cohort and existing interface gaps

The collected count alone cannot prove which articles later phases processed. The coordinator must save a stable cohort definition and verify each phase's coverage against it. The operator and agent will review whether this uses exact article IDs, a bounded database query, or another auditable method.

- The current RSS job result reports `articlesAddedCount` but no article-ID list (`worker-node/src/modules/jobs/requestGoogleRssJob.ts`).
- Semantic scoring currently accepts article-ID bounds, not an explicit ID list (`worker-node/src/routes/semanticScorer.ts`).
- State assignment accepts article IDs, while AI Approver V02 preview currently selects by position or approval boundary (`worker-node/src/modules/articleTargeting.ts`, `worker-python/src/routes/ai_approver_v02.py`).

Any new targeting or result fields should be small, documented changes to the relevant modules. Do not infer cohort coverage from a successful HTTP response, completed queue job, or count alone.

## Logging and verification

- Emit readable, structured logs with run ID, phase, timestamps, job ID, status, counts, and actionable errors. Correlate coordinator logs with worker job records and journald.
- A manual development run must prove phase order, backup verification, cohort continuity, failure handling, and restart behavior. Test zero-article RSS, interrupted execution, and attempted duplicate starts.
- Review the installed development `.timer` and `.service` configuration, runtime permissions, and logs before enabling a production timer.
- Production rollout requires the operator to review the scripts, database change, and systemd configuration, then verify a manual production run before relying on the schedule.

## Open Questions

### 1. Exact cohort handoff

How should RSS return or identify the exact articles it added, and what minimal targeting changes are needed so semantic scoring and AI Approver V02 cover that cohort?

#### Operator Response
The coordinator will capture the first article added by the RSS in the run. When the RSS flow is completed the coordinator will query the db for all articles with the artilceId equal to or greater in value than the first article added. That will be used as the artilce count to get passed to the state assigner and ai approver v02 flows. The semantic scorer will score all articles not yet scored. It won't need a count.

The coordinator (or any phases of this new feature) will not capture the articleIds from the RSS flow - excpet the first one.


### 2. Partial phase outcomes

For semantic scoring, state assignment, and AI Approver V02, which skipped or failed article outcomes may advance the run, and which require a retry or operator review?

#### Operator Response
Semantic scoring doesn't need to be so targeted. It should just score any articles not scored. I beleive the existing flow for this accomplishes this on its own.

The AI Approver V02 is dependent on the state assignment. If an article does not get a state assignment then it will not get analzyed by AI Approver V02 - I htink this is already built into the AI Approver V02 (an agent should check this). If this is in fact the case, then the coordinator can just reduce the count of articles captured by the Google RSS process to a new lower number. Then when the AI Approver V02 is triggered it will skip the articles without a state assignment on its own but work backwards as desigined and analzye the articles that are elidgible.


### 3. Resume authority

After a crash or manual stop, should the coordinator resume verified non-destructive phases automatically, or require the operator to approve every restart?

#### Operator Response
If the weekly flow is stopped for whatever reason between phases 1-3. Then we won't "continue" we'll only have restart from the beginning. If there is any stop durign phase 4. This should be easy to restart because we'll know which queries were made adn we can check against the NewsApiRequests table 

### 4. Schedule and overlap

What weekly day, time, and timezone should the timer use, and what should happen when it fires while a prior run is incomplete?

#### Operator Response
If this is in reference to the system files that will trigger the weekly flow I think we can use `OnCalendar=Fri *-*-* 05:00:00 America/Los_Angeles`. We want it to start 5am on Friday according to America/Los_Angeles time.