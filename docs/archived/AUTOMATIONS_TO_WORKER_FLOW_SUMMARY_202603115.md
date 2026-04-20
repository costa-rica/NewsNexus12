# Automations to Worker Flow Summary

This document summarizes the current automation flow across the portal, API, and worker services. It is intended to help engineers assess what the worker-python queueing infrastructure would need in order to support the same user-facing automation experience that is already working with worker-node.

The emphasis here is on behavior and system responsibilities, not Node.js-specific implementation details. The goal is that a Python implementation can adopt the same operational contract even if the internal architecture differs.

## 1. Current user-facing flow

1. A user opens the automations page in the portal dashboard.
2. The page presents multiple collapsible automation sections such as:
   - Google RSS
   - State Assigner
   - Article Request Spreadsheets
3. A worker-backed automation section has three major UI parts:
   - a start button
   - a reusable status panel showing the latest job for that workflow
   - any workflow-specific inputs or files
4. When the user clicks the start button:
   - the portal sends an authenticated request to the API
   - the API forwards the request to the appropriate worker service
   - the worker service enqueues the job and returns metadata such as `jobId`, `status`, and `endpointName`
5. The portal shows immediate feedback in a modal using `ModalInformationOk`.
6. The portal then uses the reusable job status panel to:
   - refresh the latest job state
   - display queued/running/completed/failed/canceled status
   - cancel a queued or running job when supported

This flow is not meant to be user-specific. It is intentionally operational and shared. Any authorized user should be able to see what the latest job is for a workflow and whether it is running.

## 2. Spirit of the automations page

The automations page at `portal/src/app/(dashboard)/articles/automations/page.tsx` is becoming a control surface for background workflows, not just a collection of buttons.

Its design direction is:
- each workflow gets its own collapsible section
- each workflow section can expose:
  - launch controls
  - parameters
  - file upload/download helpers
  - live-ish job status
  - cancel capability when available
- shared UI patterns should be reused across sections so users get a consistent experience

The reusable status component is the important piece here. It is currently implemented for worker-node in `portal/src/components/automations/WorkerNodeJobStatusPanel.tsx`. That component is meant to be reused for:
- current worker-node workflows such as Google RSS and State Assigner
- future worker-node workflows such as Semantic Scorer
- future worker-python workflows if worker-python exposes a compatible queue/job contract
- potentially deduper if its worker-side queueing contract is aligned

The practical requirement is that the worker service must expose enough queue/job information for the portal to render a stable, generic status panel.

## 3. Current worker-node pattern

worker-node supports the portal automation experience because it has a persistent queue model and queue-info endpoints designed around user-visible operational state.

Key characteristics:
- jobs are enqueued with a unique `jobId`
- each job records:
  - endpoint/workflow identity
  - status
  - created/start/end timestamps
  - optional failure reason
- queue state is persisted to a JSON file:
  - `queue-jobs.json`
- queue inspection and cancellation happen through explicit endpoints

Current queue-info capabilities include:
1. check one job by `jobId`
2. retrieve queue summary and currently running/queued jobs
3. cancel a job by `jobId`
4. retrieve the latest job for a given workflow endpoint name

That last capability matters because the portal status panel is workflow-based. It needs to ask questions like:
- what is the latest Google RSS job?
- what is the latest State Assigner job?

Without a stable workflow identifier plus latest-job lookup, the portal would have to rely on temporary in-browser state, which is fragile after reloads.

## 4. Why queue-jobs.json matters

The specific file format is not the main point. The important point is persistent job state that survives beyond a single in-memory request lifecycle.

The file currently enables:
- a record of the latest job for each workflow
- status lookups after page refresh
- queue summaries independent of one user session
- cancellation by durable `jobId`
- operational transparency for multiple authorized users

A Python implementation does not need to use JSON specifically. It could use:
- a JSON file
- SQLite
- another lightweight persistent store

What matters is that the worker service maintains durable job records with enough metadata to answer the same queries.

## 5. What the portal reusable status panel expects

The reusable panel is currently designed around these concepts:

1. workflow identity
   - a stable endpoint or workflow name such as `/request-google-rss/start-job`
