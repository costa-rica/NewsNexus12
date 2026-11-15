---
created_at: 2026-11-07T15:43:02Z
updated_at: 2026-11-07T15:43:02Z
created_by: hermes (gpt-6.1-sol) nws-nn12prod
modified_by: hermes (gpt-6.1-sol) nws-nn12prod
---

# NewsNexus12 weekly flow 02: Phases 6 and 7 investigation

## Executive summary

Run 6 finished, but it did not successfully process its new articles end to end. Phase 6 failed all 1,547 state-assignment attempts because its configured model, `gpt-6-luna`, was rejected by Codex for ChatGPT-account authentication.

The worker swallowed each article-level error and returned normally. The coordinator accepted the completed queue job and reconciled counters as Phase 6 success, even though successful assignments were zero.

Phase 7 was not an AI execution failure. Its preview found no eligible articles because the cohort had no state assignments. The typed zero-work response caused the coordinator to mark Phase 7 and the entire weekly run complete without launching an approval job.

The immediate cause is model/account incompatibility. The systemic cause is a success contract that lets total upstream business failure become downstream zero work and an apparently successful weekly run.

## Scope and method

- Investigated the latest `newsnexus-weekly-flow-02.service` execution on `nws-nn12prod`.
- Correlated systemd, worker journals, read-only PostgreSQL queries, the saved queue result, local source, compiled JavaScript, configuration allowlisted to non-secret settings, and Git history.
- Used Codex for an independent source review; its local command runner was unavailable, so its analysis used GitHub source. Hermes independently verified the relevant local evidence and compiled branches.
- No production configuration changes, builds, service restarts, job submissions, database writes, or recovery actions were performed.
- All incident timestamps below are UTC. Database impact was rechecked during the investigation on November 7.

## Execution and impact

- Weekly run: `WeeklyArticleFlowRuns02.id = 6`.
- Service start: November 6, 13:00:35.
- Durable run start: November 6, 13:00:38.989.
- Service exit: November 7, 07:53:17; `Result=success`, `ExecMainStatus=0`.
- Current service state: `inactive / dead`.
- Durable outcome: `runCompleted=true`, `lastPhaseCompleted=7`, `lastError=null`.
- Phase 4 added 1,547 articles; Phase 5 was marked completed. This investigation did not independently audit per-article semantic coverage.
- Phase 6 job: `0304`; selected 1,547, completed 0, skipped 0, failed 1,547.
- Affected cohort: article IDs 483764–485310. All 1,547 articles remain present.
- At inspection, that cohort had no rows in either `ArticleStateContracts02` or legacy `ArticleStateContracts`, and no `AiApproverArticlePredictionsV02` rows.
- The newest 1,547 article positions still matched that cohort at inspection. This must be revalidated before recovery because later ingestion can shift the window.

## Phase 6: why every article failed

### Runtime configuration and explicit provider rejection

The worker-node journal records the start request with:

- Backend: `codex-cli`.
- Model: `gpt-6-luna`.
- Threshold: 180 days.
- Requested review count: 1,547.

The local worker-node configuration agrees: `USE_OPEN_AI_API=false` and `STATE_ASSIGNER_MODEL_NAME=gpt-6-luna`. The service runs as `limited_user`, not Nick.

The journal repeatedly records this provider response:

```text
status: 400
code: model_not_found
The 'gpt-6-luna' model is not supported when using Codex with a ChatGPT account.
```

This is an explicit model/authentication-mode incompatibility, not evidence of token expiry, network instability, article quality problems, or rate limiting. Refreshing credentials alone is not the indicated remedy.

The first article error was logged at 06:43:47 for article 485310; the last at 07:48:50 for article 483764. The incident journal contains 1,547 article-failure lines and 3,094 `model_not_found` lines. Repeated provider lines must not be interpreted as additional unique article attempts.

The queue job ran from 06:43:14.681 to 07:48:51.202: 1 hour, 5 minutes, 36.521 seconds. The coordinator observed its completed result at 07:53:17.

Content enrichment was not the failure: its summary reported 1,547 existing canonical rows skipped, zero attempted scrapes, and zero scrape failures.

### Why failure looked like success

The state-assigner article loop catches analysis exceptions, increments `failedCount`, logs the error, and continues. It does not distinguish a permanent global model rejection from an isolated bad article.

