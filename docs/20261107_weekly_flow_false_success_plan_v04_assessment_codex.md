---
created_at: 2026-11-09T21:38:47Z
updated_at: 2026-11-09T21:51:44Z
created_by: codex (gpt-6) nicksmacbookair
modified_by: codex (gpt-6) nicksmacbookair
---

# Assessment: weekly flow false-success plan v04

## Verdict

- A narrow assessment is warranted: Python's advertised consecutive-failure rules and proposed constant names do not match the specified counter behavior.
- V04 resolves the v02 assessment's stderr-contract conflict by explicitly accepting prompt-removed diagnostics and replacing the conflicting test.
- No broader redesign is requested. The settled Out of Scope decisions remain unchanged.

## 1. Match the stop rules to the counters

- The introduction and stop-rules table describe three failures of a given type in a row.
- Section 4.4 preserves two counters that reset only after a completed outcome. A CLI failure does not reset the invalid-response counter, and an invalid response does not reset the CLI-failure counter.
- That counts each failure type since the last successful evaluation, rather than consecutive occurrences of that type.

### Concrete example

| Article | Outcome | CLI failures | Invalid responses |
| --- | --- | --- | --- |
| 1 | CLI failure | 1 | 0 |
| 2 | Invalid response | 1 | 1 |
| 3 | CLI failure | 2 | 1 |
| 4 | Invalid response | 2 | 2 |
| 5 | CLI failure | 3 | 2 |

- Under Section 4.4, Python stops on article 5. Neither failure type occurred three times in a row.
- Node's combined counter stops this sequence on article 3. Keeping separate Python counters is feasible, but equal numeric limits do not make the workers' mixed-failure behavior identical.
- This also makes the new `MAX_CONSECUTIVE_CLI_FAILURES` and `MAX_CONSECUTIVE_INVALID_RESPONSES` names misleading, a qualifying naming concern under plan-and-vet.

### Requested revision

1. If the stated reset rule is intentional, describe Python's limits as three occurrences of a type since the last successful evaluation. Name its constants accordingly, such as `MAX_CLI_FAILURES_SINCE_SUCCESS` and `MAX_INVALID_RESPONSES_SINCE_SUCCESS`.
2. If true consecutive occurrences are intended, specify resetting the other type's counter when the outcome changes type. Note that alternating failures would then avoid both breakers.
3. Add a mixed-outcome test and a success-reset test for the chosen behavior. Match the production runbook table to that behavior.

## Evidence and review limits

- Plan Sections Resulting stop rules, 4.4, and 6 establish the conflicting descriptions and planned runbook wording.
- `worker-python/src/modules/ai_approver_v02/orchestrator.py:67–94` confirms the current counters reset only on success.
- A local counter-only simulation of Section 4.4 reproduced the article-5 stop above. No model calls, database operations, or application test suite runs were performed.
- Reviewed the Node CLI error-building paths and tests, Python prompt/client/orchestrator paths, and the Phase 6 handling inspected for v02.
- This review does not reopen accepted prompt-fragment limitations, partial-failure policies, or the Phase 7 zero-completion gate.
- After resolving this mismatch, the multi-package change still requires the plan-and-vet todo phase.

## Open Questions

### 1. Python counter meaning

Should Python retain its specified behavior of counting each failure type since the last successful evaluation, rather than requiring consecutive occurrences of that type?

#### Operator Response

- Keep Python's two counters and current reset behavior: each failure type counts since the last successful evaluation. Correct the wording and names to match.
- Add mixed-outcome and success-reset cases within the existing testing architecture. Do not introduce new testing architecture.
- An additional manual authentication-failure test on the dev server, while logged out of Codex CLI as the worker user, is acceptable.
