---
created_at: 2026-09-29T19:48:12Z
updated_at: 2026-09-29T19:50:19Z
created_by: hermes (gpt-5.6-sol) nws-nn12prod
modified_by: hermes (gpt-5.6-sol) nws-nn12prod
---

# Run 4 Semantic Status Connection Reset Investigation

## Executive conclusion

The retained evidence does not prove which TCP endpoint emitted the reset or which socket-close path produced it. There was no packet capture, connection-level worker logging, Undici diagnostics, or event-loop-delay telemetry on September 25.

The strongest evidence-supported explanation is:

1. Semantic job `0267` began initialization by retrieving and materializing approximately 260,000 Article rows, joining ArticleApproved rows, and filtering the result in worker-node JavaScript.
2. That work made worker-node's single event loop temporarily unable to service HTTP requests promptly.
3. The coordinator's next status GET was probably sent over a pooled persistent connection while the worker was unresponsive.
4. A keep-alive/socket lifetime interaction then closed or destroyed that connection as worker-node became responsive again, producing `ECONNRESET` at the coordinator.

Steps 1 and the responsiveness loss are strongly supported. Connection reuse is likely but not logged. The keep-alive expiration mechanism is credible and fits the surrounding timing, but it is not proven.

The ordinary 30-second coordinator timeout, Node's 60-second header timeout, and Node's 300-second request timeout did not fire. The worker did not crash, restart, exhaust a configured memory limit, or lose its listening service. A host-level or loopback-network failure is not supported by the retained logs.

Further diagnosis can improve the confidence of the event-loop explanation from high to measured, but proving the precise TCP reset mechanism requires new instrumentation during a future occurrence.

## Scope and non-actions

This investigation was read-only. It inspected:

- weekly coordinator and worker-node source;
- the deployed systemd unit definitions and process metadata;
- `WeeklyArticleFlowRuns.id = 4`;
- retained worker, coordinator, API, PostgreSQL, kernel, and system journals;
- the September 25 pre-run database backup;
- current runtime defaults and retained package-install history;
- historical occurrences of worker-node `ECONNRESET` errors.

It did not restart a service, start or rerun a job, invoke cancellation, alter a queue, change application data, modify configuration, or modify application code.

The only repository change associated with this investigation is this report.

## Incident timing

Times below are UTC with PDT in parentheses.

- `16:09:21.342` (`09:09:21.342 PDT`): worker-node received the semantic-scorer start request.
- `16:09:21.558`: worker-node queued job `0267`.
- `16:09:21.816`: worker-node started job `0267`.
- `16:09:21.823`: semantic initialization began loading articles.
- `16:09:21.918`: the first status GET completed in 287 ms.
- `16:09:24.408`: the second status GET completed in 1,406 ms.
- Approximately `16:09:26.408`: the third status GET began. This time is derived from the configured exponential backoff of 1 second and then 2 seconds, plus the preceding completion time.
- `16:09:33.297`: worker-node logged `Loaded articles: 1705`.
- `16:09:33.303`: the coordinator logged the third GET failure after 6,895 ms with nested code `ECONNRESET`, `fetch failed`, and `timedOut=false`.
- `16:09:33.305`: worker-node received the cancellation request.
- `16:09:33.306`: cancellation returned HTTP 200 in 1 ms.

The failed request's derived start time exactly follows the configured two-second polling delay. The reset occurred about 6 ms after the article-load completion log.

The preceding status GET's 1,406 ms duration is also abnormal for a small local status response and shows worker responsiveness was already degrading during initialization.

## Confirmed findings

### The coordinator did not reach its HTTP timeout

`ops/weekly-article-flow/src/http/client.ts` implements a 30,000 ms request timeout and separately records whether its timeout callback fired.

The failed request ended after 6,895 ms and recorded `timedOut=false`. Its nested error was `ECONNRESET`, not an abort or timeout exception.

The 14,400-second semantic-stage deadline was also hours away. Neither coordinator timeout can explain the reset.

### Worker-node did not configure a shorter request timeout

`worker-node/src/server.ts` starts Express with `app.listen(...)` and does not override HTTP server timeout or keep-alive settings.

