---
created_at: 2026-10-01T23:47:44Z
updated_at: 2026-10-02T00:00:30Z
created_by: codex (gpt-6) nicksmacbookair
modified_by: codex (gpt-6) nicksmacbookair
---

# Weekly Pipeline Coordinator Scaffold Todo V01

## Basis and scope

- Requirements: [Weekly Combined Flow PRD V05](20261001_weekly_combined_flow_prd_v05.md).
- Technical direction: [Weekly Pipeline Ops Plan V01](20261001_weekly_pipeline_ops_plan_v01.md).
- Review process: [Plan and Vet](../PLAN_AND_VET.md). Claude vets this todo before the operator authorizes implementation.
- Build only the initial coordinator scaffold: an `ops/` workspace, configuration, logging, a manual entry point, and a runtime phase 1 stub.
- The implementation phases below are small construction steps. They are distinct from the weekly pipeline's runtime phases.
- No database operations, worker requests, persistence, recovery framework, later runtime phases, or systemd files belong in this increment.

The operator reported 30 passing worker-python tests on Ubuntu. Those tests support moving forward with this independent scaffold. Actual endpoint and database verification remains a prerequisite for connecting the working runtime phase 1 module.

## Working agreement

1. Explain each implementation phase's small set of changes before writing code.
2. Use direct, human-readable code and comments for intent or non-obvious behavior. Avoid generic pipeline abstractions.
3. Demonstrate the result and explain the call sequence and configuration to the operator.
4. Stop after each implementation phase for operator review and direction before beginning the next.
5. Check off only completed, verified work. Record commands and results, distinguishing local checks from operator-reported Ubuntu checks.

## Implementation phase 1: Workspace and logging

- [x] Add private npm workspace `ops/`, named `newsnexus12-ops`, to the root workspace list and update the existing root lockfile.
- [x] Add a strict TypeScript configuration following worker-node's compiler conventions. Use compatible existing versions of TypeScript, Node types, `tsx`, dotenv, and Winston.
- [x] Add workspace `build` and `typecheck` scripts. Keep this package independent of worker server startup and database models.
- [x] Create `ops/src/config.ts` with only scaffold settings: `NODE_ENV`, `NAME_APP`, `PATH_TO_LOGS`, and the existing optional rotation settings `LOG_MAX_SIZE` and `LOG_MAX_FILES`.
- [x] Resolve `ops/.env` consistently when invoked from the repository root or `ops/`. Preserve environment values supplied by the calling process. Resolve relative log paths consistently against `ops/`; preserve absolute paths.
- [x] Add `ops/.env.example` with a distinct coordinator name such as `newsnexus12-weekly-pipeline`. Ensure local environment files, generated logs, and build output are ignored.
- [x] Create `ops/src/logger.ts`, matching `worker-node/src/modules/logger.ts`: timestamp, uppercase bracketed level, readable message, `key=value` metadata, JSON for structured metadata, and error stacks.
- [x] Match development console/debug, testing console and file/info, and production file/info behavior. Preserve the established rotation defaults of 5 MB and five files.
- [x] Provide a way to finish pending log writes before this short-lived process exits.

### Verification and closeout

- [x] Run scoped type checking and the ops build; fix failures.
- [x] Use focused smoke checks to verify configuration loading from both working directories, supplied-environment precedence, and logging destinations using temporary directories.
- [x] Verify an error's stack and structured metadata remain readable. Verify logs finish writing before the smoke process exits.
- [x] Run applicable existing tests or lint checks if configured; do not introduce a new framework solely for scaffold checks.
- [x] Record verification results, update completed checkboxes, and commit this phase with a reference to this todo and phase 1.
- [x] Review the workspace, configuration, and logging with the operator before phase 2.

### Phase 1 verification record