2. latest-job lookup
   - returns the newest job record for that workflow
3. job status values
   - queued
   - running
   - completed
   - failed
   - canceled
4. timestamps
   - created
   - started
   - ended
5. failure/cancel reason when available
6. cancel action
   - by `jobId`
7. refresh action
   - fetch latest known state for the workflow

The current panel is intentionally simple. It is not a log viewer or deep observability tool. It is a user-facing workflow status surface.

## 6. Recommended cross-worker contract

If worker-python is refactored to align with worker-node, the target behavior should be something like this.

### Job record shape

At minimum, each job record should support:
- `jobId`
- `endpointName` or another stable workflow identifier
- `status`
- `createdAt`
- `startedAt` if started
- `endedAt` if finished
- `failureReason` if failed or canceled

Optional but useful:
- a normalized `outcome`
- job parameters snapshot
- human-readable workflow label

### Worker endpoints

At minimum, a worker-backed automation workflow should support:
1. `start-job`
   - enqueue work
   - return `jobId`, `status`, and workflow identifier
2. `latest-job`
   - return the latest job record for a workflow identifier
3. `check-status/:jobId`
   - return a single job record
4. `cancel-job/:jobId`
   - request cancellation for queued or running jobs
5. optional queue summary endpoint
   - useful for operations and dashboards

### Behavioral expectations

- `start-job` should not block until the full workflow finishes
- `start-job` should return quickly after enqueueing
- the worker should distinguish queued vs running vs completed vs failed vs canceled
- cancellation should be explicit and reflected in persisted job state
- latest-job lookup should return `null` when no matching jobs exist

## 7. API layer responsibilities

The API exists between the portal and the workers for several reasons:
- the portal keeps one authenticated base URL
- worker service base URLs stay private to the backend
- authentication and authorization remain centralized
- worker service contracts can evolve without exposing every worker directly to the browser

For automation workflows, the API should:
1. accept authenticated portal requests
2. validate or pass through workflow-specific inputs
3. forward start-job requests to the worker
4. forward latest-job/check-status/cancel requests to the worker
5. preserve worker response payloads closely enough that the portal can render status and feedback consistently

This same pattern should apply whether the downstream worker is Node.js or Python.

## 8. Assessment questions for worker-python engineers

If worker-python is being evaluated for parity with worker-node, these are the key questions:

1. Does worker-python have a durable job store today, or is it mostly in-memory?
2. Can worker-python identify jobs by a stable `jobId`?
3. Can worker-python identify jobs by workflow type or endpoint name?
4. Can worker-python answer “what is the latest job for workflow X?” after process restarts or page reloads?
5. Can worker-python cancel both queued and running jobs in a controlled way?
6. Can worker-python expose timestamps and failure reasons in a normalized format?
7. Can worker-python preserve enough queue/job history for multiple users to inspect the most recent workflow state?

If the answer to several of these is no, then the refactor likely needs to start at the queue/job model rather than just adding endpoints around the current implementation.

## 9. Assessment guidance for worker-python refactor

The objective is not to copy worker-node line-for-line. The objective is to support the same product behavior.

The refactor should aim for:
- a durable queue/job store
- stable workflow identifiers
- stable job identifiers
- a small queue-info API surface
- cancellation semantics
- shared status vocabulary

The implementation can remain Python-native. For example:
- threading, asyncio, subprocesses, task runners, or in-process orchestration can all work
- file-based or database-backed persistence can both work

What cannot be skipped is the operational contract required by the portal:
- start the job
- know which job was started
- find the latest job for a workflow later
- inspect its status
- cancel it when appropriate

## 10. Suggested next steps

1. Compare worker-python’s current job manager fields and lifecycle to the worker-node job record lifecycle.
2. Decide on a durable job state store for worker-python.
3. Introduce a normalized workflow identifier for each automation-capable worker-python task.
4. Define Python queue-info endpoints that match the behavioral contract described above.
5. Validate that the existing reusable portal status panel can work with worker-python via the API with little or no UI specialization.

If that is successful, the automations page can support both worker-node and worker-python workflows using the same general pattern and the same user expectations.
