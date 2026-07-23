---
created_at: 2026-07-23
updated_at: 2026-07-23
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# AI Approver V02 Post-Implementation Report

## 1. Implementation outcome

- V02 has dedicated database models, schema installation, worker execution, API routes, portal controls, and review fields.
- V02 is manual-only and advisory.
- V01 backend compatibility remains.
- V01 portal cards and prompt routes are hidden.
- Full automated validation passed before deployment preparation.

## 2. Final V01 boundary

- Existing V01 backend routes remain callable.
- Existing V01 table, model, and source names remain unchanged.
- Invalid V01 configuration produces a startup warning instead of stopping worker startup.
- A direct invalid V01 request still fails clearly.
- V01 review loading and modal behavior remain available.
- V01 review is hidden by default in the portal.

## 3. Final V02 boundary

- V02 has separate route and table namespaces.
- V02 accepts one active versioned operator prompt.
- V02 freezes preview selection and content-source choices.
- V02 allows one initial attempt and one retry after failure or invalid output.
- V02 stores one application-managed prediction row per article.
- V02 review validation and comments are independent.
- V02 does not update downstream article workflow data.

## 4. Naming confusion found

1. The repository folder is named `ai-appover-v02`, preserving an existing spelling error.
2. V01 historically appeared without a version label in portal text.
3. V01 source identifiers remain unversioned even though retained UI labels now say V01.
4. Draft and expired are preview states, not failed execution states.
5. The worker queue job and persisted V02 run have separate identifiers and statuses.

## 5. Future V01 removal preparation

- Include `db-models/src/models/OrchestratorRunStep.ts` in the removal inventory.
- Re-run repository-wide route, table, type, and historical-row searches.
- Decide how long V01 review data must remain readable.
- Decide whether hidden V01 prompt source should be archived or deleted.
- Plan historical orchestrator-step compatibility before changing its union type.
- Keep V01 removal separate from V02 rollout and observation.

## 6. Implementation clarifications

- The prompt-version relationship identifies the operator prompt used by a prediction.
- Predictions do not duplicate the full prompt text.
- Prompt records are immutable after first accepted use.
- Retry updates replace the prior result in the same prediction row.
- Exact attempt history is not retained beyond `attemptCount`, current result, and run relationship.
- Production confirmation of model access requires an approved live Codex call.

## 7. Validation summary

- db-models build passed.
- db-manager build passed.
- db-manager: 13 suites and 211 tests passed.
- worker-python: 201 tests passed.
- API build passed.
- API: 26 suites and 183 tests passed.
- portal lint passed with zero warnings.
- portal production build passed.
- authenticated local Mode A completed one prediction.
- authenticated local Mode B completed two predictions.
- local review validation and comments saved and cleared independently.
- the local E2E run used an isolated database and deterministic fake Codex executable.

Detailed evidence is in:

- `20260723_ai_approver_v02_phase_5_validation.md`

## 8. Deployment status

- Implementation is complete through deployment preparation.
- Production backup is not confirmed.
- Production schema installation is not performed.
- Production deployment is not performed.
- A live Codex smoke test is not performed.
- Operator approvals remain required for those actions.