The incident worker used Node.js `24.20.0`. The corresponding defaults are:

- request timeout: 300,000 ms;
- headers timeout: 60,000 ms;
- inactive socket timeout: disabled;
- keep-alive timeout: 5,000 ms;
- keep-alive timeout buffer: 1,000 ms.

The request and header timeouts are far longer than 6,895 ms. They also govern request receipt rather than a long-running job's business deadline.

The approximately six-second server keep-alive socket timer is relevant to the leading hypothesis, but 6,895 ms is not a direct match. That duration starts with the third request. The interval from the preceding completed response to the reset was approximately 8,895 ms.

A keep-alive explanation therefore requires delayed timer handling and a particular ordering between pending socket input and the overdue timer. It cannot be declared confirmed from the duration alone.

### Semantic initialization retrieves far more than 1,705 rows

`worker-node/src/modules/jobs/semanticScorerJob.ts`, in the article-loading path around lines 378-397, builds a database `where` clause only when explicit article-ID bounds are supplied. Run 4 supplied no bounds.

It then performs `Article.findAll` with an `ArticleApproved` include and filters already-processed and unusable rows in JavaScript. The log value `1705` is the post-filter candidate count, not the number retrieved from PostgreSQL.

The September 25 pre-run backup provides an exact pre-cleanup scale:

- `Article.csv`: 260,437 data rows and 159,637,646 uncompressed bytes;
- `ArticleApproved.csv`: 11,107 data rows and 17,157,828 uncompressed bytes.

Run 4 then recorded 2,069 deleted old articles and 1,562 newly saved RSS articles. In the absence of another article mutation between those stages, that implies approximately 259,930 Article rows at semantic startup.

The CSV byte counts are not JavaScript heap measurements. Sequelize model instances, strings, join duplication, intermediate arrays, and garbage collection can consume materially more memory and CPU than the on-disk CSV representation.

### Asynchronous database access does not make all initialization work non-blocking

Waiting for PostgreSQL network I/O is asynchronous. Receiving and decoding a large result, constructing Sequelize instances and associations, filtering approximately 260,000 objects, creating mapped objects, and garbage collection all execute in worker-node's JavaScript process.

That work can monopolize the event loop even though the initiating API is `await Article.findAll(...)`.

The logs do not contain direct event-loop-delay or GC measurements. Event-loop starvation is therefore an inference, not a directly measured metric.

### Worker-node remained alive and listening

The same worker PID handled the semantic start, status requests, failed interval, and cancellation. The installed unit showed no restart for the incident process, and no stop/start sequence appears in the incident window.

The cancellation POST was accepted about 2 ms after the reset and completed in 1 ms. This rules out a sustained listener outage.

The unit had no configured memory limit. There was no kernel OOM event, process crash, core dump, or systemd restart at the incident time.

The current systemd memory peak for the worker's continuously running unit is approximately 2.13 GiB, but that metric is cumulative since startup and cannot be attributed specifically to job `0267`.

### No host or PostgreSQL fault was retained for the incident window

The retained kernel and system journals contain no OOM, segmentation fault, NIC transition, loopback error, TCP warning, systemd failure, or host reboot around `16:09:33`.

The PostgreSQL log contains no error at that time. PostgreSQL statement-duration logging was disabled, `log_statement` was `none`, and `pg_stat_statements` was not installed. Consequently, the database portion of the large `findAll` cannot be separated retrospectively from client decoding and Sequelize hydration.

A normal TCP reset is not ordinarily recorded in the kernel journal, so the absence of a kernel message does not reveal the reset's sender.

### Existing worker access logging omits incomplete requests

`worker-node/src/app.ts` logs requests only on the response `finish` event. It does not log request arrival, socket identity, reuse, timeout, error, premature response close, or the HTTP server's `clientError` event.

There is no completed-request log for the failed status GET. This can mean the worker never parsed it or parsed it but never finished the response. Existing logs cannot distinguish those cases.

### The pattern occurred before Run 4

The retained portal API log contains six earlier errors with the message `Error retrieving latest worker-node job: read ECONNRESET`. Three recent instances correlate closely with worker initialization completing a large article-selection phase:

