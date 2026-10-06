---
created_at: 2026-09-29T21:00:36Z
updated_at: 2026-09-29T21:00:36Z
created_by: hermes (gpt-5.6-sol) nws-nn12dev
modified_by: hermes (gpt-5.6-sol) nws-nn12dev
source_environment: nws-nn12dev
intended_audience: nws-nn12prod operators and NewsNexus12 maintainers
---

# `nws-nn12dev` Weekly Article Flow Run 4 Resume and Semantic Reset Reproduction Report

## Executive Summary

A production-like weekly article flow was run on `nws-nn12dev` using the protected environment file `/etc/newsnexus12/weekly-article-flow.env`, application user `limited_user`, PostgreSQL role `newsnexus_app`, and the `newsnexus_prod` development database.

The first invocation was interrupted with `Ctrl+C` during backup and left durable weekly run 4 marked active. A fresh start correctly returned `active_run_exists`. The subsequent `--resume-run-id 4` invocation reattached to the same durable run and continued through backup, old-article deletion, Google RSS ingestion, semantic scoring, and state assignment.

The production semantic-stage `read ECONNRESET` was **not reproduced**. Semantic queue job `0014` completed, every observed status poll returned HTTP 200, and the coordinator advanced to state assignment.

The absence of a reset was not caused simply by development adding only three new RSS articles. The development semantic scorer still exercised the global database-loading path: it loaded semantic contract IDs and materialized all 257,061 current `Articles` rows before filtering already-processed articles in Node.js. The semantic backlog itself was smaller—145 selected on development versus 1,705 in the production incident—so the subsequent embedding/scoring phase was considerably shorter. However, production's reset occurred before its first article attempt, during the selection/model-initialization period, so the smaller scoring backlog does not adequately explain why the reset did not recur.

Run 4 later failed at AI Approver V02 preview with `no_eligible_articles`. Before that failure, state assignment had recorded an `analysis_error` for each of the three weekly cohort articles because `gpt-5.4-mini` was unsupported by Codex under the configured ChatGPT account. Alert publication then failed separately because `sudo` required a password.

## Scope and Safety

This report is based on:

- `/home/nick/weekly-flow-20260929-203909.log`
- `/home/nick/weekly-flow-resume-4-20260929-204219.log`
- read-only inspection of `WeeklyArticleFlowRuns` row 4
- read-only aggregate PostgreSQL queries
- `newsnexus12-worker-node.service` journal entries
- `newsnexus12-worker-python.service` journal entries
- the semantic scorer and weekly coordinator source
- the production failure report at `docs/20260929_weekly_article_flow_run_4_failure_report.md`

No database rows, queue jobs, services, environment files, or application configuration were modified during the investigation. This Markdown report is the only intentional repository change from this reporting task. An unrelated pre-existing modification to `package-lock.json` was present and was not touched.

No credentials or protected environment values are included here.

## Development Run Identity

| Field | Value |
|---|---|
| Host | `nws-nn12dev` |
| Durable run ID | `4` |
| Mode | `manual_production` |
| Database target | `localhost:5432/newsnexus_prod`, schema `public` |
| PostgreSQL role | `newsnexus_app` |
| Runtime user | `limited_user` |
| Started | `2026-09-29T20:37:11.270Z` |
| Ended | `2026-09-29T20:45:26.983Z` |
| Terminal status | `failure_ai_approver_v02` |
| Durable `currentStage` | `reporting` |
| Latest business stage attempted | `ai_approver_v02_preview` |
| Final business failure | AI Approver preview HTTP 400, `no_eligible_articles` |

`currentStage=reporting` does not mean reporting caused the business failure. Failure finalization advanced the durable stage to reporting after AI Approver V02 preview failed.

## Invocation and Resume Outcome

### Interrupted initial run

The original run was interrupted with `Ctrl+C` during backup. Durable run 4 remained marked active.

### Fresh-start attempt

`/home/nick/weekly-flow-20260929-203909.log` contains:

```text
database target: localhost:5432/newsnexus_prod (public)
✅ Associations have been set up
active_run_exists
```

This confirms the active-run guard prevented a second authoritative run from being created while run 4 remained active.

### Resume attempt

The `--resume-run-id 4` invocation resumed the existing run. Durable evidence shows completion of:

1. preflight
2. duplicate cleanup
3. backup
4. old-article deletion
5. Google RSS ingestion
6. semantic scoring
7. state assignment

The run then failed during AI Approver V02 preview and entered failure reporting.

## Stage Summary

