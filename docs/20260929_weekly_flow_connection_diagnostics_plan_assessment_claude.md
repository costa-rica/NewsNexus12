---
created_at: 2026-09-29T21:20:45Z
updated_at: 2026-09-29T21:20:45Z
created_by: claude (opus-5.5) macbook-air
modified_by: claude (opus-5.5) macbook-air
---

# Assessment: weekly flow connection diagnostics plan

Assessed plan: `20260929_weekly_flow_connection_diagnostics_plan.md`

Reference reports:

1. `20260929_weekly_article_flow_run_4_failure_report.md`
2. `20260929_run_4_connection_reset_investigation.md`
3. `20260929_nws-nn12dev_weekly_article_flow_run_4_resume_reproduction_report.md`

## Summary

The plan is careful and its safety boundaries are sound. It is not the right next step as written.

- It depends on the reset recurring during an instrumented dev run. Dev has already run the same large load once without a reset.
- It builds heavy instrumentation before any cheap test has checked the leading mechanism.
- Its scope rule against retry logic delays the P0 fix, even though that fix does not depend on the diagnosis.
- Phase 3 instruments code that the reports already recommend replacing.

Recommendation: fix polling now, run a small reproduction on the dev server first, and use the result to cut this plan down.

## Assessment criteria met

Per `docs/PLAN_AND_VET.md`, this assessment is written because:

- The plan will probably not meet its objective. It cannot capture a transient event that does not recur (concern 1).
- The plan poses risks to existing functionality. It adds passive hooks to the worker HTTP server and headers to coordinator requests in the service production relies on (concern 4). Its no-retry scope also leaves production exposed (concern 2).
- The plan partly duplicates planned work. Phase 3 times a loading path the reports recommend removing (concern 3).
- The plan uses a naming convention that does not fit worker-node (concern 6).

## Concerns

### 1. The plan relies on a recurrence it cannot cause

Phases 1 to 3 only produce useful evidence if the reset happens while diagnostics are enabled.

- Dev already loaded 257,061 Articles with the same code and got no reset.
- Phase 5 reruns that same full workflow with logging added. There is no reason to expect a different result.
- Every full dev run does real maintenance and database writes. The last one also failed downstream at the state assigner and AI Approver.
- The plan has no step for engineering the trigger conditions and no rule for when to stop trying.

If the reset does not recur, the instrumentation only confirms that the event loop stalls. The investigation already rates that as strongly supported.

### 2. The no-retry scope delays the P0 fix

The failure report ranks retrying transient status-poll failures, without cancelling active work, as P0. That fix is valid whatever sent the reset.

- The plan's scope says: "Do not introduce retry logic".
- The timer fires Fridays at 5:00 AM Pacific. The next run is 2026-10-02.
- If the P0 fix waits for the diagnostics work, production stays exposed to the same failure.

Keeping retries out of this change is reasonable to keep diagnostics clean. The plan should say the P0 fix proceeds separately and in parallel, not that retries are out of bounds.

The plan and the failure report also need to agree on one sequencing point. With retries in place, a real reset would appear as a retried poll rather than a failed run. The coordinator's per-attempt retry diagnostics would then be a cheap long-term way to detect future occurrences in production.

### 3. Phase 3 instruments code that should be replaced

The trigger is `createFilteredArticlesArray` in `worker-node/src/modules/jobs/semanticScorerJob.ts`. Its unbounded `Article.findAll` materializes about 260,000 rows and then filters in JavaScript. The dev report recommends moving that filter into SQL with `NOT EXISTS`.

- That rewrite removes the stall at its source, whatever the reset mechanism is.
- Five-way phase timing of the current query becomes throwaway once the query is replaced.
- Phase 3 should keep only what outlives the rewrite: event-loop delay and memory sampling around the semantic job.

This does not argue against measuring. It argues against building detailed timing around a query that is planned for removal.

### 4. The heaviest instrumentation should wait for cheaper evidence

Phases 1 and 2 cover Undici diagnostics channels, per-request correlation headers, and a worker connection ring buffer. Together these are the most complex and riskiest parts of the plan.

