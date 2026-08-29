---
created_at: 2026-07-23
created_by: claude (claude-fable-5)
---

# AI Approver V02 PRD V01 Assessment (claude)

## Scope of this assessment

This assessment reviews 20260723_ai_approver_v02_prd_v01.md for internal conflicts and ambiguities of moderate or higher severity, per the plan-and-vet criteria. Factual claims were checked against db-models: ArticleStateContract02.isDeterminedToBeError is non-nullable with default false, ArticleContents02 has status and nullable content, and ArticleApproveds has isApproved. Those all match the PRD.

Three qualifying concerns follow. Each could confuse an implementing agent or produce divergent behavior.

## Qualifying concerns

### 1. Missing approved boundary behavior

Sections 7.5, 8.2, and 9.1 assume an approved boundary exists. Section 13.5 lists an "unavailable approved boundary" error but no section says which modes fail versus proceed when no ArticleApproveds row with isApproved true exists.

- Mode B cannot resolve a stop point: error, or scan to the oldest article?
- Mode A default truncation has no boundary: error, proceed as if the checkbox were set, or scan N positions unbounded?

An implementing agent could block Mode A entirely or scan the whole table. Define the behavior per mode.

#### Operator response

### 2. Retry row staleness on update

Section 10.6 lists the fields a retry updates: run reference, model name, status, prediction, reasoning, and errors. It omits pipelineVersion and contentSource (both required fields per 12.4).

- If the pipeline version changed between attempts, the row would claim the old version produced the new reasoning, defeating the audit goal in 10.4.
- A retry under different content settings (description override) could leave a wrong contentSource.

State that a retry updates every attempt-derived field, or explicitly freeze them.

#### Operator response

### 3. Circuit-breaker counter interaction

Section 10.7 says a completed prediction resets both counters, but not whether a failed outcome breaks an invalid_response streak or vice versa.

- Reading 1: each counter counts consecutive outcomes of its own type, unbroken by the other type. Alternating failed/invalid outcomes trip the failure breaker at 3.
- Reading 2: consecutive means uninterrupted by any other outcome. Alternating outcomes never trip either breaker and a degraded run continues indefinitely.

Pick one reading; reading 1 is safer.

#### Operator response

## Minor observations (below threshold)

1. Mode B preview requires full eligibility evaluation (latest state row, latest content row) over a potentially large range. Require SQL-side filtering in the implementation plan; an in-memory scan risks the memory issues seen previously in this project.
2. Section 8.1 disables start when "more than one prompt is active" while 11.4 and 12.2 guarantee at most one. Harmless defensive redundancy.
3. Behavior when a preview resolves zero eligible articles (allow a no-op run or block start) is unspecified.
4. Section 13.2 uses the /automations namespace while 13.3 uses /analysis; both are labeled suggestions, but the split should be confirmed against existing API conventions during planning.
