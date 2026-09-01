---
created_at: 2026-09-01T02:28:47Z
updated_at: 2026-09-01T02:30:59Z
created_by: codex (gpt-5.6-sol) nicksmacbookair
modified_by: codex (gpt-5.6-sol) nicksmacbookair
---

# Weekly Article Flow macOS Verification

## 1. Scope

- Branch: `dev_30_weekly_cron`
- Verification host: `NicksMacBookAir`
- Verification date: 2026-08-31 Pacific / 2026-09-01 UTC
- Authority: `docs/20260831_weekly_article_flow_todo_v02.md` Phase 10
- Live worker calls: not used
- Live AI calls: not used
- Production database access: not used
- Database exercises: disposable, suite-owned local PostgreSQL databases only

This verification covers builds, tests, static contracts, fake-worker coordinator behavior, and the additive schema in disposable databases. Ubuntu systemd, account permissions, Obsidian sync, and long-running behavior remain behind the Phase 11 operator gate.

## 2. Commands and Results

### 2.1 db-models

1. Command: `npm -C db-models run build`
2. Result: passed.

### 2.2 db-manager

1. Command: `npm -C db-manager test -- --runInBand`
2. Result: 16 suites and 235 tests passed.
3. Command: `npm -C db-manager run build`
4. Result: passed.
5. Command: `npm -C db-manager run test:schema-weekly-article-flow`
6. Result: 1 integration suite and 7 tests passed against `newsnexus_test_weekly_article_flow`.

The dedicated integration suite recreated its database. It verified idempotent installation, one-active-run enforcement, nullable manual RSS linkage, restrictive deletion, exact cohort isolation, indexes, and the foreign key.

### 2.3 worker-node

1. Command: `npm -C worker-node test -- --runInBand`
2. Result: 32 suites and 191 tests passed.
3. Command: `npm -C worker-node run build`
4. Result: passed.

The suite emitted existing ts-jest configuration warnings and a post-run open-handle warning. Jest completed successfully and the subsequent TypeScript build passed.

### 2.4 weekly coordinator

1. Command: `npm -C ops/weekly-article-flow test -- --runInBand`
2. Result: 13 suites and 101 tests passed.
3. Command: `npm -C ops/weekly-article-flow run build`
4. Result: passed.
5. Command: `ops/weekly-article-flow/install.sh --check`
6. Result: shell and source-asset checks passed.
7. Command: `npm -C ops/weekly-article-flow run test:integration`
8. Result: 1 integration test passed against `newsnexus_test_weekly_coordinator`.

The integration test ran the real coordinator and repository through a complete canary with fake workers. It persisted authoritative run and cohort state in a recreated disposable database, verified token exclusion, and dropped the database during teardown.

### 2.5 worker-python V02

1. Command: `worker-python/venv/bin/pytest worker-python/tests/unit/ai_approver_v02 worker-python/tests/integration/test_ai_approver_v02_routes.py`
2. Result: 35 tests passed.

### 2.6 API regression

1. Command: `npm -C api test -- --runInBand`
2. Result: 24 suites and 158 tests passed.
3. Command: `npm -C api run build`
4. Result: passed.

The API smoke output confirmed removed legacy automation and V01 routes return HTTP 404.

### 2.7 Portal regression

1. Command: `npm -C portal run lint`
2. Result: passed with zero warnings.
3. Command: `npm -C portal run build`
4. Result: passed, including TypeScript and 23 generated routes.

The first portal build attempt stalled inside the restricted sandbox. The same command completed normally with build-process permissions. No code change was required.

## 3. Static Contract Review

1. Manual RSS compatibility
   - The optional `weeklyArticleFlowRunId` defaults to omission or `null`.
   - Route, job, and schema integration tests cover manual RSS without a weekly run.
2. Unrelated ingestion
   - Existing article linkage remains unchanged.
   - Exact cohort queries include only articles reached through requests carrying the current run ID.
3. Semantic scorer ownership
   - The coordinator submits the normal semantic scorer start request without cohort IDs.
   - Normal scorer eligibility remains inside worker-node.
4. State breaker ownership
   - Worker-node alone counts and resets consecutive state-assignment failures.
   - The coordinator consumes only the terminal `circuitBreakerTripped` result.
5. AI Approver V02 request
   - Mode A uses the exact RSS-added count.
   - Zero, partial, and full cohort overlap are visibility-only and all proceed.
6. Timeouts
   - Semantic scorer: 14,400 seconds, or four hours.
   - Coordinator: 259,200 seconds, or 72 hours.
   - Production systemd service: 73 hours.
7. RSS target boundary
   - `--canary-target` is rejected in both production modes.
   - Production accepts `queries_exhausted`, not `target_articles_collected`.
8. Schedule boundary
   - Production asset installation explicitly disables the timer.
   - Timer activation is a separate production-only action.
   - Development mode rejects weekly service and timer installation.
9. Sensitive data
   - The branch diff contains no API key, private key, nonempty database password, or OpenAI key pattern.
   - Production host and database entries in `.env.example` are replacement placeholders.
   - Reporting tests reject secret keys, preview tokens, and article content.
10. Removed runtimes
    - Active runtime source contains no V01 or removed cross-service legacy contract.
    - Remaining legacy names occur only in compatibility tests that prove old backups are sanitized or removed routes return not found.
    - Retained Python `orchestrator.py` files are single-workflow internal modules.

## 4. Local Safety Exercises

1. Fake-worker coordinator run
   - Completed all non-destructive canary stages in order.
   - Confirmed destructive maintenance stays skipped in canary mode.
2. Malformed worker result
   - Confirmed malformed counts and outcome arrays become `failed_worker_result_contract`.
3. Backup gate
   - Confirmed hash or manifest verification failure prevents old-article deletion and fails the run.
4. Resume safety
   - Confirmed completed stages are skipped.
   - Confirmed stored worker jobs reattach without resubmission.
   - Confirmed accepted V02 evidence reattaches to the exact run and job.
   - Confirmed ambiguous destructive work is not repeated.
5. JSONL authority
   - Confirmed a missing journal is created without influencing recovery.
   - Confirmed corrupt existing JSONL is not parsed as recovery state; a valid event is appended after it.
   - Confirmed journal failure leaves a successful PostgreSQL terminal status unchanged and records reporting failure.

## 5. Accepted macOS Limitations

- Localhost PostgreSQL access required leaving the restricted workspace sandbox. All database suites used fixed disposable test database names.
- `systemd-analyze`, systemd account boundaries, sudoers enforcement, and journald are unavailable on macOS.
- The fixed alert helper did not access NickVault or run `ob sync` on macOS.
- No live worker or AI operation was needed for the fake-worker Phase 10 exercise.
- Ubuntu dev remains the required environment for the Phase 11 canary and helper validation.

## 6. Outcome

Phase 10 is ready to close. No implementation blocker was found. The next action is the Phase 11 operator gate; no Ubuntu connection, deployment, schema write, or live AI call has been performed.
