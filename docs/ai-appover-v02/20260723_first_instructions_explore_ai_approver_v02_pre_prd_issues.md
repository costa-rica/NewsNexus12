---
created_at: 2026-07-23
updated_at: 2026-07-23
created_by: claude (claude-fable-5)
modified_by: codex (gpt-5)
---

# AI Approver V02 Pre-PRD Issues

Conflicts and ambiguities found while reviewing the answered questions in:

- 20260723_ai_approver_v02_assessment.md (codex)
- 20260723_ai_approver_v02_assessment_claude.md (claude)
- 20260723_first_instructions_explore_ai_approver.md (operator)

## Conflicts

### 1. Retry vs never-reanalyze

Codex assessment Q12 says failed and invalid_response articles stay eligible on the next run and retry once. Claude assessment Q5 says an article analyzed by V02 once will not be analyzed again. If "analyzed" includes failed attempts, these contradict. If it means only completed predictions, they are compatible but this should be stated explicitly.

#### Operator response

Resolved. Completed predictions are not retried. Failed or invalid_response results remain eligible for a later retry, which replaces the existing article row.

### 2. Unique constraint vs business rule

Claude assessment Q5 enforces uniqueness per article per prompt version. But codex Q11 (no reprocessing with new prompts) plus "once analyzed never again" describes a global one-prediction-per-article rule. Also, a retry after failure would violate the unique constraint unless the failed row is updated in place rather than inserted as a new row. Decide: constraint on articleId alone or (articleId, promptVersionId), and update-in-place vs insert for retries.

#### Operator response

### 3. Meaning of the article count

Codex Q7 mode 1 is "how many articles back from the last added article" (a positional range by articleId), and Q10 agrees (stop when the resolved range is exhausted). But Q17 says the count means attempted model calls. Going 100 back might yield only 40 eligible articles. Decide: is that run finished (positional meaning) or should it keep scanning until 100 attempts are made?

#### Operator response

### 4. Stale watermark language

The Q7 answer removes the watermark and continuation concept entirely, replacing it with count and until-last-approved run modes. But the Q10 and Q11 answers still reference "the watermark." These answers should be reworded in terms of the new run modes.

#### Operator response

Q7 answers this: V02 has no continuation watermark. Q10 and Q11 must use count-mode and approved-boundary terminology.

### 5. Approved boundary definition

Codex Q8 says stop before the highest articleId in ArticleApproveds, but Q9 and Q7 say only rows with isApproved true count. Q8 should read: highest articleId with an ArticleApproveds row where isApproved is true.

#### Operator response

Q7 and Q9 answer this: use the highest ArticleApproveds.articleId whose isApproved value is true.

## Ambiguities

### 1. Circuit breaker definition

Claude assessment Q4 says stop after 3 errors in a row or 5 non-useful predictions. "Non-useful predictions" is undefined (invalid_response rows?). Also unclear whether it is 5 in a row or 5 total per run.

#### Operator response

### 2. Retry-once scope

Codex Q12 says retry once during a new run and continue to skip. Unclear if that means once ever or once per subsequent run. "Continue to skip" suggests permanently skipped after one retry, which requires tracking a retry count. The prediction table design has no retry-count column yet.

#### Operator response

### 3. State-assigner verification

Codex Q14 answer is conditional: if ArticleStateContracts02 is written only by the worker-node state assigner, row presence suffices. No one has confirmed this. Add an explicit implementation task to verify, and decide the fallback (source column?) if other writers exist.

#### Operator response

Repository review confirms worker-node stateAssignerJob creates these rows; API routes only update existing rows. Runtime row origin is sufficiently identified.

### 4. Blank prompt titles

Codex Q21 says titles must be unique but blank titles are allowed with a display fallback. Can multiple blank-title prompts coexist? Null titles usually bypass unique constraints; confirm this is the intent.

#### Operator response

### 5. Latest state row eligibility

Codex Q13 says the latest ArticleStateContracts02 row must have an integer stateId. Implied but unstated: if the latest row lacks one while an older row has one, the article is ineligible. Confirm.

#### Operator response

Q13 answers this: only the latest row controls eligibility; an older valid row does not qualify the article.

### 6. V01 startup validation open item

Codex Q6 remains deliberately open: whether worker-python can safely stop failing startup on invalid V01 Codex configuration. Carry this into the PRD as an open question.

#### Operator response

### 7. V02 table names and count

The first instructions suggest `AiApproverArticleScoreV02` and `AiApproverPromptVersionV02`. The codex assessment recommends prediction terminology and an optional run table. Confirm the model names, physical table names, and whether `AiApproverRunsV02` is required.

#### Operator response

### 8. Hardcoded prompt versioning

Q22 rejects storing the rendered prompt because the prompt-version foreign key is sufficient. That key does not identify later changes to worker-python's hardcoded article wrapper or response instructions. Decide whether those instructions are immutable or identified by a pipeline or schema version.

#### Operator response

### 9. State error eligibility

Q13 requires the latest state row to contain an integer `stateId`, but does not address `isDeterminedToBeError`. Confirm whether the latest row must also have `isDeterminedToBeError` set to false.

#### Operator response

### 10. Successful content definition

Q15 and Q16 require the latest successful `ArticleContents02` row. Define whether success requires `status = 'success'`, nonblank content, or both. Also decide whether the title comes from `Articles` or that content row.

#### Operator response

### 11. Cancellation behavior

Claude Q2 asks whether release one needs cancellation, but the response addresses only manual status refresh. Confirm whether V02 should reuse the current worker-python cancel action or omit cancellation.

#### Operator response

### 12. Schema deployment mechanism

Codex Q28 requests a “db-manager migration script,” but the repository has no general migration framework. Confirm whether this means a manual SQL file under `scripts/schema` or a new db-manager CLI operation.

#### Operator response

### 13. Prompt edit and run race

Q19 freezes a prompt after any prediction row exists. A run could resolve an unused active prompt while an operator edits it before the first row is inserted. Define transactional locking or mark the prompt used when the run is accepted.

#### Operator response

### 14. Run-mode preview count

Claude Q5 requests that the until-last-approved option include the number of articles. Clarify whether the modal must calculate eligible model calls after applying approval, state, content, prior-prediction, and retry filters.

#### Operator response

### 15. V01 inaccessible meaning

Q1, Q2, and Q4 say V01 portal features should be inaccessible without deleting files, while Q5 keeps direct APIs active. Define whether inaccessible portal URLs return 404, redirect, or render no controls.

#### Operator response
