---
created_at: 2026-09-29T21:11:00Z
updated_at: 2026-09-29T21:11:00Z
created_by: codex (gpt-6) macbook-air
modified_by: codex (gpt-6) macbook-air
---

# Weekly flow connection diagnostics implementation plan

## Objective

- Determine where semantic-stage status requests stop progressing and whether worker initialization delays coincide with connection closures.
- Capture evidence from both `ops/weekly-article-flow` and `worker-node` without changing scoring, selection, polling intervals, retries, timeouts, or cancellation policy.
- Keep detailed diagnostics optional, bounded, and disabled by default.

## Evidence and limits

- Production run 4 lost one status connection during semantic initialization and then canceled its worker job before scoring began.
- Production loaded approximately 260,000 articles before selecting 1,705. Development loaded 257,061 articles before selecting 145 and completed semantic scoring without a reset.
- Both exercised the large loading path. Development's success does not establish that production's timing and resource conditions were reproduced.
- Worker responsiveness loss is strongly supported but unmeasured. Connection reuse and a keep-alive closure race remain hypotheses.
- Application diagnostics may narrow the cause without proving which endpoint sent a TCP reset. Packet tracing remains a separately approved follow-up if necessary.

Reference reports:

1. `20260929_weekly_article_flow_run_4_failure_report.md`
2. `20260929_run_4_connection_reset_investigation.md`
3. `20260929_nws-nn12dev_weekly_article_flow_run_4_resume_reproduction_report.md`

## Scope and boundaries

1. Coordinator changes belong in `ops/weekly-article-flow`.
2. Worker HTTP, process, and semantic initialization diagnostics belong in `worker-node`.
3. Use existing log destinations. Manual coordinator output requires terminal capture; worker output follows its configured logger transports.
4. Do not modify database schemas, application data, semantic eligibility, model choice, keyword caching, queue concurrency, or workflow recovery behavior.
5. Do not introduce retry logic, a new HTTP dispatcher, different connection pooling, or additional status requests.
6. Do not repair alert publication or downstream development errors in this change.
7. Do not activate timers, rerun production work, or deploy as part of implementation.

## Diagnostic controls and data contract

1. Add an optional `WEEKLY_FLOW_DIAGNOSTICS_ENABLED` setting in both packages, disabled when absent. Document accepted boolean values and validate explicit invalid values clearly.
2. Enable both sides for a controlled reproduction. Either side must continue working when the other is disabled or running the previous version.
3. Generate an opaque request ID for each relevant HTTP request. When enabled, send bounded diagnostic headers carrying the request ID, weekly run ID, and known child job ID. The initial start request has no child job ID yet.
4. Treat incoming correlation values as untrusted metadata. Validate format and length; never use them for authorization, routing, or queue ownership.
5. Include UTC time, monotonic duration, event name, process ID, process-instance ID, and available run/job/request identifiers in structured events.
6. Record worker and coordinator Node versions, available Undici version, effective HTTP timeout settings, and available source revision once per diagnostic session. Mark unavailable values explicitly.
7. Omit bodies, article text, SQL text, credentials, cookies, authorization headers, environment dumps, and raw packet contents. Capture only allowlisted error fields and header values needed for correlation or keep-alive interpretation.
8. Limit periodic process samples to once per second during initialization. Use a maximum 15-minute detailed window per semantic job and a fixed event budget, initially 1,000 records per side per window.
9. On reaching a limit, emit one suppression summary and stop detailed collection. Preserve normal errors and a compact final summary. Diagnostic buffers and connection maps must have fixed size limits and expiry.

## Phase 1: coordinator request evidence

- Primary files: `src/http/client.ts`, `src/diagnostics.ts`, `src/stages/workers.ts`, and the configuration/coordinator wiring under `ops/weekly-article-flow`.
- Propagate context for semantic start, exact-job status checks, and cancellation through explicit diagnostic context rather than shared mutable global state.
- Record request start, response headers received, body completion, failure, elapsed time, HTTP status, and nested transport error codes.
- Preserve the existing failed-stage diagnostics and primary error when logging or cancellation fails.
- Investigate passive Undici diagnostic channels supported by the deployed Node runtime before selecting hooks. Associate events with the exact request; ignore unrelated fetch traffic.
- Capture local/remote address and port, connection establishment, and observed socket assignment where supported. Report reuse as `unknown` unless socket identity provides evidence; connection timing alone is insufficient.
- Do not replace native fetch, add a dispatcher, modify headers controlling connection lifetime, or consume request/response streams for diagnostics.
- Unsubscribe listeners and release correlation state when the run finishes or the diagnostic window ends. Diagnostic failures must not cause workflow failure.

## Phase 2: worker HTTP and connection evidence