After the loop returns, the queue marks the handler completed. The coordinator validates lifecycle, inputs, and the count invariant:

```text
selectedCount = completedCount + skippedCount + failedCount
1547 = 0 + 0 + 1547
```

That invariant passes. There is no minimum-success gate, so the coordinator records Phase 6 completed and advances to Phase 7.

This is not merely a misleading systemd display. The application itself persists completion. The ops instructions explicitly permit failed articles in a completed Phase 6 result; a stricter business-success policy requires an intentional contract change and regression tests.

## Phase 7: why no approval job started

Phase 7 requested a preview with:

- `selectionMode=article_position_count`.
- `requestedArticleCount=1547`, inherited from immutable Phase 4 output.
- `allowPastApprovedBoundary=true`.
- `allowDescriptionFallback=true`.

V02 selects the newest requested article positions first, then applies eligibility filters. It requires a latest `ArticleStateContracts02` row with non-null `stateId` and `isDeterminedToBeError=false`.

Other filters exclude already approved articles, require usable content or an allowed nonblank description, and restrict prior prediction states. Allowing description fallback does not bypass the state-assignment prerequisite. Allowing the approved boundary does not expand the 1,547-position window.

Because all 1,547 cohort articles lacked state rows, none could qualify, regardless of content fallback. The Python worker logged `POST /ai-approver-v02/preview` returning HTTP 400 at 07:53:17.

The ops client maps only HTTP 400 with code `no_eligible_articles` to typed `zero_work`. The saved Phase 7 result is `kind=zero_work`, `zeroWorkAfterPriorAttempts=false`, with no attempts and `aiApproverV02JobId=null`.

No V02 run row was created in the 07:53:10–07:53:25 interval. The coordinator atomically completed Phase 7 and the weekly run at 07:53:17.924.

Therefore Phase 7 followed its current zero-work contract. Its missing business output was a consequence of Phase 6 failure, not a failed approval-model invocation.

## Configuration provenance and additional risk

The local checkout was clean on branch `dev_41_google_rss_503_retry`, at commit `2fae94243fd68db69a2c1f08e8a4eda78ce4574d`.

That November 2 commit changed both worker model examples to `gpt-6-luna`. This is consistent with the live configuration, but Git history does not prove who changed the production environment or whether the example change caused it.

The local Python configuration also sets `AI_APPROVER_V02_MODEL_NAME=gpt-6-luna`; V02 invokes Codex CLI. This is a latent compatibility risk that must be checked before recovery. It did not cause this run's Phase 7 result because no approval execution occurred.

Do not assume that removing the override solves the problem. Source defaults and documentation examples are not proof that a model is available to the actual service account.

## Recommendations

### 1. Correct and verify both model configurations

Before any bulk retry:

1. Select a model explicitly supported by the actual `limited_user` Codex account.
2. Validate both state-assigner and AI Approver V02 settings, not only worker-node.
3. Run a minimal model/authentication smoke test as `limited_user`, using the relevant executable, HOME, and model.
4. After separately authorized configuration changes and required worker restarts, require a one-article application canary and verify durable output.

Do not switch to API billing or a different backend implicitly. Do not copy or print authentication files as part of diagnosis. No replacement model was live-tested during this read-only investigation.

### 2. Fail fast on permanent shared failures

Classify unsupported-model and authentication errors as job-level blockers. Abort immediately for deterministic model incompatibility; use a bounded consecutive-failure breaker for other repeated systemic failures.

Persist the terminal reason, model/backend, attempted count, and remaining unattempted count. Preserve isolated per-article failure tolerance where intended. Avoid spending another hour repeating the same rejected configuration across an entire cohort.

### 3. Separate lifecycle completion from business success

For nonempty selection, treat zero completed assignments plus failures as failure or degraded/blocking status, not verified success. Define explicit policy for partial failure and all-skipped cases rather than treating every non-success identically.

Persist that business outcome in the weekly run, block Phase 7 when its prerequisite failed, return an appropriate coordinator exit status, and alert on the counters even if the queue lifecycle is completed.

### 4. Keep legitimate zero work, expose upstream blockage

