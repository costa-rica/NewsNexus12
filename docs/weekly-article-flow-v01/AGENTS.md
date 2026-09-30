---
created_at: 2026-09-30T21:20:58Z
updated_at: 2026-09-30T22:22:11Z
created_by: codex (gpt-6) nicksmacbookair
modified_by: codex (gpt-6) nicksmacbookair
---

# Weekly Article Flow V01 Preservation

## Purpose and scope

- Preserve evidence and lessons from `ops/weekly-article-flow` before the operator handles the revert.
- Keep this folder intact so the operator can copy it outside the repository and restore it afterward.
- Use these records to inform the future Weekly Combined Flow, with the operator more directly involved in its design.
- The source request is `docs/20260930_weekly_combined_flow_v01.md`. This file carries the preservation instructions so they remain available when this folder is copied separately.
- These are documentation tasks. Do not revert, reset, select a rollback commit, create the future branch, or implement the replacement flow as part of them.
- Historical recommendations and commands in these reports are evidence, not instructions to execute changes now.

## Retained file index

Keep all four existing reports. Each contributes distinct evidence.

1. [Production run 4 failure report](20260929_weekly_article_flow_run_4_failure_report.md)
   - Records the failed semantic status poll, immediate cancellation, downstream stages not reached, and separate alert-publication failure.
   - Preserves the distinction between a failed observation and a failed scoring algorithm, plus proposed regression checks.
2. [Run 4 connection reset investigation](20260929_run_4_connection_reset_investigation.md)
   - Examines timing, global article loading, worker responsiveness, HTTP behavior, and competing explanations.
   - Separates supported observations from the unproven mechanism behind the TCP reset.
3. [Development run 4 resume reproduction](20260929_nws-nn12dev_weekly_article_flow_run_4_resume_reproduction_report.md)
   - Records interrupted-run recovery, the active-run guard, and successful semantic execution without reproducing the production reset.
   - Documents global data loading, unsupported state-assigner model configuration, per-item analysis failures, empty AI Approver eligibility, and alert permissions.
4. [Production run 5 success report](20260930_weekly_article_flow_run_5_success_report.md)
   - Preserves the successful end-to-end baseline, stage counts, timings, resource usage, and measured semantic event-loop delay.
   - Explains why one success does not establish reliability or prove the cause of run 4's reset.

- `AGENTS.md` is the preservation index and server-agent handoff.
- Some reports contain former repository paths or relative links from before they were moved. Use this index to locate the retained reports; do not assume external references will survive the revert.
- Preserve original report contents and attribution. Put new conclusions and corrections in the machine-specific lessons documents, with references to the original evidence.

## Required server-agent documents

1. The agent on `nws-nn12dev` created `20260930_lessons_learned_from_v01_flow_nws-nn12dev.md` in this folder.
2. The agent on `nws-nn12prod` created `20260930_lessons_learned_from_v01_flow_nws-nn12prod.md` in this folder.

These files are retained evidence. Each agent owns its host's account and must distinguish local observations from evidence reported by the other host.

- Each lessons-learned document must contain a `## Host Inventory` section following the requirements below. Keep the inventory in that host's lessons document rather than creating a separate file.

## Server-agent workflow

1. Read the retained reports and applicable repository instructions before writing.
2. Inspect available local evidence using read-only operations: logs, run records, queue results, deployed revision, service definitions, and relevant configuration names.
3. Capture lessons while the V01 source and host evidence remain available. Do not start jobs, rerun stages, change database rows, restart services, alter schedules, or edit runtime configuration for this documentation task.
4. Write the document assigned to your host using the structure below. Record unavailable evidence explicitly instead of filling gaps with assumptions.
5. Check every factual claim against its source. Label hypotheses, recommendations, attempted fixes, and verified fixes separately.
6. Add a relative link to your completed document in the completed-lessons index below, and update this file's modification metadata.
7. Review the diff and commit and push all changes belonging to this preservation task, following the repository's commit-message guidance. Exclude unrelated working-tree changes.
8. Report the document path, commit, push outcome, and any evidence gaps to the operator. The operator will collect both hosts' documents on the Mac before copying this folder outside the repository.

## Lessons document structure

Use focused sections, bullets, and numbered steps. Keep paragraphs under 50 words and do not use bold text.

1. Host and evidence scope
   - Identify the host, inspection time in UTC, deployed/source revision when available, relevant run IDs and job IDs, and evidence sources.
   - State which conclusions come from local inspection and which come from the retained reports.
2. What worked
   - Record useful behavior worth carrying forward, with observed results and limitations.