- Primary files: `worker-node/src/server.ts`, `src/app.ts`, and a small diagnostics module under `src/modules/`.
- Retain access to the HTTP server returned by `app.listen` so effective settings can be observed without changing their values.
- Log arrival of relevant requests separately from response completion. Record premature response closure, request abort, and the associated connection ID.
- Use connection-local IDs and local/remote ports to connect worker events with coordinator evidence. IDs are process-scoped; include the process-instance ID.
- Scope detailed request logs to semantic start and the tracked semantic job's status/cancellation routes. Do not add detailed logging for every worker endpoint.
- A reset can occur before HTTP parsing identifies the route. During the bounded initialization window, retain a small ring of connection lifecycle metadata, then emit relevant or abnormal entries without payloads.
- Confirm passive hook behavior against the deployed Node version. In particular, adding a `clientError` listener can replace default HTTP error handling; do not install one merely to log events.
- Similarly review timeout listeners before use. Prefer passive diagnostic hooks; record a coverage gap if an event cannot be observed without changing default handling.
- Do not write responses, destroy sockets, change timeout settings, or suppress existing handlers from diagnostic callbacks.

## Phase 3: semantic initialization and responsiveness

- Primary file: `worker-node/src/modules/jobs/semanticScorerJob.ts`, with a reusable diagnostic helper for bounded process measurements.
- Pass the existing job ID into diagnostic context without changing the scoring request or result contract.
- Record start/end duration and available counts for:
  1. Database readiness and semantic entity lookup.
  2. Semantic-contract retrieval and processed-ID set construction.
  3. Article retrieval, including associated approval data.
  4. JavaScript filtering/mapping and selected article count.
  5. Keyword workbook loading.
  6. Model initialization or reuse of an already loaded model.
  7. Transition to the first article attempt.
- Use row counts already in memory; do not add database queries or expensive object-size serialization. Keep article-query timing labeled as query/transfer/hydration combined unless existing hooks genuinely distinguish those phases.
- Record RSS, heap used/total, external memory, and process CPU deltas at phase boundaries.
- Measure event-loop delay, utilization, and sample scheduling delay with supported Node performance APIs. Include units and measurement-window duration.
- Event-loop samples cannot execute while the loop is blocked. Allow delayed observations to be collected after it resumes, and do not interpret missing samples as zero delay.
- Aggregate GC count and duration by phase/window if supported; avoid emitting an event for every collection. Treat these as process-wide measurements, not proof that a specific job caused every pause.
- Stop timers, observers, and histograms on success, failure, cancellation, and window expiry. Use unreferenced timers so diagnostics do not keep the process alive.

## Phase 4: verification

1. Test disabled mode: no new detailed events, diagnostic headers, observers, or timers; existing behavior remains unchanged.
2. Test enabled mode for success, malformed responses, connection errors, cancellation, and logging failures. Preserve original outcomes and exactly the existing number of start/poll/cancel calls.
3. Exercise a local HTTP fixture that resets a status connection. Verify request correlation, nested errors, and premature-close evidence. Clearly identify this as an injected failure, not reproduction of the production cause.
4. Test connection reuse and separate connections; verify unsupported fields remain unknown rather than guessed.
5. Compare HTTP behavior with diagnostics enabled and disabled, including malformed requests and idle connection closure. Ensure hooks do not take ownership of default socket/error handling.
6. Use a bounded synthetic stall in tests to check delayed sampling and event-loop measurements. Keep assertions tolerant of scheduler variation.
7. Verify event budgets, redaction, bounded metadata, listener cleanup, and repeated diagnostic windows without resource accumulation.
8. Run root build, worker-node tests, and weekly-flow tests. Worker tests must use an explicitly selected dedicated development test database; never run them against application data.
9. Compare enabled/disabled logging overhead on dev with a controlled fixture. Record event counts and timing/memory differences before attempting a full workflow reproduction.

## Phase 5: operator reproduction and evidence review

1. Deploy to dev through the usual process and explicitly enable diagnostics in both coordinator and worker configurations. Changing the running worker environment requires a planned service restart while idle.
2. Record revisions, runtime versions, server resources, table counts, associated-row counts, and concurrent activity. Distinguish cold model initialization from model reuse.
3. Capture both coordinator output and worker logs. Confirm their clocks agree before comparing timestamps.
4. Run a separately authorized full development workflow. This performs real maintenance and database writes; instrumentation itself does not authorize execution.
5. Correlate each poll with worker request arrival, response completion/closure, socket identity, and initialization/process measurements.
6. Classify evidence explicitly:
   - No recorded worker arrival: HTTP parsing/arrival is unconfirmed, not proof the packet never arrived.
   - Arrival followed by a large processing delay: investigate worker responsiveness.
   - Connection closure while initialization stalls: assess timeout/reuse timing without assuming causation.
   - No reset: preserve timing evidence and report non-reproduction.
7. Disable detailed diagnostics after the agreed observation window. Do not create an unattended retry or reproduction loop.
8. Production observation requires separate operator approval. If the reset mechanism remains unresolved, propose bounded packet tracing as a separate task.

## Completion criteria

- Detailed logging is optional and bounded on both sides.
- A request can be traced from coordinator creation to the latest observable worker/socket event, or its missing evidence is identified explicitly.
- Initialization counts, phase timings, and responsiveness measurements are correlated with the semantic job.
- Existing workflow decisions and HTTP behavior remain unchanged with diagnostics enabled or disabled.
- Builds and relevant tests pass; dev evidence includes logging overhead and limitations.
- No claim of a confirmed TCP reset cause is made without supporting evidence.

## Rollback

- Disable the diagnostic settings and reload affected services only through the normal operator-managed process.
- No database migration or data rollback is required.
- Preserve captured logs for analysis and retain the existing baseline error diagnostics.
