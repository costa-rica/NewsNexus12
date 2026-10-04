---
created_at: 2026-10-01T21:26:59Z
updated_at: 2026-10-02T00:16:54Z
created_by: codex (gpt-6) nicksmacbookair
modified_by: codex (gpt-6) nicksmacbookair
---

# Weekly Pipeline Ops Plan V01

## Basis and scope

- Requirements: [Weekly Combined Flow PRD V05](20261001_weekly_combined_flow_prd_v05.md).
- Phase 1 prerequisite: [Worker Python Deduper Clear PRD V01](20261001_worker_python_deduper_clear_prd_v01.md). Verify its endpoint changes before connecting the working phase 1 module; the initial stub does not depend on them.
- Process: [Plan and Vet](../PLAN_AND_VET.md). Codex is the planner and default todo creator; Claude is the existing assessor. The operator decides when to advance or begin implementation.
- This plan describes the overall integration and the initial scaffolding increment. Only the initial increment is ready for a detailed todo after assessment. Later phase implementations are developed with the operator as separate small increments.
- No runtime code is changed by this plan. The initial increment does not execute database deletion, launch workers, introduce the run table, or install a timer.

## Technology and package boundary

1. Add a private `ops/` npm workspace, named `newsnexus12-ops`, alongside the existing root workspaces. Use the repository's TypeScript, Node, and npm conventions and its existing root lockfile.
2. Follow worker-node's strict TypeScript compiler approach and use `tsx` for manual development execution and compiled JavaScript for server execution. A coordinator command should run once, rather than restart automatically through a watch process when files change.
3. Use Winston for coordinator logging and dotenv for local environment loading. Match worker-node's supported environment values and logging configuration without importing worker-node's server startup or requiring its unrelated workflow settings.
4. Phase 1 uses HTTP and needs no direct database dependency in ops. Add `@newsnexus/db-models` when coordinator persistence or article-count queries require it, and build it before ops then. Retain worker-node and worker-python as the owners of their existing workflows.
5. Keep shell and operating-system dependencies at phase boundaries. Avoid machine-specific paths in the coordinator. Systemd is an Ubuntu deployment concern introduced after the relevant modules work manually.

## Initial code structure

Use a small, explicit structure; do not build a generic pipeline framework.

| Proposed file | Responsibility |
| --- | --- |
| `ops/src/weekly-flow-02/index.ts` | Load configuration, initialize logging, and invoke the coordinator once. |
| `ops/src/config.ts` | Read only configuration required by the implemented increment. |
| `ops/src/logger.ts` | Provide the coordinator's own Winston logger using worker-node's output conventions. |
| `ops/src/weekly-flow-02/coordinator.ts` | Log coordinator startup and call the phase 1 module. |
| `ops/src/weekly-flow-02/phases/clearDuplicateAnalyses.ts` | Initially expose an explicitly labeled phase 1 stub; later call worker-python's clear endpoint and validate and log its result. |

- The stub provides a real module boundary for the coordinator to call. Its log makes clear that phase 1 was entered but database clearing is not yet implemented. It must not report that analysis rows were removed or that phase 1 completed.
- The first increment ends after demonstrating that invocation and its logs. It includes no retries, recovery state machine, failure policy, automatic phase advancement, or simulated successful database work.
- Use descriptive function names, direct control flow, and comments explaining intent or non-obvious assumptions. Review the small amount of code with the operator before adding the real phase 1 operation.

## Logging and configuration

1. Follow `worker-node/src/modules/logger.ts`: timestamp, uppercase bracketed level, readable message, and `key=value` metadata, with error stacks when available.
2. Match transports and levels: development console/debug, testing console and file/info, production file/info. Match size-based file rotation and configuration names; worker-node currently defaults to 5 MB and five retained files.
3. Use a distinct coordinator `NAME_APP`, such as `newsnexus12-weekly-pipeline`, even when sharing a log directory with worker-node. Keep the coordinator's environment configuration separate from worker-node's required service settings.
4. Resolve local ops environment configuration consistently regardless of the invoking working directory. Respect environment supplied by the server service. Load it before importing database models once database work is introduced, because the shared connection reads its configuration at import time.
5. Initial messages show coordinator startup and phase 1 module entry. Run IDs, job IDs, completion, and recovery messages appear when the corresponding capabilities exist. Do not manufacture durable run IDs before run persistence is implemented.
6. When implementing the working phase 1 module, configure the worker-python base URL and a bounded HTTP timeout with the operator. Allow for the endpoint's cancellation wait and database operation; a client timeout leaves completion unverified and must not advance the flow.

## Growth into the phase modules

These are integration boundaries for later operator-led increments, not authorization to implement the entire sequence at once.

| Runtime phase | Intended integration |
| --- | --- |
| 1. Clear duplicate analyses | Call `DELETE /deduper/clear-db-table`; worker-python stops only deduper jobs, waits for them to exit, and clears the table. |
| 2. Database backup | Invoke db-manager's existing `--create_backup` command and verify its result and output location. |
| 3. Delete old articles | Invoke db-manager's existing default `--delete_articles` behavior. |
| 4. RSS collection | Start and monitor the existing worker-node RSS job; add only the first-ID reporting or recovery needed by the coordinator. |
| 5. Semantic scoring | Start and monitor the existing unscored-backlog job, without RSS targeting. |
| 6. State assignment | Pass the stored `articleCount` as its review limit and the reviewed article-age threshold. |
| 7. AI Approver V02 | Preview and start with the same count and agreed flags, then monitor its durable outcome. |