- August 24 at `13:08:57 UTC`: API `ECONNRESET`; worker logged `Found 2457 articles to process` at `13:08:57.235`.
- September 7 at `13:16:52 UTC`: API `ECONNRESET`; worker logged `Found 0 articles to process` at `13:16:52.669` after loading large assignment/relevance sets.
- September 16 at `11:45:35 UTC`: API `ECONNRESET`; worker logged `Found 4000 articles to process` at `11:45:35.292`.

These were requests from the separate portal API client and involved different worker job paths; they were not Run 4 coordinator requests. The recurrence strongly supports worker responsiveness loss during large result materialization or selection. It does not prove every occurrence used the same socket-close path.

## Connection reuse assessment

The weekly coordinator uses Node's native `fetch`. In Node 24 this is implemented by Undici, whose global dispatcher pools connections by origin.

The polls targeted the same `127.0.0.1:8003` origin. The failed poll began approximately two seconds after the previous response completed, which is within a plausible reuse interval for the advertised worker keep-alive policy and Undici's keep-alive handling.

Connection reuse is therefore likely.

It is not confirmed because neither side logged:

- client and server TCP ports;
- socket creation versus reuse;
- response `Connection` and `Keep-Alive` headers;
- Undici dispatcher or connection events;
- server socket timeout, close, and error events.

The exact request may have used the preceding socket or a new socket. Retained application logs cannot decide.

## Leading mechanism and confidence

### High-confidence portion: initialization-associated event-loop starvation

Confidence: high, but not directly measured.

Supporting evidence:

- the worker retrieved and hydrated an approximately 260,000-row Article result plus an included relation before reducing it to 1,705 candidates;
- the second trivial status request already took 1,406 ms;
- the third status request remained unresolved during the remainder of article loading;
- the reset was observed 6 ms after the load-completion log;
- the worker immediately handled a fresh cancellation request once initialization yielded;
- retained historical resets coincide with similar large article-selection completion logs.

This evidence is stronger than a generic network-failure explanation.

### Medium-confidence portion: reused keep-alive socket expired or was destroyed during the stall

Confidence: medium.

A coherent sequence is:

1. The preceding status response leaves a persistent socket idle.
2. The coordinator sends the next GET approximately two seconds later, probably on that socket.
3. Worker-node is too busy to parse or service the request promptly.
4. The worker's approximately six-second keep-alive socket deadline becomes overdue while the event loop is delayed.
5. When the event loop becomes responsive, socket timeout/close handling wins a race with pending request processing, and the client sees `ECONNRESET`.
6. A new connection carries the cancellation POST successfully.

The timing and behavior are consistent with this sequence. They do not prove it. If worker-node had already parsed the GET, the prior idle timer should have been reset. Node/libuv phase ordering and the socket state at the incident moment are not observable from retained logs.

Undici also applies its own keep-alive thresholds. Without dispatcher diagnostics, it is not possible to determine whether the client or server initiated connection closure or whether a stale pooled socket was selected.

### Lower-confidence alternatives

#### Host or loopback network fault

Confidence: low.

The request used loopback, there was no proxy between the services, other worker activity continued, cancellation succeeded immediately, and no host/network fault appears in retained logs.

#### Worker crash, restart, or OOM kill

Confidence: effectively ruled out for this event.

The PID continued, the listener answered immediately, and no process or kernel failure was logged.

#### Standard client, request, or header timeout

Confidence: ruled out.

The elapsed time and `timedOut=false` do not match the coordinator timeout, and server request/header defaults are much longer.

#### Explicit application socket destruction

Confidence: low but not fully excludable.

No application code path was found that intentionally destroys this status socket. The worker does not log server `clientError` or socket events, so an unobserved runtime-level destroy remains possible.

#### Garbage collection or host CPU contention as the primary stall source

Confidence: plausible contributor, unmeasured.

Large object materialization can trigger long GC pauses, and the host had no retained per-process CPU, run-queue, or GC telemetry. No `sysstat` or `atop` archive covers the event.

#### Queue-store parsing

Confidence: contributor at most, not the leading explanation.

