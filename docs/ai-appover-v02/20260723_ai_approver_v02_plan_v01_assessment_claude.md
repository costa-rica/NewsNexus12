---
created_at: 2026-07-23
created_by: claude (claude-fable-5)
---

# AI Approver V02 Plan V01 Assessment (claude)

## Scope of this assessment

This assessment reviews 20260723_ai_approver_v02_plan_v01.md against the accepted PRD (prd_v02) and the codebase, per the plan-and-vet criteria.

Verified against the repository before writing:

- db-models uses the postgres dialect, so the advisory lock (7.4) and partial unique indexes (6.1) are feasible.
- api/src/routes/newsOrgs/automations.ts and analysis/ai-approver.ts exist and are mounted at the prefixes the plan reuses.
- The portal is Next.js 16 App Router, so the notFound() layout approach for the V01 prompt page (10.6) works.
- worker-python already writes directly to Postgres via psycopg, matching the V02 repository design.

The plan is feasible and well aligned with the PRD. Two moderate concerns follow.

## Qualifying concerns

### 1. Draft runs pollute run history and metrics

Section 6.2 adds an internal draft status to AiApproverRunsV02, and 7.3 marks expired drafts as failed with endingReason preview_expired.

- A preview that the operator abandons (closes the modal, never confirms) creates a draft row that nothing ever touches again. It stays draft forever; the expiry marking only happens on later preview or start calls.
- Reusing failed for expired previews makes a run that never executed indistinguishable at status level from a run that crashed. PRD section 21 tracks failure counts; PRD 8.4 shows the latest run. An operator could see a failed run that was only an abandoned preview.
- Every reader of the runs table (latest-run status, history, success measures, active-run enforcement) must know to exclude drafts, but the plan states no exclusion rule.

Suggested fix: give abandoned previews their own terminal status (for example expired), define that latest-run and metrics queries exclude draft and expired rows, and add a cleanup rule (sweep or reuse-on-next-preview) so drafts do not accumulate. PRD 12.3 says statuses are "at least" the listed six, so an added status is compliant.

#### Planner response

### 2. Snapshot contract is ambiguous at execution time

Section 8.5 step 2 says the runner will "load the frozen selection data or current article data required by the snapshot contract," but the plan never defines that contract. Section 6.2 stores only article IDs and selection metadata.

- Unclear whether the runner re-resolves the latest content row at execution or must use the row the preview evaluated. If content rows change between preview and execution, the stored contentSource and the content actually sent to the model can diverge.
- Unclear what happens when an article's content becomes unusable between preview and execution (skip, fail, or fall back to description if enabled).

Define the contract: either snapshot the chosen content row IDs at preview time, or state that execution re-resolves content under the run's options and skips articles that no longer qualify, counting them as skipped.

#### Planner response

## Minor observations (below threshold)

1. Section 6.5 claims the installer will "detect already-existing compatible tables" and "fail on incompatible partial schema," but model.sync() alone cannot do this; it needs explicit describeTable-style checks. Implementable, just name the mechanism in the todo.
2. Section 9.1 extends the /automations namespace currently owned by newsOrgs/automations.ts; mounting a new ai-approver-v02 route file at /automations/ai-approver-v02 in app.ts is cleaner than editing the newsOrgs file, and matches the /automations/orchestrator precedent.
3. Marking expired drafts failed happens in both preview and start paths; if concern 1 is adopted, consolidate that transition in one repository operation.
