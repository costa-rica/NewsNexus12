---
created_at: 2026-10-02T21:45:06Z
updated_at: 2026-10-02T21:45:06Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Weekly Flow 02 Phase 1 Todo V01 Assessment

## Summary

The todo follows Plan V04 closely. The phase ordering is sensible: config and tests first, then request, coordinator, local fixture, and the Ubuntu run. The closeout steps are thorough.

Two concerns qualify under the Todo Assessment criteria. Both are about what happens at the first commit and the first test run, so they should be fixed before implementation starts.

## Concern 1: The Phase 1 `test` script names a test file that does not exist until Phase 2

Criteria: a task will break or mislead verification; ambiguity for the implementer.

Implementation Phase 1 asks for the plan's exact `test` script, which passes two compiled paths to `node --test`:

- `dist-test/tests/config.test.js`
- `dist-test/tests/weekly-flow-02/01_clearDuplicateAnalyses.test.js`

The second file is not created until Implementation Phase 2. Phase 1 verification still says to run the configuration test "through the new workspace test command." What happens depends on the Node version:

- **Node 24 (this machine):** a listed path that does not exist is treated as a pattern with no matches. The run silently executes only the files that exist and exits 0. I verified this in a scratch directory: one real file plus one missing path gave `pass 1`, `fail 0`, exit status 0.
- **Node 20 (the declared minimum):** Node 20 handles a missing path differently from Node 24, and this was not tested here. The phase can only close out cleanly if it doesn't error.

The Node 24 behavior is the bigger problem beyond Phase 1. Suppose a test file is later renamed, or never emitted because of a typo in a path or in `tsconfig.test.json`. The test command would still pass, with fewer tests. That weakens the guarantee that failures stop the flow, because the coordinator failure tests are the ones that check it.

Recommendation:

- In Implementation Phase 1, the `test` script lists only `dist-test/tests/config.test.js`. Implementation Phase 2 adds the second path when it creates that file.
- Each closeout step records the test count, and checks that both test files reported results (or that the count did not drop below the previous phase's count). Phase 2 and Phase 3 already ask for test counts; Phase 1 should too.

## Concern 2: Scope of the existing uncommitted Phase 1 rename is unclear

Criteria: the implementer would be confused; risk of a broken commit.

The worktree already contains uncommitted ops changes that this todo depends on:

- `M ops/src/weekly-flow-02/coordinator.ts`: the import changed to `./phases/01_clearDuplicateAnalyses`, plus a quote-style reformat.
- `D ops/src/weekly-flow-02/phases/clearDuplicateAnalyses.ts`
- `?? ops/src/weekly-flow-02/phases/01_clearDuplicateAnalyses.ts`
- `M ops/.env.example`: the two new variables, currently with timeout `30`.

The working agreement says to "preserve unrelated operator changes" and to commit "only Phase N files." These four changes are not unrelated: they are the `01_` rename that Phases 2 and 3 edit.

The todo does not say whether they belong to the operator or to this increment. An implementer that leaves them unstaged will produce broken commits:

- If Phase 2 commits `01_clearDuplicateAnalyses.ts` without the coordinator import change and the deletion, `HEAD` contains both phase files. The coordinator would still import the old stub.
- If Phase 3 commits `coordinator.ts`, the operator's quote-style reformat is swept in as well.

Phase 1 also edits `ops/.env.example`, a file the operator has already changed. Its "Preserve any existing operator edits" item conflicts with replacing the operator's `30` with `90`.

Recommendation: add a short "Phase 0" or a precondition. Either the operator commits the rename (the coordinator import, the deletion, the new `01_` file and the `.env.example` additions) before Implementation Phase 1, or the todo states that Implementation Phase 1 commits them as part of its scope. Also say explicitly that the timeout value in `ops/.env.example` changes from 30 to 90.

## Non-blocking note: the README temporary-log check will need the new variables

The existing README temporary-log check supplies `NODE_ENV`, `NAME_APP`, `PATH_TO_LOGS` and the log settings inline, and relies on `ops/.env` for anything else.

After Implementation Phase 1, `URL_BASE_NEWS_NEXUS_PYTHON_QUEUER` and `WORKER_PYTHON_REQUEST_TIMEOUT_SECONDS` are required. On a checkout without `ops/.env`, the check fails at startup. After Implementation Phase 3, it also makes a real DELETE request against whatever worker `ops/.env` names.

The Phase 3 README task should explicitly rewrite or retire this check. If it is kept, it should point at the controlled fixture from Phase 4, never at a real worker.

## Not concerns (checked)

- **Alignment with Plan V04:** the config split, base directory, strict timeout parser, `.gitignore`, clean builds, request seam, failure and rerun rules, and the persistence boundary all match.
- **Phase 4 timeout check:** the "short test-specific timeout" is achievable with `WORKER_PYTHON_REQUEST_TIMEOUT_SECONDS=1` against a delayed fixture.
- **Phase 5:** the safety gates (confirm the database target before the destructive call, no systemd, record limitations rather than claiming success) are appropriate.
