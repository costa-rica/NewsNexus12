---
created_at: 2026-10-01T23:56:40Z
updated_at: 2026-10-05T22:11:53Z
created_by: codex (gpt-6) nicksmacbookair
modified_by: codex (gpt-6.1-sol) nicksmacbookair
---

# NewsNexus12 Operations

This workspace contains operational workflows for NewsNexus12. Weekly-flow-02 currently runs Phases 1–5 and stops at the Phase 6 boundary.

---

## Project Overview

Weekly-flow-02 clears duplicate analyses, creates a verified backup, deletes eligible old Articles, collects Google News RSS Articles, and runs semantic scoring. Progress is persisted for controlled continuation.

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
- A successful positive-work run stops at the Phase 6 boundary and remains incomplete for the later phases.
- Logs use the directory configured in `ops/.env`; durable progress is stored in `WeeklyArticleFlowRuns02`.
- Phase 5 can monitor semantic scoring for up to six hours before exiting nonzero for operator review.

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
- [Ops agent instructions](AGENTS.md)
