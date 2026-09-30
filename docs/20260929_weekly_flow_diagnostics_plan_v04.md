---
created_at: 2026-09-29T22:45:09Z
updated_at: 2026-09-29T22:45:09Z
created_by: hermes (gpt-5.6-sol) nws-nn12dev
modified_by: hermes (gpt-5.6-sol) nws-nn12dev
supersedes: docs/20260929_weekly_flow_diagnostics_plan_v03.md
---

# Weekly flow semantic diagnostics plan v04

## Goal

Add bounded worker-side diagnostics that can materially narrow the cause of a future semantic-scorer connection reset, deploy the verified diagnostics without changing the installed weekly-flow systemd unit files, and collect one controlled production observation by manually triggering the already-installed weekly flow rather than waiting for or testing a timer.

## Corrected direction

The existing `.service` and `.timer` files on `nws-nn12dev` and `nws-nn12prod` are no longer investigation targets. Both the timer-triggered development drill and the independently triggered production semantic scorer reached the semantic workload, so another unit-file experiment is not expected to explain the reset.

This plan therefore removes the v03 systemd creation, installation, replacement, scheduling, and timer-validation work. The next experiment concerns semantic-worker behavior and diagnostics, not whether systemd can launch the workflow.

## Hard boundaries

1. Do not modify, replace, copy, reinstall, or generate any weekly-flow `.service` or `.timer` file on development or production.
2. Do not change files under `ops/weekly-article-flow/systemd/` as part of this implementation.
3. Do not write to `/etc/systemd/system/`, create drop-ins, run `systemctl daemon-reload`, alter enablement, or reschedule either server's weekly timer.
4. Do not use another one-time timer or timer drill.
5. Do not change semantic eligibility, SQL selection, scoring behavior, model choice, queue concurrency, request count, polling cadence, timeout policy, retry policy, or cancellation policy in this diagnostic change.
6. Do not combine the unrelated state-assigner model problem, AI Approver eligibility problem, or alert-publisher privilege problem with this semantic diagnostic implementation.
7. Do not include the existing unrelated `package-lock.json` modification or the untracked `ops/weekly-article-flow/systemd/nws-nn12dev-drill/` files in diagnostic commits.
8. Do not expose credentials, environment contents, article text, prompts, SQL text, or response bodies in logs.

## Existing evidence retained

The coordinator already records the failed worker endpoint, request duration, timeout/status state, nested transport cause, run/stage/job context, and cancellation-request outcome. Production run 4 demonstrated that this can identify `read ECONNRESET` and the affected status request.

That coordinator logging remains in place. This plan does not duplicate or redesign it. The missing evidence is worker-side state around semantic initialization: process age, memory, event-loop responsiveness, initialization boundaries, and the first scoring attempt.

## Implementation scope

### Worker diagnostic configuration

Add one worker-scoped opt-in setting, `WORKER_HTTP_DIAGNOSTICS_ENABLED`, to the existing worker-node configuration path.

- Default to disabled when absent.
- Accept the project's established explicit boolean forms.
- Reject an explicitly invalid value during worker configuration validation.
- Keep the setting independent from coordinator configuration.
- Do not require any systemd unit-file edit. Development and production enablement must use the worker's existing application environment/configuration mechanism.

No new coordinator feature flag is required for the already-implemented coordinator failure diagnostics. If implementation discovery proves that additional coordinator events are necessary, they must be justified in the TODO assessment before code changes; they must not require a unit-file modification.

### Bounded worker measurement collector

Implement a small worker-node diagnostic collector using supported Node.js APIs. It should report:

- UTC timestamp and monotonic elapsed duration;
- semantic queue job ID and a stable phase/event name;
- process uptime;
- resident-set size, heap used, heap total, external memory, and array-buffer memory when available;
- event-loop utilization;
- event-loop delay summary using bounded aggregate values rather than raw samples;
- whether a scheduled sample was delayed until after synchronous work completed.

The measurements are process-wide observations, not proof that the semantic job alone consumed the measured resources. Every event must label that limitation consistently.

The collector must:

- run only when the diagnostic flag is enabled and only for the semantic scorer path;
- sample no more frequently than once per second;
- stop after 15 minutes or 1,000 records, whichever occurs first;
- emit one suppression/final summary when a limit is reached;
- use unreferenced timers so diagnostics cannot keep the worker alive;
- clean up timers and event-loop monitors on success, failure, and cancellation;
- avoid throwing into or changing the scoring workflow if logging itself fails.

### Semantic lifecycle integration

Integrate the collector with the existing semantic scorer job rather than HTTP middleware for every worker route. Emit correlated events at these boundaries:

1. semantic job accepted/started;
2. candidate and keyword selection completed, using counts already available in memory;
3. model initialization started;
4. model initialization completed or failed;
5. first article attempt started;
6. semantic job completed, failed, or was canceled;
7. collector cleanup/final summary.

Do not add diagnostic database queries. Do not log article IDs unless an existing safe aggregate event already requires one; aggregate counts and the queue job ID are sufficient for this investigation.

The implementation should make model-initialization completion duration explicit. A missing first-attempt event must be interpretable only with the corresponding terminal or cleanup event; it must not be treated automatically as event-loop failure.

## Tests and build verification

Use test-driven implementation. Add focused worker-node tests that prove:

