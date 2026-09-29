---
created_at: 2026-09-29T21:23:00Z
updated_at: 2026-09-29T21:23:00Z
created_by: codex (gpt-6) macbook-air
modified_by: codex (gpt-6) macbook-air
---

# Weekly flow connection diagnostics plan v02

## Purpose and provenance

- Narrow the semantic status connection-reset mechanism using a small, bounded experiment before adding complex application instrumentation.
- Preserve workflow behavior and provide useful failure evidence even when the production error cannot be reproduced.
- Supersedes [the original plan](20260929_weekly_flow_connection_diagnostics_plan.md); the shorter filename follows the workflow's descriptive-name limit. Preserve the original and [Claude's assessment](20260929_weekly_flow_connection_diagnostics_plan_assessment_claude.md).
- This is a planning revision. It does not authorize deployment, server experiments, workflow execution, or production configuration changes.

## Assessment decisions

1. Accept concerns 1, 4, 5, and 7: begin with separate-process experiments, gate complex instrumentation on evidence, and define finite observation limits.
2. Partially accept concern 3: replace detailed timings of every loading substep with durable initialization, first-attempt, responsiveness, and memory measurements. A SQL rewrite remains a proposal, not an approved replacement or proven reset fix.
3. Accept concern 6: use separate coordinator and worker setting names. A generic worker setting does not expand collection to every endpoint.
4. Partially accept concern 2: diagnostics must not block a separately approved polling-resilience effort. Do not silently add retries or promise they are safe for every failure; permanent errors must still stop loudly.
5. Packet capture can help identify the observed reset's sender, but cannot explain a reset that does not recur or independently prove its cause. Treat it as an optional, bounded experiment aid.

## Evidence and remaining uncertainty

- Production run 4 lost a status connection during semantic initialization, then canceled the worker job before scoring began.
- Production loaded approximately 260,000 articles; dev loaded 257,061 and completed semantic scoring without a reset. The expensive loading path alone does not explain the difference.
- Worker initialization delay is supported by the reports. Event-loop starvation, socket reuse, and a keep-alive closure race remain unconfirmed mechanisms.
- A successful synthetic reproduction supports a mechanism under its recorded conditions. It does not prove production experienced the same sequence.

Sources:

1. [Production failure](20260929_weekly_article_flow_run_4_failure_report.md).
2. [Production investigation](20260929_run_4_connection_reset_investigation.md).
3. [Dev reproduction](20260929_nws-nn12dev_weekly_article_flow_run_4_resume_reproduction_report.md).

## Scope and architecture

- Experiment tooling belongs under `ops/weekly-article-flow`, outside runtime startup and normal application tests.
- Coordinator diagnostics belong in `ops/weekly-article-flow`; worker observations, if justified, belong in `worker-node`. This is not confined to the ops folder if worker-side evidence is required.
- Preserve native fetch, connection pooling, polling cadence, timeouts, cancellation, eligibility, model selection, and queue concurrency.
- No schema changes, added database queries in runtime diagnostics, retry loops, alert repairs, schedule changes, or production execution.
- Use existing log destinations and existing error diagnostics wherever sufficient. Instrumentation failures must not replace the original workflow error or change the outcome.

## Stage 0: bounded mechanism experiment

1. Use a standalone worker-like HTTP server and polling client in separate child processes on dev. The controller supplies an independent overall deadline and terminates its own children on timeout or interruption.
2. Bind only to a dedicated unused loopback port. Do not reuse the running worker's port, restart it, or call its job-start endpoint.
3. Record exact Node and bundled Undici versions, OS, effective HTTP timeout settings, and experiment parameters. Match the reported production runtime where already available; otherwise report the mismatch instead of changing installed runtimes.
4. Match the application's native fetch usage and observed polling cadence, including the initial one-second and subsequent two-second waits. Confirm actual connection reuse from the fixture's accepted sockets instead of assuming pooling occurred.
5. Compare a no-stall control with a single CPU block, chunked CPU blocks, and I/O-interleaved work. Place stalls around the observed effective keep-alive expiry; preserve those settings rather than tuning them to force success.
6. Bound the initial matrix to eight cases, at most 30 seconds each, and a ten-minute overall deadline. Record case parameters, request outcomes, socket identities, elapsed times, and cleanup results. No automatic rerun after the budget ends.
7. A real Sequelize article-load case is optional follow-up, not part of the initial synthetic matrix. It requires a separately agreed dev load window and explicit read-only access, statement/runtime bounds, and no application bootstrap that could sync or write data.
8. An authorized packet capture may run alongside a case, limited by interface, dedicated port, elapsed time, and file size. Capture metadata needed for reset direction and timing. Do not promise that a generic short snapshot excludes all payload or credentials; synthetic fixture traffic must contain neither.

The client must remain responsive while the server stalls. Server-side timers cannot sample during a synchronous block; record delayed callbacks after recovery. Include chunked and I/O-interleaved cases because one solid CPU block does not model database hydration and garbage collection completely.

## Evidence gate

1. If the experiment reproduces a reset, save the smallest reproducing case and its limits. Propose a separate behavioral fix and regression test; do not automatically implement the original logging design.
2. If it does not reproduce, report the tested conditions and stop the matrix. This weakens only the tested version of the hypothesis; it does not rule out production timing or resource differences.
3. Before runtime instrumentation, identify the unanswered question and the smallest observation that can answer it. Record the selected scope in the next vetted plan or todo before implementation.
4. Proceed to complex socket instrumentation only when existing logs, fixture evidence, and minimal measurements leave a specific transport question unresolved. Non-reproduction alone does not justify implementing every hook.

