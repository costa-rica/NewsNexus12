---
created_at: 2026-08-29T21:25:05Z
updated_at: 2026-08-29T21:25:05Z
created_by: claude (opus-5) nicksmacbookair
modified_by: claude (opus-5) nicksmacbookair
---

# Assessment of Legacy Orchestrator and AI Approver V01 Removal PRD V02

Assessed document: `docs/ai-appover-v02/20260829_legacy_orchestrator_and_ai_approver_v01_removal_prd_v02.md`

Assessing agent: claude

Repository evidence reviewed: 2026-08-29, branch `dev_29_remove_v01_workflows`

## Summary

The PRD is accurate on the points I could verify in code. The ZIP importer does rebuild the schema and does report CSV files missing from `MODEL_LOAD_ORDER` as skipped, so section 3 is correct. The V01 and V02 worker-python configurations do not share required environment keys, so section 11 is safe.

Six concerns still meet the assessment threshold. Five are ambiguities that would send an implementing agent in materially different directions. One is a conflict with another active PRD that only the operator can resolve.

## 1. The PRD contradicts the active weekly cron PRD

`docs/20260829_weekly_article_processing_cron_prd.md` was created the same day, about an hour earlier, and is not marked superseded.

That document builds its entire design on the assets this PRD deletes:

- Line 43: the existing worker-node orchestrator "should be enhanced rather than replaced".
- Line 85: the weekly cohort is defined as `NewsApiRequests.orchestratorRunId` equal to the active run ID.
- Line 141: it uses "existing orchestrator tables and queue stores for durable application state".
- Lines 218, 246, 348: it extends the semantic scorer and V02 selection with an `orchestratorRunId` selector, and proposes a new `OrchestratorRunArticle` table.
- Line 357: it requires historical `OrchestratorRuns` rows with the V01 `ai_approver` step to stay readable.

This PRD lists only the first V01 removal PRD under "Supersedes", and its non-goals say only that no replacement scheduler will be built here. It never states what happens to the weekly cron design.

Why this meets the threshold: an implementing agent cannot tell whether it is deleting dead code or deleting the foundation of the next approved feature. The two documents cannot both be implemented as written.

Recommendation: state explicitly in section 1 that the weekly cron PRD must be re-planned without `OrchestratorRuns`, `OrchestratorRunSteps`, and `orchestratorRunId`, or defer this removal until that PRD is rewritten. The operator should confirm which document wins before Phase 2 begins.

## 2. The removal boundary omits the deployment assets in `scripts/`

Section 7 does not mention these tracked files, and none of them belong to the categories section 16.1 allows to survive:

- `scripts/newsnexus12-worker-node-orchestrator-weekly.service`
- `scripts/newsnexus12-worker-node-orchestrator-weekly.timer`
- `scripts/newsnexus12-worker-node-orchestrator-test.service`
- `scripts/trigger-worker-node-orchestrator-weekly.sh`
- `scripts/trigger-worker-node-orchestrator-test.sh`
- `scripts/schema/20260623_weekly_continuation_phase2.sql`
- `scripts/README.md`

Concrete risks:

- The trigger scripts POST to `/orchestrator/start` with `--fail-with-body`. If the timer is installed on the production VM, every Friday at noon becomes a failing systemd unit after deployment.
- `scripts/README.md` still instructs the operator to install and enable that timer.
- The SQL file recreates `OrchestratorRuns.sourceOrchestratorRunId` and `NewsApiRequests.orchestratorRunId`. Running it after the removal would partially restore the schema this PRD deletes.

Why this meets the threshold: section 16.1's static check fails as written, and the omission risks live production automation. It is also the practical answer to the Phase 1 log review, since these scripts are a known caller of the removed route.

Recommendation: add a scripts and deployment subsection to section 7 naming each file and its disposition. Deleting, archiving under `scripts/archive/`, or retaining for the future cron PRD are all defensible, but the PRD must choose.

## 3. Ownership of the Google RSS resume planner is undefined

Section 10.2 says to remove `sourceOrchestratorRunId` from resume plans while preserving "retained resume behavior". Section 10.3 says to update resume-planner tests. Neither says whether the module survives.

