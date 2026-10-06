---
created_at: 2026-10-01T23:56:40Z
updated_at: 2026-10-06T17:14:10Z
created_by: codex (gpt-6) nicksmacbookair
modified_by: codex (gpt-6.1-sol) nicksmacbookair
---

# NewsNexus12 Operations

This workspace contains operational workflows for NewsNexus12. Weekly-flow-02 currently runs Phases 1–6 and stops at the Phase 7 boundary.

---

## Project Overview

Weekly-flow-02 clears duplicate analyses, creates a verified backup, deletes eligible old Articles, collects Google News RSS Articles, runs semantic scoring, and assigns states. Progress is persisted for controlled continuation.

Stack: Node.js, TypeScript, PostgreSQL, Winston, npm workspaces.

---

## Setup

Prerequisites:

- Node.js 20 or newer and npm.
- PostgreSQL with the current NewsNexus12 schema.
- Running worker-python and worker-node services for real executions.
- `flock` for the guarded Ubuntu launcher.

1. Install dependencies from the repository root:

```bash
npm install
```

2. Copy the configuration template without replacing an existing file:

```bash
if [ ! -e ops/.env ]; then
  cp ops/.env.example ops/.env
fi
```

3. Build the required workspaces:

```bash
npm run build --workspace @newsnexus/db-models
npm run build --workspace @newsnexus/db-manager
npm run build --workspace newsnexus12-ops
```

4. Run database-free verification:

```bash
npm run typecheck --workspace newsnexus12-ops
npm test --workspace newsnexus12-ops
```

- Package configuration lives in `ops/.env`; available settings and defaults are documented in `ops/.env.example`.

---

## Usage

```bash
# default: select or continue the latest run according to the recovery policy
sudo -u limited_user -H sh -c 'npm run weekly-flow-02:start --workspace newsnexus12-ops'

# options
sudo -u limited_user -H sh -c 'npm run weekly-flow-02:start --workspace newsnexus12-ops -- --new-run'
sudo -u limited_user -H sh -c 'npm run weekly-flow-02:start --workspace newsnexus12-ops -- --continue-run'
sudo -u limited_user -H sh -c 'npm run weekly-flow-02:start --workspace newsnexus12-ops -- --continue-run RUN_ID'
```

- Run commands from the repository root after building ops.
- This workflow performs real database deletion and queue work. Do not use it as a smoke test.
- `--continue-run RUN_ID` requires a positive integer ID from `WeeklyArticleFlowRuns02`.
- With no arguments, an incomplete run past Phase 3 is continued repeatedly while it remains inside the 72-hour window.
- `--continue-run` may be issued repeatedly for the latest eligible incomplete run, including after 72 hours.
- `--continue-run RUN_ID` may be issued repeatedly for that exact eligible incomplete run, including after 72 hours. Explicit continuation does not bypass completion or the Phase 1–3 replacement rules.
- Continuation eligibility is not consumed by an unsuccessful Phase 6 attempt.
- A successful positive-work run stops at the Phase 7 boundary and remains incomplete for the later phases.
- Logs use the directory configured in `ops/.env`; durable progress is stored in `WeeklyArticleFlowRuns02`.
- Phase 5 can monitor semantic scoring for up to six hours before exiting nonzero for operator review.
- Phase 6 can monitor state assignment for up to 12 hours before marking and canceling the job, then exiting nonzero.

---

## Phase 6 State Assignment

Production policy:

- `STATE_ASSIGNER_TARGET_ARTICLE_THRESHOLD_DAYS_OLD=180` is required.
- `STATE_ASSIGNER_STATUS_POLL_INTERVAL_SECONDS=300` defaults to five minutes.
- `STATE_ASSIGNER_TOLERATED_CONSECUTIVE_STATUS_FAILURES=2` allows two transient failures and stops on the third.
- `STATE_ASSIGNER_MONITORING_LIMIT_HOURS=12` limits one coordinator invocation.
- Worker requests use the shared `WORKER_NODE_REQUEST_TIMEOUT_SECONDS` setting.

The coordinator starts worker-node with exactly:

```json
{
  "targetArticleThresholdDaysOld": 180,
  "targetArticleStateReviewCount": 123
}
```

- The example count represents the immutable Phase 4 `articleCount` for that run.
- The actual persisted count is used without recalculation or reduction.
- Phase 6 never sends Article IDs, ID ranges, prompt text, content, AI keys, or filesystem paths.
- Phase 6 does not overwrite `articleCount`. Phase 7 receives the same position-window count.