3. Problems and causes
   - For each problem, explain the trigger, observed behavior, operator impact, confirmed cause or hypothesis, and supporting evidence.
   - Distinguish coordinator, transport, worker, per-article, configuration, and reporting failures where relevant.
4. Fixes and remaining uncertainty
   - Record what was attempted, what was actually deployed, how it was verified, and what remains unresolved.
   - Do not present recommendations in the old reports as completed fixes without evidence.
5. Requirements for the Weekly Combined Flow
   - Explain what the replacement must account for and how the operator can verify the behavior.
   - Include stage completion criteria, cohort scope, partial outcomes, interruption/recovery, diagnostics, and alert delivery where supported by experience.
   - Keep proposed design choices distinguishable from operator-approved requirements.
6. Host Inventory
   - Complete the required inventory below using read-only inspection of your own server.
   - Include concise evidence excerpts where needed so the lessons remain useful after source removal. Never include credentials, tokens, or protected environment values.
7. Open questions, if material decisions remain
   - Make this the final section and follow the repository's numbered-question and empty `Operator Response` format.

## Host inventory requirements

A Git revert changes repository content; it does not automatically undo installed services, schedules, host configuration, or database changes. Capture the current host state so the operator can plan those changes separately.

1. Services and schedules
   - List relevant installed systemd services, timers, drop-ins, alert helpers, and cron entries, including their paths and runtime users.
   - Record enabled/disabled and active/inactive state separately, plus schedules and next trigger times with timezone when available.
2. Configuration and permissions
   - List environment-file paths, relevant variable names, service working directories, runtime/model dependencies, file ownership, permissions, and relevant sudoers or service-hardening settings.
   - Record names and nonsecret operational details only; do not copy environment files or secret values into the document.
3. Files and retained evidence
   - List backup, log, journal, alert, lock, and other workflow resource locations outside the repository, with their purpose and ownership when available.
4. Database state
   - Identify workflow-specific tables, schema changes, migration records if present, and durable run records using read-only inspection.
   - Distinguish V01 additions from pre-existing shared structures when evidence permits. Document known data effects, such as cleanup or ingestion, that reverting code would not reverse.
5. Operator disposition
   - For each item or related group, record its evidence source, observation time in UTC, whether it is shared or V01-specific, and whether it survives a Git revert.
   - Recommend retaining, disabling, removing, or reviewing it, with a short reason. Mark uncertain ownership or impact as needing review.
   - These are recommendations for the operator, not authorization to change host state. Do not disable timers, remove files, or modify database structures during inventory collection.

- Use a compact table or consistent bullets so the operator can compare both hosts.
- Mark each category as inspected, not applicable, or unverified, and explain missing access or evidence. Do not treat an uninspected category as empty.

## Evidence topics to address

- Both hosts: global semantic selection versus the newly collected cohort; queue completion versus business success; accepted terminal states and skip/failure counts; operator visibility into the actual failed stage.
- Development: interruption and resume behavior; why the reset was not reproduced despite global article loading; model/account compatibility; state-assignment failures and AI Approver eligibility; password-required alert publication.
- Production: run 4 polling and cancellation behavior; the limits of the reset diagnosis; service hardening and alert publication; run 5's successful baseline, event-loop delay, and limits as reliability evidence.
- Replacement flow: preserve the intended order of duplicate-analysis cleanup, database backup, old-article deletion, RSS collection, semantic scoring, state assignment, and AI Approver V02.
- The source request calls for semantic scoring of collected articles, state assignment for at least the collected count, and AI Approver V02 for all eligible collected articles with description fallback and scanning past the approved boundary. Document V01 lessons relevant to meeting those requirements.
- The source request recommends a systemd timer for production. Record scheduling lessons here; installation or activation belongs to separately authorized implementation work.

## Document metadata

- Use the exact date-prefixed, machine-specific filenames above.
- Start each generated document with YAML frontmatter containing exactly `created_at`, `updated_at`, `created_by`, and `modified_by`.
- Use UTC timestamps in `YYYY-MM-DDTHH:MM:SSZ` format.
- Use lowercase attribution in the format `agent (model) machine`, with the actual writing agent, model, and host. Do not include email addresses or angle brackets.
- Preserve `created_at` and `created_by` on later edits. Refresh `updated_at` and `modified_by` on every modification.

## Completed lessons index

- Development: [Lessons learned from nws-nn12dev](20260930_lessons_learned_from_v01_flow_nws-nn12dev.md).
- Production: [Lessons learned from nws-nn12prod](20260930_lessons_learned_from_v01_flow_nws-nn12prod.md).