Evidence:

- `worker-node/src/modules/google-rss/resumePlanner.ts` requires `sourceRunId`, `sourceStartedAt`, and `sourceEndedAt`, all of which come from an `OrchestratorRun` row.
- Its candidate query filters on `orchestratorRunId` at lines 160 to 164, a column this PRD deletes.
- Its only production caller is `worker-node/src/modules/orchestrator/continuationAssessment.ts`, which section 10.1 deletes.
- The route contract in `worker-node/src/routes/requestGoogleRss.ts` also accepts `googleRssResumePlan.continuationRunId`, and the legacy coordinator is its only producer.

Why this meets the threshold: one implementer deletes the planner and the whole `googleRssResumePlan` request contract; another keeps both minus the orchestrator field. The second outcome leaves unreachable code that still names a deleted concept, which conflicts with goal 3 and the section 16.1 static check.

Recommendation: name `resumePlanner.ts` and each `googleRssResumePlan` body field in section 10.2 as either deleted or retained. If any retained resume path is meant to survive, identify its caller.

## 4. A startup dependency on the legacy tables is not in the removal list

`worker-node/src/modules/db/ensureDbReady.ts` lists `OrchestratorRuns` and `OrchestratorRunSteps` in `REQUIRED_TABLES`. After the rebuilt schema drops those tables, `ensureSchemaReady` throws and worker-node refuses to serve any retained job.

Section 10.1 removes "startup reconciliation and cache invalidation", which does not obviously cover this file. Section 10.3 only asks the implementer to verify startup afterwards, so the failure surfaces late, and the section 16.2 build and unit tests will not catch a runtime schema check.

The same file's `REBUILD_INSTRUCTIONS` string tells the operator to drop and recreate the schema before `--zip_file`, which contradicts section 13.2.

Recommendation: name this file and both edits in section 10.1.

## 5. The Phase 1 exit criterion cannot be met in Phase 1

Phase 1 adds the old-backup ZIP compatibility tests, and its exit criterion is that the old-backup fixture "imports as required". Section 12.3 defines the required result as the four legacy CSV files being reported as skipped.

In Phase 1 the four models and their `MODEL_LOAD_ORDER` entries still exist, so those CSV files import normally. The skip assertion can only pass after Phase 2 removes the models.

Why this meets the threshold: the implementing agent is told to satisfy an exit criterion that the current code makes unsatisfiable, and may respond by weakening the test or by reordering the phases without saying so.

Recommendation: split the item. Phase 1 builds the fixture and asserts current behavior; the skip and `NewsApiRequest` column assertions become a Phase 2 exit criterion after the model cleanup.

## 6. The endpoint retirement decision has no owner and no deadline

Section 9.2 makes the response depend on production access logs, but section 1 states that this PRD does not authorize production deployment, and the branch is local. The evidence needed for the decision is unlikely to be available where the work happens.

The `410 Gone` path is also underspecified. There is no window length, no owner for the later removal, and no place the sunset is recorded. Section 16.1 defers its static check to "after the selected sunset behavior ends", so the acceptance criteria cannot be closed inside this project if that path is chosen.

Recommendation: default to `404` and say so plainly. If the operator wants the `410` option kept, define the window in days, name who removes it, and move that step out of this PRD's acceptance criteria. Note that the only caller identified in the repository is internal, in `scripts/` per concern 2, and the API routes are authenticated.

## Minor, non-blocking

These do not require a v03 on their own.

- Section 14 says to move historical V01 reports into "the applicable `docs/archive/YYYYMM/` folder" without saying whether the month is the report's creation month or the archival month. The root `AGENTS.md` also notes archiving is usually an operator task.
- Section 2 item 9 and section 14 gate a terminology document on a "severe critical-error risk" with no definition and no decider. As written, the implementing agent will simply skip it, which appears to be the intent.

## Suggested disposition

Concerns 1 through 6 warrant a v03. Concern 1 needs an operator decision before the rewrite, since it changes whether this removal proceeds at all.