Retain typed `no_eligible_articles` for genuinely empty or legitimately ineligible windows. Do not treat arbitrary preview HTTP 400 responses as success.

Add eligibility-exclusion counters and an explicit upstream-blocked classification. A preview with no eligible articles after total state-assignment failure must not turn the weekly run green.

### 5. Recover the existing cohort deliberately

Run 6 is already complete. Normal `--continue-run` cannot reopen it, even inside the 72-hour continuation window. Default invocation would create a new weekly run; it would not simply retry Phase 6.

Do not edit completion flags manually or rerun the whole destructive pipeline merely to repair state assignment. A new weekly run repeats cleanup, backup, deletion, and ingestion and can select a different cohort.

Prefer a separately authorized, documented repair operation: validate current cohort and selection, process missing state assignments, verify durable results, then create a fresh V02 preview for the explicitly agreed selection and start only that preview.

The current Phase 6 contract uses newest-first selection rather than pinned article IDs. If exact-cohort repair is required, confirm available targeting support or implement a reviewed repair mechanism; do not assume a count alone guarantees cohort identity.

### 6. Add regression and operational checks

- Unsupported model on the first article terminates promptly with a typed business failure.
- `selected=1547, completed=0, skipped=0, failed=1547` cannot yield successful weekly completion.
- Partial failures and legitimate zero-selection cases follow separately documented policy.
- Missing state assignments produce explainable approval exclusions.
- Typed no-eligible remains valid; unrelated preview validation errors remain failures.
- Failed upstream assignment followed by empty preview cannot report end-to-end success.
- Completed-run continuation remains protected; repair preserves historical evidence.
- Deployment preflight checks model/account compatibility for both workers as their real service user.

## Evidence references

Repository root: `/home/limited_user/applications/NewsNexus12`.

- `worker-node/src/modules/state-assigner/config.ts:65–68,109–141`: model override and backend selection.
- `worker-node/src/modules/jobs/stateAssignerJob.ts:302–348`: per-article exception handling; persistence occurs before success increments.
- `ops/src/weekly-flow-02/phases/06_stateAssignerClient.ts:296–342`: result and count validation.
- `ops/src/weekly-flow-02/phases/06_runStateAssignment.ts:708–738`: phase completion and transition without a success-count gate.
- `worker-python/src/modules/ai_approver_v02/repository.py:110–200`: positional selection and eligibility requirements.
- `ops/src/weekly-flow-02/phases/07_aiApproverV02Client.ts:312`: typed no-eligible mapping.
- `ops/src/weekly-flow-02/phases/07_runAiApproverV02.ts:305–329`: zero-work completion.
- `ops/src/weekly-flow-02/sequelizePersistence.ts:1326–1357`: atomic Phase 7 and weekly-run completion.
- `ops/src/weekly-flow-02/runSelection.ts:37–79` and `ops/AGENTS.md`: completed-run and continuation rules.
- Relevant branches were also verified in local compiled worker-node and ops JavaScript, timestamped November 2, before this execution. This verifies the implicated behavior, not byte-for-byte parity of every deployed artifact.
- Journals: `newsnexus-weekly-flow-02.service`, `newsnexus12-worker-node.service`, and `newsnexus12-worker-python.service` for the incident intervals above.
- Read-only queue lookup: `GET http://127.0.0.1:8003/queue-info/check-status/0304`.
- PostgreSQL: `WeeklyArticleFlowRuns02`, `Articles`, both state-contract tables, `AiApproverArticlePredictionsV02`, and `AiApproverRunsV02`.

## Limitations and synchronization

- No live reproduction or canary was submitted because it could perform AI work or write production data. Existing rejection logs, saved results, source, and durable output establish the failure chain.
- The raw preview response body was not independently retained; typed zero work is evidenced by persisted coordinator state, its code path, and the worker's HTTP 400 journal entry.
- Configuration-change authorship and a verified replacement model remain unknown.
- The current-month vault context directory was absent. Historical CPO/CTO onboarding documents were found only in the repository archive and were not used as current operational authority.
- NickVault was synchronized successfully before investigation. The sync processed pre-existing changes and emitted a Node `TimeoutNaNWarning`, but exited zero with `Fully synced`.
- This report is the only intentional vault content addition for this task. A final post-write sync publishes it; delivery status is confirmed separately in the task response.
