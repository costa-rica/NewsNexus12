---
created_at: 2026-10-01T23:56:40Z
updated_at: 2026-10-02T00:16:54Z
created_by: codex (gpt-6) nicksmacbookair
modified_by: codex (gpt-6) nicksmacbookair
---

# NewsNexus12 Operations

This workspace holds operational processes for NewsNexus12. Its first process, weekly-flow-02, starts the weekly coordinator, enters a phase 1 stub, and exits.

---

## Project Overview

- Available now: a one-shot coordinator, configuration, console/file logging, and a phase 1 skeleton.
- Pending: the actual clearing operation, later phases, and scheduled execution.
- Running the scaffold makes no worker requests or database changes.

Stack: Node.js, TypeScript, dotenv, Winston, npm workspaces.

---

## Setup

Prerequisites:

- Node.js 20 or newer and npm, following the repository's declared runtime requirement.
- Run commands from the NewsNexus12 repository root.
- No Python virtual environment, database, or running worker is needed for this check.

1. Install dependencies if this checkout has not already been installed:

```bash
npm install
```

2. Check types and build this workspace explicitly:

```bash
npm run typecheck --workspace newsnexus12-ops
npm run build --workspace newsnexus12-ops
```

- Local configuration: copy the example without replacing an existing file before using the normal run commands. The temporary-log check supplies its own settings.

```bash
if [ ! -e ops/.env ]; then
  cp ops/.env.example ops/.env
fi
```

---

## Usage

Run from the repository root after setup:

```bash
# Run once from TypeScript (no watch process).
npm run weekly-flow-02:dev --workspace newsnexus12-ops

# Run compiled JavaScript; rebuild after source changes.
npm run build --workspace newsnexus12-ops
npm run weekly-flow-02:start --workspace newsnexus12-ops

# If your terminal is already inside ops/, use:
# npm run weekly-flow-02:dev
# npm run build && npm run weekly-flow-02:start
```

- Expected sequence: startup header, “Phase 1 entered; clearing not implemented”, and “Scaffold stopped after phase 1 stub; no pipeline work performed”.
- The named commands run only weekly-flow-02; future processes can have separate commands in this workspace.
- Each command runs once and exits. There is no resume behavior yet.
- The example configuration logs to the console in development. Testing writes to console and file; production writes to file only.
- File logs use the configured directory and application name. Relative log directories resolve from the ops workspace.
- A failed startup returns a nonzero exit status and prints an error. Successful exit confirms the scaffold ran, not that database clearing occurred.

### Temporary-log check

Run this complete block from the repository root on macOS or Ubuntu after building. It checks the final message, displays the log, and removes the temporary directory.

```bash
(
  set -e
  test_dir=$(mktemp -d)
  trap 'rm -rf "$test_dir"' EXIT

  env NODE_ENV=testing NAME_APP=weekly-pipeline-smoke \
    PATH_TO_LOGS="$test_dir" LOG_MAX_SIZE=5 LOG_MAX_FILES=5 \
    npm run weekly-flow-02:start --workspace newsnexus12-ops

  grep -q 'Scaffold stopped after phase 1 stub' "$test_dir/weekly-pipeline-smoke.log"
  cat "$test_dir/weekly-pipeline-smoke.log"
  echo 'PASS: coordinator entered the stub and final log message was written'
)
```

- Messages appear twice: once from live logging, then from displaying the file.
- Supplied settings override local configuration. Existing application logs are untouched.
- This checks the scaffold only. Worker integration and Ubuntu server validation remain pending.

Rebuild after source changes, rerun, and compare the messages.

---

## Project Structure

```text
ops/
├── .env.example     # Local configuration template
├── package.json     # Workspace build and type-check commands
├── tsconfig.json    # TypeScript build settings
├── README.md        # Operator setup and smoke check
└── src/
    ├── config.ts    # Shared configuration loading
    ├── logger.ts    # Shared console/file logging
    └── weekly-flow-02/
        ├── index.ts       # Weekly flow entry point
        ├── coordinator.ts # Calls the phase 1 stub
        └── phases/
            └── clearDuplicateAnalyses.ts # Phase 1 skeleton
```

---

## References

- [Weekly pipeline requirements](../docs/weekly-article-pipeline-v02/20261001_weekly_combined_flow_prd_v05.md)
- [Ops implementation plan](../docs/weekly-article-pipeline-v02/20261001_weekly_pipeline_ops_plan_v01.md)
- [Coordinator scaffold checklist](../docs/weekly-article-pipeline-v02/20261001_ops_coordinator_scaffold_todo_v01.md)