- diagnostics are absent when the flag is disabled;
- valid and invalid flag values are handled predictably;
- enabled diagnostics contain the required bounded fields and job correlation;
- no article text, credentials, prompts, environment dumps, URLs with query data, or response bodies are emitted;
- sampling is bounded by frequency, duration, and record count;
- timers are unreferenced and all collectors are cleaned up on success, failure, and cancellation;
- delayed sampling is labeled after the event loop resumes;
- logging failures do not alter queue status or semantic results;
- semantic start, polling, cancellation, selection, model initialization, scoring, and persistence behavior remain unchanged.

Run worker-node type checks, focused tests, broader relevant tests, and its build using an explicitly isolated test database where any Jest setup can access PostgreSQL. Never point tests at the development or production runtime database. Verify the compiled worker artifact contains the new diagnostic events and that the working tree contains only intended files before commit.

## Development validation without systemd changes

Development validation is limited to code and worker behavior; it must not install, edit, reload, start, stop, enable, or test the weekly-flow timer or weekly-flow service.

1. Confirm no semantic job or weekly flow is active.
2. Enable the worker diagnostic flag through the existing worker-node application configuration, without modifying a systemd unit.
3. Build the worker and refresh only `newsnexus12-worker-node.service` through the established stop/start control path so the worker loads the new code and environment. Do not restart `newsnexus12-db-manager`.
4. Verify worker health and confirm that disabled/enabled logging behavior matches the tests.
5. If a live development semantic run is used to validate event correlation, trigger it through the existing application/manual path, not through a weekly timer. Treat it as a real data-writing job and record its job ID and outcome.
6. Do not require the connection reset to reproduce in development. The acceptance criterion is correct, bounded evidence with no behavior change.

## Commit and remote boundary

After development verification:

- stage only the worker diagnostic implementation, its tests, and the approved plan/TODO artifacts;
- exclude `package-lock.json` unless the implementation intentionally changes dependencies and the TODO explicitly approves that change;
- exclude `ops/weekly-article-flow/systemd/nws-nn12dev-drill/`;
- inspect the staged diff, commit, push, and verify local/remote SHA parity.

No production deployment begins from a dirty or divergent worktree.

## Production deployment without unit-file changes

Production deployment may update repository code, build artifacts, and the worker's existing application configuration. It must not modify any `.service` or `.timer` file.

1. Verify `nws-nn12prod`, the checkout, current branch/revision, upstream relationship, and clean worktree.
2. Fetch and fast-forward only the approved branch. Stop on divergence, overlap, or unexpected files.
3. Install only if the approved diff changes dependencies; otherwise do not create lockfile churn.
4. Build the affected worker-node package and verify the deployed compiled artifact contains the approved diagnostic event names.
5. Enable `WORKER_HTTP_DIAGNOSTICS_ENABLED` using the worker's existing application configuration. Do not edit a unit or add a drop-in.
6. Refresh only `newsnexus12-worker-node.service` using stop then start, and verify its health, process start time, code revision, and diagnostic configuration. Do not restart `newsnexus12-db-manager` or unrelated NewsNexus services.
7. Do not inspect or retest the installed weekly `.service` or `.timer` as part of this work. Keep those paths entirely outside the deployment procedure.

## Manual production observation

Do not wait for, reschedule, or test the production timer. After deployment and preflight, manually trigger the already-installed production weekly flow through the established operator path. If that path starts the existing weekly service directly, starting it is only the launch mechanism; do not edit, reload, enable, disable, or otherwise test the unit definition.

Before the manual trigger:

- verify there is no active weekly run, semantic job, maintenance process, or held weekly-flow lock;
- verify worker-node health and the diagnostic flag;
- verify the approved revision and compiled artifacts;
- record worker PID, process start time, uptime, baseline memory, and clock alignment;
- verify the normal production environment and `limited_user`/`newsnexus_app` identities without printing secrets;
- acknowledge that a production weekly flow performs real maintenance, backup, deletion, RSS ingestion, AI work, and database writes and has no production canary limit.

Start exactly one flow. Do not start a second run because output is delayed. Capture the coordinator output/journal, worker journal, durable run row, child job ID, stage results, and diagnostic events through terminal completion or failure.

## Interpretation

A repeated reset can establish timing relative to worker memory, process age, model initialization, event-loop delay, and first article attempt. It still does not by itself identify which TCP peer or kernel component sent the reset.

No reset means only that this production observation completed the semantic stage under the recorded conditions. It does not prove the issue is fixed.

Keep these outcomes separate:

- coordinator-to-worker transport failure;
- semantic scoring result;
- state-assigner model/configuration failure;
- AI Approver eligibility failure;
- alert-publisher privilege failure.

Do not change retry/cancellation policy during this diagnostic run. A resilience change should be planned and tested separately after the new evidence is reviewed.

## Completion criteria

This plan is complete when:

1. worker diagnostics are implemented, bounded, redacted, tested, and compiled;
2. no weekly-flow `.service` or `.timer` repository or installed file was modified;
3. the approved commit is pushed and safely deployed to production;
4. worker-node alone is refreshed and healthy with diagnostics enabled;
5. one production weekly flow is manually triggered without using the timer;
6. coordinator, worker, database, and queue evidence are correlated by run ID, job ID, and timestamp;
7. the result explicitly states whether a reset occurred, where it fell in semantic initialization, what the measurements establish, and what remains unknown.

## Next workflow step

Because this remains a multi-component implementation and production-observation change, create and assess `docs/20260929_weekly_flow_diagnostics_todo_v01.md` from this v04 plan before implementation. The TODO must preserve every hard boundary above, especially the prohibition on systemd unit-file changes and timer testing.
