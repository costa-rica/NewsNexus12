---
created_at: 2026-08-29T21:44:36Z
updated_at: 2026-08-29T21:44:36Z
created_by: codex (gpt-5.6) nicksmacbookair
modified_by: codex (gpt-5.6) nicksmacbookair
---

# Assessment of Legacy Orchestrator and AI Approver V01 Removal Plan V01

Assessed document: `docs/ai-appover-v02/20260829_legacy_v01_removal_plan_v01.md`

## Summary

The plan is feasible overall, but one concern meets the plan-assessment threshold because the proposed deletion would remove current article-review functionality that no longer depends on AI Approver V01 behavior or data.

## Qualifying Concern

### 1. The article-content viewer is not a V01 feature

Plan section 3.2 says to delete `ModalReviewArticleContent.tsx` because its API endpoint is mounted under `/analysis/ai-approver`.

The current implementation shows that the namespace is legacy, but the behavior is not:

- `TableReviewArticles.tsx` displays an `Open article content` button beside any article whose retained `hasArticleContent` field is true.
- `ModalReviewArticleContent.tsx` is a read-only viewer. It does not load V01 prompts, start a V01 job, read V01 scores, or expose V01 controls.
- The API handler reads only `Article` and the canonical retained `ArticleContents02` row.
- The response contains generic article identity and content fields, not V01 prompt or score data.

Deleting the modal, callback, response type, and endpoint would therefore remove an independently useful article-review capability. The route's current location does not make its functionality V01-owned.

Why this meets the threshold:

- It poses a direct regression risk to existing article-review functionality.
- It conflicts with the removal boundary's intent to preserve unrelated features and `ArticleContents02` behavior.
- A successful build would not reveal the regression because the plan also removes the caller and type.

Recommendation:

1. Preserve `ModalReviewArticleContent.tsx`, `onArticleContentClick`, its page state, and `ReviewArticleContentResponse`.
2. Move the authenticated read-only handler to a retained article namespace, such as `GET /articles/:articleId/content`.
3. Update the modal to call the retained endpoint.
4. Add a focused API test and preserve the portal content-button behavior.
5. Let the old `/analysis/ai-approver/review-article-content/:articleId` URL disappear with the rest of the V01 namespace and return `404`.

If the operator intends to remove the generic article-content viewer as a separate product decision, the next plan should state that explicitly rather than treating route placement as evidence of V01 ownership.

## Result

- Plan status: revision required.
- Operator decision: required only if the generic article-content viewer should be removed; otherwise the repository evidence supports preserving and rehoming it.
- Todo status: not ready to create until the plan concern is resolved.
