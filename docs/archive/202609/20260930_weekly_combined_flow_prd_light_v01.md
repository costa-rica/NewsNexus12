---
created_at: 2026-10-01T00:16:03Z
updated_at: 2026-10-01T16:47:31Z
created_by: codex (gpt-6) nicksmacbookair
modified_by: codex (gpt-6) nicksmacbookair
---

# Weekly Combined Flow PRD Light

## Purpose

- Build `ops/` modules for Ubuntu 24.04.5 LTS dev and production servers.
- Start runs with systemd `.timer` and `.service` units.
- Design each phase with the operator.

## Operator collaboration

1. Agree on TypeScript coordinator flow before coding.
2. Review each module's OS commands, triggers, monitoring, outcomes, and logs.
3. Test each module manually on development.
4. Read `docs/weekly-article-flow-v01/` only for permission, ownership, service, and configuration warnings; never as a design.

## Required phase order

1. Clear `ArticleDuplicateAnalyses` rows; keep the table and schema.
2. Back up the database with db-manager.
3. Delete old articles with db-manager's default command.
4. Collect Google News RSS articles with worker-node; record the cohort.
5. Run semantic scoring for that cohort.
6. Run AI state assignment for at least the collected count.
7. Run worker-python AI Approver V02 for every eligible collected article.

V02 needs description fallback and scanning past the approved boundary.

## Module contract

Each module needs:

- manual/coordinator triggers, input, cohort, and output;
- clear polling or another completion check;
- success, partial, skipped, failed, cancelled, and timeout states;
- logs with run ID, phase, time, counts, status, and errors;
- safe retry or resume, especially for destructive work.

Advance only after an accepted phase outcome. Otherwise stop and preserve state and logs for review.

## Technical direction

- Use TypeScript in the Node workspace.
- Keep systemd units thin; log to journald.
- Keep phase modules independently runnable.
- Keep secrets out of source and logs. Document environment paths, users, permissions, working directories, and unit paths.

## Acceptance

1. The operator understands each trigger, monitor, outcome, retry, and log.
2. Manual dev runs prove order, cohort, logs, and failure handling.

## Open Questions

### 1. Coordinator language

Should the coordinator use TypeScript, shell wrappers, or both?

#### Operator Response
Use TypeScript

### 2. Durable run state

Where should run state live so monitoring and resume survive restarts?

#### Operator Response
Postgres db. Avoid the creating of a `WeeklyArticleFlowRuns` table. An old / removed table was named that adn our backups might have that csv file. We want that file to be ignored. Either way I woule prefer a name like `WeeklyArticleFlowRuns02`.

### 3. Failure policy

Which partial or skipped outcomes may advance the flow?

A phase can finish below its target: RSS collects zero articles, state assignment skips some, or V02 finds none eligible. Decide whether each result permits the next phase, requires a retry, or pauses for operator review. Define minimum counts and allowed skip reasons.

#### Operator Response
If the RSS collects zero articles the flow can stop.

Ideally our new table will keep track of the success of each phase and potentially other data like the count of RSS collected articles this way we would be able to restart the weekly flow if it gets stopped by say the server shutting down unexpectedly or we have to stop the process. Ideally we'll only add more tables (one preferrebly). The new table(s) can use keys of other tables, but I'd prefer not to modify other existing tables in case we want to go back. 