| Stage | Outcome | Evidence |
|---|---|---|
| Preflight | Completed | Durable stage evidence |
| Duplicate cleanup | Completed | Durable stage evidence |
| Backup | Completed | Durable stage evidence |
| Old-article deletion | Completed | 3,379 found and deleted; cutoff `2026-04-02` |
| Google RSS | Completed | Job `0013`; 3 articles added; `queries_exhausted` |
| Semantic scorer | Completed | Job `0014`; no transport reset |
| State assigner | Queue completed with per-item failures | Job `0015`; all 3 selected articles had `analysis_error` |
| AI Approver V02 preview | Failed | HTTP 400 `no_eligible_articles` |
| Reporting/alert | Failed separately | `sudo: a password is required` |

## Semantic Scorer Reproduction Result

### Determination

**Connection reset reproduced: NO.**

Semantic queue job `0014` produced:

| Result | Count/value |
|---|---:|
| Queue status | `completed` |
| Ending reason | `completed` |
| Selected | 145 |
| Attempted | 145 |
| Scored successfully | 11 |
| Skipped as `no_score_result` | 134 |
| Failed | 0 |
| Unattempted | 0 |
| Stage start | `2026-09-29T20:43:50.339Z` |
| Stage end | `2026-09-29T20:44:55.799Z` |

Worker-node journal evidence shows:

1. Job `0014` was enqueued and started at `20:43:50Z`.
2. Status polling returned HTTP 200 throughout the run.
3. The scorer resolved semantic entity ID 3.
4. It logged `Loaded articles: 145` at `20:44:01Z`.
5. It loaded 25 keywords.
6. It loaded `Xenova/paraphrase-MiniLM-L6-v2`.
7. It logged progress at 100 articles.
8. It logged that all articles were processed and saved.
9. The queue job completed at `20:44:34Z`.
10. The final observed status request returned HTTP 200 at `20:44:55Z`.
11. The coordinator then submitted state-assigner job `0015`.

There was no `ECONNRESET`, `fetch failed`, failed status request, semantic cancellation request, or canceled semantic result.

The 134 `no_score_result` outcomes are semantic skips, not transport failures.

## Did Development Exercise the 200,000-Plus-Article Load?

### Yes

A read-only database count after the run showed:

| Data | Count |
|---|---:|
| Current `Articles` rows | 257,061 |
| Semantic contract rows for entity 3 | 256,927 |
| Existing articles with an entity-3 semantic contract | 256,927 |
| Existing articles without an entity-3 semantic contract after the run | 134 |
| Weekly run 4 cohort | 3 |

The semantic run selected 145 articles before scoring. It successfully persisted 11 new semantic contracts, leaving 134 articles without a contract after completion. These counts reconcile exactly:

```text
145 originally selected - 11 successfully scored = 134 remaining
```

### Why three newly added articles did not limit the database load

The weekly coordinator starts semantic scoring with an empty request body:

```text
POST /semantic-scorer/start-job {}
```

It does not pass the weekly cohort IDs or an article-ID range. In `worker-node/src/modules/jobs/semanticScorerJob.ts`, `createFilteredArticlesArray` performs the following operations:

1. Loads every `ArticleEntityWhoCategorizedArticleContract` for the semantic entity into Node.js (`lines 362-372`).
2. Loads all matching `Articles`, including `ArticleApproved`, with `Article.findAll` (`lines 391-394`). With no targeting fields in the request, there is no ID-range restriction.
3. Filters already-processed article IDs in JavaScript (`lines 396-409`).

Therefore the worker did not merely ingest or inspect the three new weekly articles. It loaded approximately 256,927 semantic-contract records and materialized 257,061 current Article models, plus associated approval data, to derive a backlog of 145.

The journal interval between resolving the semantic entity and logging `Loaded articles: 145` was approximately 11 seconds. This is direct evidence that the global selection/materialization path ran on development.

## Development Versus Production Workload

| Characteristic | Production incident | Development reproduction |
|---|---:|---:|
| Semantic selected count | 1,705 | 145 |
| Attempted before terminal outcome | 0 | 145 |
| Semantic queue outcome | Canceled after poll reset | Completed |
| Status transport result | One `read ECONNRESET` | All observed polls HTTP 200 |
| Large global Article-loading path | Yes | Yes; 257,061 current Articles |
| Progressed to state assignment | No | Yes |

Production's semantic backlog was approximately 11.76 times the development backlog.

The scorer currently computes one article embedding and up to 25 keyword embeddings for each usable article. Keyword embeddings are recomputed inside the per-article operation rather than cached once for the job. The approximate upper bounds are therefore:

| Run | Selected articles | Approximate embedding calls |
|---|---:|---:|
| Development | 145 | 3,770 |
| Production | 1,705 | 44,330 |

This means the sustained scoring phase was materially lighter on development.

However, the production failure report establishes that production's reset occurred before its first article was attempted. The reset happened while the worker was still around article selection/model initialization. Development exercised the same broad database-materialization phase without a reset. The difference in subsequent scoring duration may change overall exposure to transient failures, but it does not directly explain the specific production reset observed before scoring began.

