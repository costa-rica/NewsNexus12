---
created_at: 2026-09-29T21:27:45Z
updated_at: 2026-09-29T21:27:45Z
created_by: claude (opus-5.5) macbook-air
modified_by: claude (opus-5.5) macbook-air
---

# Assessment: weekly flow diagnostics plan v02

Assessed plan: `20260929_weekly_flow_diagnostics_plan_v02.md`

Prior assessment: `20260929_weekly_flow_connection_diagnostics_plan_assessment_claude.md`

## Summary

v02 addresses the v01 concerns well. It adds a cheap experiment first, gates the complex instrumentation on evidence, drops the connection ring from the baseline, and fixes the setting name.

After v02 was written, the operator set a new direction:

- Recreate the reset on nws-nn12dev first, so the cause can be identified.
- Dev runs are approved now, as often as needed.

Measured against that goal, v02 is likely to stop before recreating anything:

- It keeps only synthetic stalls in the required matrix.
- It stops on non-reproduction.
- It caps full dev workflow runs at two.
- It has no repeatable path that runs the real semantic job.
- It does not vary the most likely production-versus-dev difference: the worker process's state when semantic loading began.

## Operator direction recorded for the planner

These operator statements resolve items v02 left to separate approval:

1. Dev experiments and dev workflow runs are authorized now and may repeat as needed.
2. The goal is to recreate the error on dev before choosing a fix.

This makes several v02 limits unnecessary. They were written for the absence of approval, which is no longer the case.

## Assessment criteria met

Per `docs/PLAN_AND_VET.md`, this assessment is written because:

- The plan will probably not achieve the operator's goal. Its path ends in a non-reproduction report (concerns 1 to 3).
- Its caps now contradict an explicit operator decision (concern 4).

## Concerns

### 1. Synthetic stalls alone are unlikely to recreate the reset

The required Stage 0 matrix uses only synthetic CPU and I/O-interleaved stalls. The real Sequelize article load is marked optional and needs a separately agreed window.

- Dev already ran the real 257,061-row load without a reset. A synthetic stall is a weaker model of that load, not a stronger one.
- The preliminary Mac run of simple CPU stalls produced no reset. That is not evidence about Ubuntu, but it gives no reason to expect easy success.
- Under evidence gate 2, a synthetic non-reproduction stops the matrix. The plan then ends without testing the real trigger.

Recommendation: keep the synthetic matrix as a quick first pass. Make the real-load cases required rather than optional. The operator has already provided the dev window.

### 2. No repeatable real-job reproduction path

v02 offers two extremes: an isolated fixture that must not call the real worker, and full weekly workflow runs capped at two.

A middle path is missing and is the most direct way to recreate the error:

- Start the real semantic job on the dev worker with `POST /semantic-scorer/start-job {}`, the same empty body the coordinator sends.
- Poll `/queue-info/check-status/<jobId>` with a small script that copies the coordinator exactly. It should use native `fetch`, the same pooled origin, and the 1 s then 2 s backoff.
- Repeat as often as needed. Each run reloads the full Article table, because the 134 unscored dev articles are reselected every time.
- Unlike full workflow runs, this avoids backup, deletion, RSS ingestion, state assignment, and AI Approver. Its only writes are semantic contracts for newly scorable articles.

This loop runs the exact production trigger in a minute or two, and can run dozens of times.

### 3. The main environmental difference is not varied

The investigation and dev reports list differences between the two environments but do not act on them. The biggest one is the worker process's state when semantic loading began.

- In production, semantic job `0267` started in the same worker process moments after RSS job `0266` finished. That job ran about four hours, ran 567 queries, and added 1,562 articles.
- The production worker unit's cumulative memory peak was about 2.13 GiB. The weekly coordinator unit recorded a 2.8 GB peak.
- On dev, RSS added 3 articles. The worker went into semantic loading with a much smaller, calmer heap.
- A long-running process with a large heap has longer garbage-collection pauses. That can turn one long stall into the multi-iteration stall a keep-alive race may need.

Stage 0 and the real-job loop should vary this condition. Options:

- Run semantic immediately after a heavy RSS job, or another large job, in the same worker process.
- Run semantic on a worker that has been up for days, and compare with a freshly restarted one.
- Pre-inflate the worker heap, for example with a dev-only large allocation retained before the job starts. This must be clearly labelled as an experiment aid.

Other differences worth varying: the ArticleApproved row count at load time, the dev host's CPU and memory limits compared with production's, and the Node version (24.20.0 in production).

### 4. Stop rules conflict with the operator's direction

These v02 limits no longer match what the operator authorized:

- "Stop after two runs at most" for full dev workflow runs.
- "No automatic rerun after the budget ends" and a ten-minute overall deadline, applied to all reproduction work.
- Evidence gate 2: stop the matrix on non-reproduction.

Bounded individual cases remain sensible. What the plan needs is a reproduction campaign with an explicit budget the operator can extend. For example:

- Up to N real-job runs per condition, where N is proposed by the planner (for example, 20).
- A condition matrix covering heap state, process age, and backlog size.
- A report after each batch, so the operator can decide whether to continue.

### 5. Minimal worker measurements should come before the real-job loop

v02 places worker event-loop and memory sampling behind a further vetted plan or todo, after the experiment. For the real-job loop, these measurements are what make a reproduction explainable.

- Without them, a reproduced reset would repeat the Run 4 situation: a reset observed, with the stall inferred rather than measured.
- The v02 "Minimal runtime evidence" section already defines a small, safe scope: initialization start and end, first attempt, event-loop delay, and memory, sampled at most once per second.

Recommendation: implement that minimal worker scope, plus a bounded loopback capture on the dedicated worker port, before the real-job loop. The conditional transport extension stays gated as v02 describes.

## Items that remain sound

- Separate processes, a dedicated port, bounded cases, and recorded runtime versions for the synthetic fixture.
- No `clientError` or timeout handler ownership, no dispatcher replacement, and no header changes.
- Diagnostics default off, with redaction, suppression, and cleanup rules.
- Poll resilience and the SQL rewrite are kept as separate proposals. The SQL rewrite should wait until reproduction work finishes, because it would remove the trigger being studied.

## Recommended revision

A v03 would:

1. Record the operator's authorization and the goal of reproducing on dev.
2. Keep Stage 0 synthetic cases as a short first pass that does not end the effort.
3. Add a real-job reproduction loop against the dev worker, using an exact coordinator-cadence poller.
4. Implement minimal worker event-loop and memory sampling, and loopback capture on the dev worker port, before that loop.
5. Add a condition matrix covering worker heap state, process age, post-RSS timing, and runtime version.
6. Replace the two-run cap and stop-on-non-reproduction with a per-batch budget that the operator can extend.

## Open Questions

### 1. Polling fix before Friday

The operator's direction covers dev reproduction. It does not settle production: the timer still fires 2026-10-02 at 5:00 AM Pacific. Should the P0 poll-resilience fix proceed in parallel for that run?

#### Operator Response

(claude) Recommend yes. It does not interfere with dev reproduction, which can use the unchanged coordinator code or its own poller.

### 2. Friday run without the fix

If the polling fix is not ready, should the Friday timer run as scheduled, or be replaced by a supervised manual run?

#### Operator Response

### 3. Dev sudo for packet capture

Loopback capture needs `tcpdump` privileges on nws-nn12dev. Is the dev agent allowed to run it with sudo, limited to the worker port and a set time?

#### Operator Response

### 4. Worker restarts on dev

Varying process age and heap state may need dev worker restarts, or runs on a long-lived worker. Are dev worker service restarts approved?

#### Operator Response

(claude) Recommend yes, while dev is idle.
