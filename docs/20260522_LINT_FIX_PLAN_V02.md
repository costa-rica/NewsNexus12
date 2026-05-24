---
created_at: 2026-05-22
updated_at: 2026-05-22
created_by: claude (opus-4.7)
modified_by: claude (opus-4.7)
---

# Lint fix plan V02

Restore the portal `react-hooks/set-state-in-effect` suppressions that
were deleted in commit `ae7f58f`. Faster and more accurate than
re-typing 25 comments by hand.

## 1. Goal

- Make `npm run lint --workspace newsnexus12portal` pass again.
- Preserve existing portal behavior.
- Limit changes to exactly the lines that were lost.
- Avoid broad React data-loading rewrites.

## 2. Root cause

Commit `ae7f58f chore: apply safe audit remediation` includes this line
in its body:

> "remove stale portal react-hooks suppressions after dependency updates
> made them unused"

That claim was wrong. The dependency bumps did not change the rule's
behavior; the underlying effect patterns still trigger
`react-hooks/set-state-in-effect`. `ae7f58f` deleted **26 lines across
22 files** — exactly the suppression comments we added during portal
lint cleanup phases 4 and 5. After the deletion, the rule fires again
on the same locations.

Verified:

- `git log ae7f58f..HEAD -- portal/src` shows no other commits touched
  `portal/src` after `ae7f58f`. The only change in `portal/src` since
  the phase 8 lint gate restore is the suppression deletion.
- `git show ae7f58f -- portal/src` shows each affected file lost
  exactly the suppression line above an unchanged
  `useEffect`/`setState` call.

## 3. Strategy

Restore the `portal/src` portion of the pre-`ae7f58f` state using a
surgical `git checkout`. Do NOT revert the whole commit — `ae7f58f`
also contains legitimate audit-remediation changes to root
`package.json` and `package-lock.json` that must be preserved.

## 4. Implementation steps

1. Confirm working tree under `portal/src` is clean. If anything is
   uncommitted there, stash or commit it first:

   ```bash
   git status -- portal/src
   ```

2. Restore the pre-`ae7f58f` content of every file under
   `portal/src`:

   ```bash
   git checkout ae7f58f^ -- portal/src
   ```

   This restores both the working tree and the index. Nothing under
   the root `package.json`, `package-lock.json`, or any other
   workspace is touched.

3. Verify the diff is what we expect — only the 25 suppression
   comments should appear as additions, and no other lines should
   change:

   ```bash
   git diff --cached -- portal/src | head -200
   git diff --cached --stat -- portal/src
   ```

   Expected stat output: ~22 files, 26 insertions, 0 deletions.

4. Run the lint gate to confirm it passes:

   ```bash
   npm run lint --workspace newsnexus12portal
   ```

   Expected: exit code 0, no warnings (the script runs
   `eslint --max-warnings=0`).

5. Run the portal build to confirm no type/runtime regression:

   ```bash
   npm run build --workspace newsnexus12portal
   ```

6. Commit (see section 6).

## 5. Why this is faster and safer than re-typing

| Approach | Time | Risk | Outcome |
|---|---|---|---|
| Re-type 25 suppressions per V01 plan | ~30 min | Mis-placed comments; inconsistent reason text per file | Lint passes with newly written reasons |
| `git checkout ae7f58f^ -- portal/src` (this plan) | ~5 min | None — only commit touching `portal/src` since phase 8 | Exact restoration of every committed-and-reviewed suppression |

The reverse-restore is mechanical and uses content that already
survived previous review (in commits up through `ccfd524
chore(portal-lint): phase 8 restore lint gate`). The re-type approach
would produce 25 fresh comments that may differ slightly in placement,
phrasing, or reasoning from the ones the team previously agreed on.

## 6. Commit guidance

Suggested title:

```text
fix: restore portal react-hooks suppressions deleted by ae7f58f
```

Suggested body:

```text
- restore 25 react-hooks/set-state-in-effect suppression comments
  under portal/src that were deleted by ae7f58f
- ae7f58f's body claimed the suppressions were "stale after dependency
  updates," but the rule still fires on the same patterns; the
  suppressions were not actually stale
- restoration uses git checkout ae7f58f^ -- portal/src so the comments
  are byte-identical to what phase 4 and phase 5 of the V02 portal lint
  cleanup committed and the team previously reviewed
- root package.json and package-lock.json from ae7f58f are not touched
```

## 7. Cross-platform note

Both the local macOS environment and the Ubuntu server use the same
git command. `git checkout <ref> -- <path>` behaves identically on
every OS where git is installed; no shell-specific quoting or pathspec
glob is needed. The command can be run as-is on the server after `git
fetch` brings the branch up to date.

## 8. What not to do

- Do **not** run `git revert ae7f58f`. That would undo the audit
  remediation in root `package.json` / `package-lock.json` along with
  the suppression deletion, regressing the audit work.
- Do **not** re-type the suppressions by hand if the restore works
  cleanly — wording drift across 25 files is the kind of thing that
  matters in a future grep.
- Do **not** lower `react-hooks/set-state-in-effect` severity from
  `error` to `warn`. The decision to keep it at `error` was made in
  phase 8 and should hold.
- Do **not** remove `--max-warnings=0` from `portal/package.json` lint
  script.

## 9. Process note for future audit work

To prevent the same regression from recurring on the next dependency
update:

- Treat `eslint-disable-*` comments as **load-bearing source code**,
  not "stale" comments. Removing them requires verifying the rule no
  longer fires at that exact line.
- Before deleting any lint suppression as part of dependency-update
  work, run `npm run lint --workspace <workspace>` both before and
  after the deletion on the same branch. If the count goes up, the
  suppression was still load-bearing.
- The audit remediation flow in
  `docs/20260522_VULNERABILITIES_ASSESSMENT_V02.md` does not currently
  call this out. Worth adding a one-line note there after this fix
  lands.
