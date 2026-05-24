---
created_at: 2026-05-22
updated_at: 2026-05-22
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# Assessment of portal lint cleanup plan v02

## Summary

V02 is a material improvement over the original plan. It correctly separates the TanStack Table warnings from ordinary source defects, adds a useful triage matrix for `set-state-in-effect`, and fixes the earlier CI guidance that treated plain lint as enough.

There are still two significant planning flaws. They are not blockers to using the document, but they should be corrected before implementation starts so the cleanup does not overpromise its CI protection or push engineers toward a large server-component refactor that does not match the current portal architecture.

## Findings

1. The warning-budget CI gate does not actually guarantee that any new warning fails CI.

   The plan says to run lint with `--max-warnings=52` so any new warning fails CI. That only fails when the total warning count rises above 52. It would still pass if one warning is fixed and another unrelated warning is introduced in the same change, or if one warning is replaced by a different warning.

   A count budget is useful as a coarse ratchet, but the plan should describe it accurately. If the project needs "no new warnings" enforcement during cleanup, use a baseline comparison that checks warning identities, such as file, line, rule, and message, or require each cleanup PR to both lower the count and avoid unrelated warning changes.

2. The preferred mount-fetch fix is likely too ambitious for these portal pages.

   Pattern C lists "Move data loading up to a Next.js Server Component / route loader" as the first preference. The representative pages are currently `"use client"` components that read `token` from Redux via `useAppSelector` and call the API with `Authorization: Bearer ${token}`. For example, `portal/src/app/(dashboard)/admin-database/backup/page.tsx` and `portal/src/app/(dashboard)/analysis/approved-chatgpt/page.tsx` both load authenticated data this way.

   Moving these fetches to Server Components is not a local lint cleanup. It would require deciding how server-side code gets the user's auth token, whether Redux-persist/localStorage auth is replaced or mirrored into cookies, and how dashboard pages hydrate authenticated state. That is a larger auth/data-loading architecture change.

   The plan should make the near-term options more realistic:

   - for current client-only authenticated pages, prefer a data-fetching hook/library or a documented suppression
   - treat Server Component loading as a separate architecture project, not the default lint cleanup path
   - require any Server Component migration to include auth-token handling and page-level QA in its scope

## Recommended adjustment

Keep the V02 structure, but revise the CI section and Pattern C:

1. Rename `--max-warnings=52` from a "no new warnings" gate to a "total warning budget" gate, or replace it with a baseline warning-identity check.
2. Move Server Component data loading out of the default Pattern C fix path for Redux-authenticated client pages.
3. State that client mount-fetch warnings should usually resolve through a query hook/library or a scoped suppression unless the team first commits to a broader auth/data-loading migration.