## Interpretation

The evidence supports this statement:

> Development reproduced the large database materialization workload, but it did not reproduce the transient status-poll connection reset.

The evidence does not support this statement:

> Development avoided the reset because Google RSS added only three articles.

The number of newly added weekly articles does not bound semantic selection because the weekly coordinator does not pass cohort targeting to the semantic endpoint. The scorer scans and materializes global tables before filtering in Node.js.

The reset should still be treated as intermittent and unresolved. One successful development execution does not prove that the transport failure cannot recur. Plausible but unproven differentiators include:

- different concurrent host load;
- different memory pressure or garbage-collection timing;
- different associated-row volume during ORM hydration;
- event-loop delay during global query hydration;
- HTTP connection reuse behavior;
- a transient worker-side socket fault that did not terminate the worker;
- production-specific service or operating-system conditions.

The retained evidence still does not prove a production worker crash, model failure, semantic timeout, or scoring defect.

## Downstream Development Errors

### State assignment

State-assigner queue job `0015` selected the three weekly cohort articles. The queue job reached `completed`, and `circuitBreakerTripped` was `false`, but each article recorded `analysis_error`.

For article IDs `465522`, `465521`, and `465520`, Codex returned HTTP 400 with:

```text
The 'gpt-5.4-mini' model is not supported when using Codex with a ChatGPT account.
```

The worker skipped each failed article and continued. The resulting state-assignment stage was therefore lifecycle-complete but produced zero successful article analyses.

### AI Approver V02 preview

The next request was:

```text
POST http://127.0.0.1:8004/ai-approver-v02/preview
```

The Python worker returned HTTP 400:

```json
{"error":"no_eligible_articles","message":"No eligible articles were found"}
```

This caused durable run status `failure_ai_approver_v02`. The preceding state-assignment failures plausibly explain why no articles were eligible, but the retained preview response itself establishes only that no eligible articles were found.

### Alert/reporting failure

Failure reporting attempted to publish an alert and separately failed with:

```text
sudo: a password is required
```

This is distinct from both the semantic reproduction result and the AI Approver business failure.

## Operational Implications for Production

1. **The semantic poll-reset risk remains.** Development did not reproduce the reset, but the fail-fast policy still converts any single transient status-poll failure into cancellation of active semantic work.
2. **The reproduction exercised the global data load.** A small weekly cohort should not be interpreted as a lightweight semantic selection test under the current implementation.
3. **Global materialization is inefficient.** The worker loads more than a quarter-million Article models and a similar number of contract rows into Node.js to derive a small unprocessed set.
4. **Scoring cost still scales with backlog.** The production backlog was almost 12 times larger, and keyword embeddings are recalculated per article.
5. **Queue completion can hide business failure.** State assignment completed at the queue level despite all selected articles failing analysis.
6. **Development configuration has an independent Codex model incompatibility.** That issue prevented a clean downstream end-to-end completion but occurred after semantic scoring succeeded.
7. **Alert delivery remains independently fragile.** The development failure mode was password-required `sudo`; the production report documented a separate `NoNewPrivileges=true` incompatibility.

## Recommended Follow-up

The production failure report's primary recommendation remains valid: make read-only status polling resilient to bounded transient transport failures and do not immediately cancel active work after one failed observation.

Additional follow-up should consider:

1. Move semantic eligibility filtering into PostgreSQL using an anti-join or `NOT EXISTS`, selecting only articles without the target semantic contract.
2. Avoid materializing all contract IDs and all Article models in Node.js.
3. Cache the 25 keyword embeddings once per semantic job rather than recomputing them for every article.
4. Add phase timing and memory metrics for contract loading, Article query execution, ORM hydration, filtering, model initialization, and scoring.
5. Record event-loop delay and process memory around status requests to test the resource-pressure hypothesis.
6. Run a controlled nonproduction repetition with production-equivalent selected backlog and monitoring, without treating a non-reproduction as proof of safety.
7. Correct the unsupported state-assigner model configuration before using this path as a complete downstream production rehearsal.
8. Test alert publication from the actual coordinator security context.

Any implementation change should preserve failed production run 4 as immutable audit evidence and should be developed and verified separately from this report.

## Conclusion

`nws-nn12dev` run 4 successfully resumed and passed through semantic scoring without reproducing production's connection reset. The run did not merely process three new RSS articles: the semantic implementation loaded the global 257,061-row Articles dataset and 256,927 existing semantic contract rows before filtering to 145 candidates.

The smaller candidate backlog made the actual embedding phase shorter, but production's original reset occurred before scoring began. The most defensible conclusion is therefore that the large data-loading condition was recreated but the transient transport event did not recur. The polling policy remains unsafe, and the global in-memory selection strategy remains an important efficiency and observability concern.