- Local macOS, Node v24.11.0: `npm run typecheck --workspace newsnexus12-ops` and `npm run build --workspace newsnexus12-ops` passed.
- Temporary smoke harness passed: root and ops working directories, dotenv precedence, relative paths, defaults, invalid configuration, and the worker-node-compatible `test` alias.
- Development, testing, and production transport checks passed, including structured metadata, error stacks, debug filtering, and the final file message after process exit. Temporary fixtures and logs were removed.
- Dependencies installed from the local npm cache; existing dependency versions were retained. No ops test or lint framework is configured.
- The operator reviewed the scaffold direction and authorized phase 2. Ubuntu checks remain pending.

## Implementation phase 2: Coordinator and stub

- [x] Add `ops/src/index.ts` to load configuration, initialize logging, and invoke the coordinator once.
- [x] Add `ops/src/coordinator.ts` with an understandable startup header following worker-node's logging style and a direct call to the phase 1 module.
- [x] Add `ops/src/phases/clearDuplicateAnalyses.ts` as an explicit stub. Log that the module was entered and clearing is not implemented.
- [x] End execution after the stub. Do not log that rows were deleted, runtime phase 1 completed, or the weekly pipeline completed. Do not invent persisted run IDs.
- [x] Report bootstrap errors clearly and return a nonzero exit status when startup fails. Finish pending logs before exit; do not add a general recovery or retry system.
- [x] Add one-shot workspace commands: `dev` using `tsx src/index.ts` and `start` using `node dist/index.js`. Do not use watch mode.
- [x] Add a concise `ops/README.md` explaining configuration, manual commands, expected messages, and the stub boundary. Include the repository's required Markdown frontmatter.

### Verification and closeout

- [x] Run scoped type checking, the ops build, and any applicable configured tests or lint checks; fix failures.
- [x] Run the development entry point and compiled entry point on macOS. Confirm one startup, one stub invocation, and a clean exit with final logs written.
- [x] Verify testing writes console and file output and production writes file output using temporary log directories.
- [x] Confirm invocation from the repository root and `ops/` behaves consistently. Confirm invalid startup configuration produces a clear error and nonzero exit.
- [x] Review the call path to confirm there are no worker requests, subprocess launches, database operations, or automatic advancement.
- [x] Document repeatable Ubuntu smoke commands using the Node workspace and temporary logs. No Python virtual environment or running workers should be needed.
- [x] Record verification results, update completed checkboxes, and commit this phase with a reference to this todo and phase 2.
- [ ] Walk through the entry point, coordinator, and stub with the operator before adding real phase behavior.

### Phase 2 verification record

- Local macOS: scoped type checking and compilation passed. No ops lint or automated test framework is configured.
- Smoke checks passed for both development and compiled commands, from repository root and ops, in all three logging environments (12 combinations).
- Each run logged one coordinator startup and one stub entry, wrote its final message, and exited cleanly. Production emitted application logs only to file.
- Invalid configuration returned a nonzero status with a clear error. The README temporary-log command also passed verbatim.
- The development command required execution outside the agent sandbox because tsx opens a local IPC socket; it passed when permitted.
- Reviewed the source call path: entry point loads configuration and logging, coordinator calls the stub, and logging drains before exit. No worker, database, or subprocess operations were added.
- Ubuntu validation and operator walkthrough remain pending before adding real phase behavior.

## Ubuntu validation and next handoff

- [ ] After the operator deploys the scaffold to the development server, run its build and compiled entry point with the documented settings. Confirm expected messages, log permissions, and clean exit under the intended user.
- [ ] Record the Ubuntu result separately from macOS verification; leave this item pending until performed.
- [ ] Commit any verification documentation updates after recording the result.
- [ ] Discuss the next small increment with the operator: the real phase 1 HTTP call, its timeout, response validation, and failure behavior.
- [ ] Before connecting real phase 1, complete the remaining endpoint verification in the [worker-python todo](20261001_worker_python_deduper_clear_todo_v01.md), including disposable-database checks and preservation of unrelated jobs.

Completing this todo delivers a manually runnable scaffold. Implementation of the working phase 1 module requires the operator's next direction and its own reviewed increment.
