---
created_at: 2026-07-03
updated_at: 2026-07-03
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# Review Chunk Pagination Todo v01 Assessment

The todo mostly aligns with `docs/20260703_review_chunk_pagination_plan_v02.md`, and the API phases are clear enough to implement. It still warrants a v02 before implementation because the portal phase leaves cursor state underspecified and contains contradictory filter-refresh instructions.

## 1. Next cursor state is missing from the portal tasks

1. The API response includes `nextCursor`, and the route tasks correctly require returning it.
2. Phase 3 adds local state for `chunkStartCursors`, `currentChunkIndex`, `totalCount`, and `hasMore`, but it does not add local state for the latest `nextCursor`.
3. The navigation task then says `Next: fetchArticlesArray(nextCursor)`, but `nextCursor` is not defined as component state or derived from any named source.
4. This can lead to a compile error or to an implementer deriving the cursor inconsistently from the last row instead of the server response.
5. Todo v02 should explicitly add `nextCursor: number | null` state, set it from the response in `fetchArticlesArray`, clear it on empty responses and filter resets, and use that state in the Next handler.

## 2. Filter refresh behavior is contradictory

1. Phase 3 says filter change, "Refresh with New Filters", and limit change should reset the stack and fetch chunk 1.
2. The next task says `hasFilterChanges` should include `limit` so changing the dropdown lights up the Refresh button like other filters.
3. Phase 4 says toggling Hide Approved / Hide Irrelevant refetches chunk 1 and changes `totalCount`.
4. These statements leave two possible implementations:
   - auto-refetch immediately when any filter or limit changes
   - keep the current pattern where changes light up the Refresh button and only the refresh action refetches
5. Todo v02 should choose one behavior. If preserving current UX, it should say filter and limit changes only update params and `hasFilterChanges`; `handleRefreshWithFilters` resets the cursor stack, clears cursor metadata, updates `initialFilters`, and fetches chunk 1.

## 3. Limit dropdown wiring is ambiguous with the existing Select component

1. The todo says to use `portal/src/components/form/Select.tsx` with a value from `articleTableBodyParams.limit ?? 5000`.
2. The current `Select` component accepts `defaultValue`, not a controlled `value` prop.
3. Passing `value` directly would fail TypeScript unless the component is updated, while using only `defaultValue` can drift if Redux state changes after mount.
4. Todo v02 should specify one of these:
   - update `Select.tsx` to support a controlled `value` prop while preserving existing usages
   - use the existing `defaultValue` API and force remount or otherwise handle persisted limit changes deliberately

## Recommendation

Create `20260703_review_chunk_pagination_todo_v02.md` before implementation. The v02 can keep the same phase structure, but it should clarify `nextCursor` storage, choose the filter-refresh behavior, and specify how the limit dropdown is wired to the existing Select component.