## Minimal runtime evidence, if needed

- Coordinator: retain request timing, exact job identity, HTTP status when available, nested allowlisted transport errors, and cancellation outcome. Extend existing events only for missing fields; do not duplicate them.
- Worker: measure semantic initialization start/end and first article attempt, associated with the existing job ID. Capture counts already available in memory rather than adding queries or serializing large objects.
- At these boundaries and at most once per second during initialization, measure event-loop delay/utilization, callback scheduling delay, RSS, heap, and external memory using supported Node APIs.
- Label measurements as process-wide. A delayed sample or correlation does not prove which job caused a pause. Missing samples must never be reported as zero delay.
- Avoid detailed timings coupled to the current filtering implementation and per-GC events. Keep measurements useful if selection later moves into SQL.
- Preserve the existing application request/response contract. Do not add cross-service headers unless the evidence gate identifies a correlation gap that existing identifiers and timestamps cannot resolve.

## Conditional transport extension

- Only if needed, correlate semantic start, exact-job status, and cancellation requests with bounded opaque request IDs. Validate incoming metadata and never use it for authorization or queue ownership.
- Distinguish worker request arrival, response completion, and premature closure. Missing arrival means parsing/arrival was unobserved, not that no packet reached the host.
- Prefer supported passive Undici observations and socket identity. Mark unavailable reuse/address fields as unknown; never infer reuse from elapsed time alone.
- Do not add `clientError` or timeout handlers that take ownership of Node's default handling. Do not consume streams, write responses, destroy sockets, replace the dispatcher, or modify connection headers.
- A connection ring is not part of the baseline. Any later proposal must justify why pre-parser lifecycle evidence is needed and specify numeric capacity and expiry before implementation.

## Controls and limits

1. Keep `WEEKLY_FLOW_DIAGNOSTICS_ENABLED` for the coordinator and use `WORKER_HTTP_DIAGNOSTICS_ENABLED` for the worker. Both default off; document accepted values and reject explicitly invalid configuration clearly.
2. Worker detail remains scoped to semantic initialization and relevant weekly-flow requests. Process measurements are explicitly process-wide; unrelated endpoint traffic does not receive detailed logging.
3. Either side must work with diagnostics disabled on the other side or with the previous application version.
4. Include UTC timestamps, monotonic durations, process-instance identity, and available run/job/request IDs. Log runtime and effective HTTP settings once per session.
5. Never log request/response bodies, article text, SQL text, credentials, cookies, authorization headers, or environment dumps. Bound and allowlist error/correlation fields.
6. Limit a detailed initialization window to 15 minutes and 1,000 records per side. Emit one suppression summary at the limit; preserve ordinary errors and a compact final summary.
7. Unsubscribe listeners and stop timers/observers on completion, cancellation, failure, or expiry. Use unreferenced timers and bounded correlation state; overlapping jobs must not create unbounded collectors.

## Verification and observation

- Verify isolated fixture cleanup, finite budgets, no real worker calls, and responsive independent client/controller processes.
- For any selected runtime changes, compare diagnostics off/on: identical start/poll/cancel counts, outcomes, HTTP defaults, and ordinary error handling, including logging failures.
- An intentionally reset connection tests diagnostic coverage only; label it separately from a reproduced keep-alive failure.
- Verify delayed sampling, redaction, suppression, listener cleanup, and repeated-window resource use. Measure enabled/disabled overhead using the isolated fixture.
- Build affected packages and run relevant tests. Worker integration tests require a dedicated test database because setup can drop/recreate it; never use the application database.
- Full dev workflow observation is optional and separately authorized because it writes real data. Default to one run; a second needs a specific changed condition and operator agreement. Stop after two runs at most and report non-reproduction if applicable.
- Capture coordinator output and worker logs with versions, resource context, clock alignment, and cold/warm model state. Disable diagnostics after the agreed observation period.
- Production capture, deployment, service restart, and schedule changes remain operator-directed activities outside this plan.

## Separate proposed work

1. Poll resilience can be planned independently without waiting for root-cause proof. If requested, specify retryable errors, at most two additional attempts, an elapsed-time ceiling within the stage deadline, permanent-error fail-fast behavior, and visible terminal failure. Never reissue job creation as a status retry.
2. SQL-side eligibility filtering merits its own plan with result-parity checks for approval associations, previously processed articles, targeting bounds, and selected content. It may reduce load; it is not a demonstrated connection-reset cure.
3. This plan does not require either change and does not schedule them. Leave Friday's timer unchanged unless the operator directs otherwise.

## Completion and rollback

- The investigation succeeds when it delivers reproducible evidence or a bounded non-reproduction report with explicit remaining gaps. A confirmed production cause is not promised.
- Any implemented diagnostics must satisfy behavior-preservation tests, bounded resource use, and useful identifiers without exposing sensitive content.
- Disable diagnostic flags through the normal service-management process to stop detailed collection. No database migration or data rollback is required for instrumentation.
- Return this v02 to the assessor. A vetted todo is required before implementing this multi-step work.