- Worker-python owns deduper-only cancellation, waiting for execution to stop, protection against concurrent deduper writes, and table deletion. Its endpoint must not offer any argument, configuration, or fallback that cancels unrelated workflows. Implement these requirements through the focused worker-python plan-and-vet work before integrating phase 1.
- The working phase 1 module sends a plain DELETE request, waits for the response, verifies HTTP success and `cleared = true`, and logs `cancelledJobs` and `rowsDeleted`. It does not delete rows directly or infer completion from a cancellation request. Failure or an unverified outcome prevents phase 2 from starting.
- Review the worker URL, its database target, response contract, and timeout with the operator. Verify the endpoint against a disposable development database. The subsequent phase 2 backup intentionally omits the cleared duplicate-analysis rows.
- When ops later requires direct database access for persistence or counting, initialize shared models and verify the existing schema through `ensureSchemaReady`. Do not alter or recreate the schema at runtime. The current shared connection uses PostgreSQL `PG_*` environment variables.
- Each later module review covers its command or API, working directory, inputs, job reference, completion source, polling or alternatives, logs, and repeat behavior. Resolve article-level failure policies at that point.
- Reuse the existing queues and worker logic. Ops coordinates those jobs; it does not duplicate scoring, RSS ingestion, state assignment, or approval logic.

## Eventual progress model

1. Introduce the new `WeeklyArticleFlowRuns02` table when persistence is implemented. Keep its schema separate from the removed V01 run table and prevent legacy backup data from being imported into it by name.
2. The required run-level completion field is `runCompleted`, a boolean. Store original start time, last phase reached, phase progress, worker job references, first RSS request and Article IDs, and the finalized article count. Review exact columns with the operator then.
3. Phase progress must distinguish a completed phase from a merely started one, including interruption between phases 3 and 4. It does not require additional run lifecycle statuses.
4. Capture RSS first IDs reliably across interruption. Calculate the count after RSS finishes, retain it for continuation, and pass it unchanged to both later consumers. An initial result field available only at normal job completion is insufficient for recovery after a mid-job stop.
5. Complete the run after the final phase's accepted outcome, after RSS adds zero articles across the run, or after a zero-eligible V02 preview. A zero-work intermediate phase alone does not complete the run.

## Eventual trigger behavior

- A no-argument launch examines only the last created run. No prior run or a completed last run starts a new run.
- An incomplete last run interrupted during phases 1–3 is replaced by a new run, with the old row left incomplete.
- An incomplete last run past phase 3 starts a new run if its original start time is more than the RSS default repeat window ago. Otherwise it continues under the same run ID using recorded phase progress.
- Use the RSS default, currently 72 hours. At exactly the window boundary, continuation applies. Do not reset original start time when continuing.
- Explicit CLI controls allow choosing a run ID for continuation or starting a new run instead of continuing. An implicit selection uses the last run only. Phase 1–3 interruptions always require a new run.
- Introduce active-execution protection before unattended use. An incomplete record must not be mistaken for stopped work; verify existing worker execution before starting a replacement job. Decide the concrete coordination mechanism with the operator when implementing recovery.
- Add the Friday 05:00 `America/Los_Angeles` timer only after manual execution and recovery are ready for the development server.

## Verification approach

- For the scaffold, run its TypeScript build and manual entry point, checking coordinator and phase-entry logs and confirming the stub makes no database or worker calls. Validate the supported logging destinations using development settings and a temporary testing log directory.
- When implementing real phase 1, verify its HTTP request and response handling, including failure and timeout paths that must not advance the flow. Exercise the updated endpoint against a disposable PostgreSQL database to confirm analysis rows are cleared, the table remains, and unrelated data and jobs are preserved.
- As default trigger selection is implemented, use behavior-focused tests for every decision-table branch, the exact time boundary, phase-boundary checkpoints, and completed zero-work outcomes.
- Build and review each increment on macOS, then validate applicable behavior on the Ubuntu development server before scheduled rollout. An Ubuntu container can supplement Linux checks; actual server verification covers service users, permissions, environment, systemd, and real worker integration.

## Plan-and-vet handoff

1. Claude assesses this plan against V05 and the repository using the workflow's qualifying-concern criteria. Any assessment is a new file; preserve prior PRDs, plans, and assessments.
2. If changes are warranted, Codex writes the next plan version. After the plan is accepted, Codex creates a phased todo limited to the initial scaffolding increment; Claude vets that todo.
3. The initial increment is larger than a trivial edit, so a todo is required. Its implementation phases include applicable checks, build verification, task completion, and commits as required by the workflow.
4. Implementation begins when directed by the operator. Completing a scaffold todo is followed by operator discussion of the actual phase 1 module, not automatic implementation of all remaining phases.
5. The endpoint change is a separate prerequisite for working phase 1, governed by its worker-python PRD. Keep its plan, assessment, and todo separate from the initial coordinator scaffold todo.