The worker result contains `selectedCount`, `completedCount`, `skippedCount`, and `failedCount`.

- `completedCount` counts state contracts persisted successfully.
- `skippedCount` counts per-Article AI timeouts.
- `failedCount` counts per-Article analysis or persistence failures.
- The counts must add up to `selectedCount`.
- A valid completed job may select zero Articles or contain nonzero skipped and failed counts.

Monitoring behavior:

1. Poll immediately after saving the job ID.
2. Poll serially every five minutes after an active response.
3. Reset the transient-failure counter after every valid status response.
4. Stop immediately on permanent requests, malformed responses, or invalid result contracts.
5. At 12 hours, save a marker tied to both job ID and worker `createdAt` before requesting cancellation.
6. Exit nonzero after cancellation. Never trust a late result from the marked job.
7. On continuation, re-cancel a matching active marked job or replace it only after it is verified inactive.

Incompatible-worker recovery applies when a queue record lacks one or both required parameters.

1. Save each incompatible identity as the exact worker job ID plus its validated `createdAt`, along with the missing fields.
2. Cancel an active incompatible job and verify that it becomes inactive or unavailable.
3. End the invocation after a newly started or newly canceled incompatible job.
4. Permit a later eligible continuation after verified inactivity, regardless of how many earlier attempts are recorded.
5. Allow a compatible current job to complete unless its exact ID and `createdAt` match an incompatible or monitoring-limited record.

Phase 6 may start at most one new state-assigner job in each coordinator invocation. There is no lifetime cap on valid continuation invocations or replacement jobs.

Every replacement performs a new full newest-first selection. It does not resume only unfinished Articles.

- Existing state assignments are excluded by the worker's normal selection rule.
- Repeated attempts can spend additional AI calls.
- New Articles and earlier successful assignments can shift the newest-first selection between attempts, so a later attempt may select a different eligible set.
- This applies to monitoring-limit, incompatible-contract, and missing-saved-job recovery.
- If a continuation job starts but its ID cannot be saved atomically, the invocation stops for investigation. The worker job may be running without a durable coordinator identity.

Malformed parameters, invalid or mismatched identity timestamps, ambiguous cancellation, and other unverified worker outcomes are not replacement-eligible. Inspect the saved run, worker queue, and logs before continuing.

A failed invocation does not restart itself. Continuation requires a later timer trigger or a deliberate operator command. Any future systemd service must not use `Restart=on-failure`, `Restart=always`, or another automatic restart policy.

Use `WeeklyArticleFlowRuns02.stateAssignerJobId`, the queue record's two parameters, and coordinator logs to correlate a Phase 6 attempt. Do not infer success from a start response or an unvalidated terminal status.

Deployment order matters:

1. Build, deploy, and restart worker-node with the Phase 6 queue-parameter and result contract.
2. Confirm a state-assigner status record exposes both required parameters.
3. Confirm the 180-day threshold and 12-hour limit in `ops/.env`.
4. Build ops and run the database-free verification commands.
5. Run weekly-flow-02 only with explicit operator authorization.

---

## Project Structure

```text
ops/
├── .env.example             # Configuration template
├── AGENTS.md                # Agent implementation and recovery rules
├── README.md                # Operator setup and usage
├── scripts/
│   └── runWeeklyFlow02.sh   # Guarded Ubuntu launcher
├── src/
│   └── weekly-flow-02/      # Coordinator, persistence, and phases
└── tests/
    └── weekly-flow-02/      # Database-free workflow tests
```

---

## References

- [Weekly pipeline requirements](../docs/weekly-article-pipeline-v02/20261003_weekly_combined_flow_prd_v10.md)
- [Semantic scoring implementation plan](../docs/weekly-article-pipeline-v02/20261005_ops_semantic_scoring_plan_v03.md)
- [Semantic scoring implementation checklist](../docs/weekly-article-pipeline-v02/20261005_ops_semantic_scoring_todo_v02.md)
- [State assignment continuation plan](../docs/weekly-article-pipeline-v02/20261006_ops_state_assignment_plan_v06.md)
- [State assignment continuation checklist](../docs/weekly-article-pipeline-v02/20261006_ops_state_assignment_todo_v03.md)
- [Ops agent instructions](AGENTS.md)