- The plan correctly warns that `clientError` and timeout listeners can change default HTTP handling. That risk only exists because of this design.
- One question drives the whole diagnosis: which endpoint sent the reset, and when. A loopback packet capture on dev answers that directly, with no code change.
- The plan treats packet tracing as a last resort that needs separate approval. On dev it is the cheapest decisive tool, so it should come first.

### 5. A dev-server test should come first

A small standalone test on nws-nn12dev can check the leading keep-alive race in minutes. The test is:

- A worker-like HTTP server and a polling `fetch` client, running as separate processes.
- The server's Node version (24.20.0) on the dev server's Ubuntu.
- A pooled keep-alive connection, the production polling schedule (1 s then 2 s), and a server stall that outlasts the roughly 5 s keep-alive window.
- Several stall shapes: a single CPU block, a chunked CPU block, and a real read-only Sequelize `findAll` over the dev Articles table. The last matches production's mix of database I/O, object building, and garbage collection.
- Optionally, a bounded `tcpdump` on loopback port 8003 to show which side sent the reset.

The outcome decides how much of the plan is needed:

- If the test resets, the mechanism is narrowed quickly. The plan can shrink to confirming it, choosing a fix, and adding a regression test.
- If it does not reset, the simple keep-alive theory weakens. That makes the P0 retry and the SQL rewrite even clearer priorities.

A preliminary run of this test on the operator's Mac workstation (macOS, Node 24.11.0) produced no reset under simple CPU stalls. That result says nothing about the Ubuntu servers and is not evidence either way. The first attempt showed one design pitfall: client and server in the same process share one event loop, which invalidates the test.

### 6. Diagnostics setting name in worker-node

The plan adds `WEEKLY_FLOW_DIAGNOSTICS_ENABLED` to both packages.

- worker-node serves the portal API as well as the weekly flow. The investigation found six earlier `ECONNRESET` errors from the portal API client.
- A weekly-flow name misdescribes what the worker setting controls.
- worker-node settings use generic names such as `LOG_MAX_FILES` and `PATH_TO_LOGS`.

Suggestion: keep the weekly-flow name in the coordinator. Use a worker-scoped name such as `WORKER_HTTP_DIAGNOSTICS_ENABLED` in worker-node.

### 7. Phase 4 synthetic stall test design

Phase 4 step 6 uses a synthetic stall to check event-loop measurements. The plan should state two things:

- The stalling server and the measuring or requesting client must run in separate processes.
- A single synchronous block does not advance Node's loop clock until the block ends. Tests should also cover chunked or I/O-interleaved stalls.

## Recommended revision

A v02 of the plan, or a split into separate plans, would:

1. State that the P0 poll-resilience fix proceeds now, in parallel, under its own plan.
2. Add a Phase 0: the dev-server test described in concern 5, with an optional loopback capture. Report its result before starting Phase 1.
3. Make Phases 1 and 2 conditional on the Phase 0 result, and reduce them to the questions still open.
4. Reduce Phase 3 to event-loop delay, event-loop utilization, and memory sampling. Move the SQL-side eligibility rewrite into its own plan.
5. Give Phase 5 a stop rule, such as one or two instrumented dev runs, then report non-reproduction and stop.
6. Rename the worker-node setting.
7. Add the separate-process and loop-clock notes to Phase 4.

## Open Questions

### 1. Polling fix before Friday

Should the P0 poll-resilience fix be planned and shipped before the 2026-10-02 scheduled run, independent of this diagnostics work?

#### Operator Response

(claude) Yes. It is safe whatever caused the reset, and the evidence already supports it.

### 2. Friday timer if the fix is not ready

If the polling fix is not deployed by Friday, should the timer run as scheduled, or be disabled in favor of a supervised manual run?

#### Operator Response

### 3. Dev loopback packet capture

Is a bounded `tcpdump` on loopback port 8003 on nws-nn12dev acceptable during the Phase 0 test?

#### Operator Response

(claude) Recommend yes. Dev only, loopback only, a time-limited capture of headers only.

### 4. Semantic SQL rewrite priority

Should moving semantic eligibility filtering into SQL become its own plan now, since it removes the suspected stall at its source?

#### Operator Response

(claude) Yes. It also cuts memory use and weekly runtime.