Each status lookup reads and parses the JSON queue store. The current file is about 7.4 MiB and parses in tens of milliseconds in a separate process. It can add latency, but its observed scale does not independently explain the nearly seven-second failure. Its exact September 25 size and parse latency were not logged.

## Missing evidence

The following evidence did not exist or was not retained:

- a loopback packet capture showing request arrival and FIN/RST direction;
- socket four-tuples linking coordinator and worker events;
- confirmation that the failed poll reused the prior connection;
- worker logs for request arrival, socket timeout, close, error, or `clientError`;
- coordinator Undici dispatcher, connection, and socket-reuse diagnostics;
- event-loop-delay and utilization histograms;
- V8 GC pause events and heap telemetry;
- timing boundaries for SQL execution, row transfer/decoding, Sequelize hydration, JavaScript filtering, and post-load GC;
- PostgreSQL statement timing for the `Article.findAll` query;
- historical per-process CPU, RSS, page-fault, or run-queue data;
- the effective HTTP server timeout values logged by the incident process;
- a persisted deployed-source hash and Node/Undici version in each job record.

Because this evidence is absent, the exact reset sender and close call path cannot be recovered retrospectively.

## Instrumentation required for a definitive diagnosis

A future occurrence can be proven only by correlating packet, socket, and event-loop evidence.

### TCP evidence

Capture loopback traffic in a bounded ring buffer or use an equivalent eBPF trace. Record:

- timestamped SYN, request payload arrival, ACK, FIN, and RST packets;
- source and destination ports;
- which endpoint emitted the RST;
- retransmissions and zero-window behavior.

Packet evidence answers who reset the connection, not why.

### Worker socket and HTTP lifecycle evidence

Log, with a connection ID and four-tuple:

- HTTP server `connection`, `request`, and `clientError` events;
- socket `timeout`, `end`, `close`, and `error` events;
- whether close was associated with an active request;
- request arrival separately from response `finish`;
- response `close` when `finish` did not occur;
- effective `keepAliveTimeout`, `keepAliveTimeoutBuffer`, `headersTimeout`, `requestTimeout`, and inactive timeout.

This evidence connects the packet-level reset to the worker's socket lifecycle.

### Coordinator/Undici evidence

Record:

- Undici request creation, connection establishment, headers sent, headers received, and request error diagnostics;
- whether a socket was new or reused;
- local and remote ports;
- full nested error fields and abort reason;
- request-start, socket-assignment, header, body, and failure timings;
- effective dispatcher and keep-alive settings.

### Event-loop, GC, and initialization evidence

Record:

- `monitorEventLoopDelay` percentiles and maxima;
- event-loop utilization around each initialization phase;
- V8 GC pause duration and type;
- process RSS, heap used, heap total, and external memory;
- article query start, first row, last row, hydration complete, filter start, filter complete, and selected-count timestamps;
- rows and approximate bytes transferred;
- database statement duration and query identifier.

This evidence would verify whether the worker was unable to process the GET and identify whether SQL execution, row decoding, Sequelize hydration, JavaScript filtering, or GC dominated the stall.

## Final assessment

Run 4's status reset is best classified as an initialization-correlated worker responsiveness failure with a probable persistent-connection timeout/closure race.

Confirmed:

- the failure was `ECONNRESET`, not the coordinator's timeout;
- it occurred during a large, unbounded semantic article load;
- the worker remained alive and immediately accepted cancellation;
- no host, kernel, PostgreSQL, or service crash was retained;
- similar worker resets previously coincided with large article-selection completion.

Strongly supported but not directly measured:

- semantic initialization starved worker-node's event loop.

Plausible but unproven:

- the failed GET reused the prior connection;
- an overdue worker keep-alive timeout or related pooled-socket race generated the reset.

Unknown from retained evidence:

- which endpoint sent the TCP RST;
- whether the GET reached the worker's HTTP parser;
- the exact socket-close call path;
- the relative contributions of SQL transfer, Sequelize hydration, filtering, and GC.

No additional retrospective log review can resolve those final unknowns. Instrumentation is required to establish the exact transport mechanism on a future occurrence.
