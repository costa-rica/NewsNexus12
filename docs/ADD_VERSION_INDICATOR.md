---
name: Add Version Indicator
description: Instructions for AI coding agents to add a small git-derived "version X.Y" indicator to an app's UI, computed from commit counts at build time, with npm-workspace guidance and operator-driven placement.
created_at: 2026-06-22
updated_at: 2026-06-22T21:18:20Z
created_by: claude (opus-4.8)
modified_by: codex (gpt-5) nicks-macbook-air
---

# Add Version Indicator

This skill instructs an AI coding agent how to add a small, always-visible version indicator
(e.g. `version 55.0`) to an application's UI. The version is **derived from git commit counts** —
never a hand-maintained number — and is computed at build time so it works in a deployed bundle
that has no `.git` at runtime.

## When to use

- The operator wants a version shown in the app (commonly a footer) that updates automatically as
  the repo evolves.
- The project is a git repository with a stable trunk branch (usually `main`).

## Version scheme (framework-agnostic — this part never changes)

Display the string:

```
version {main_count}.{branch_count}
```

- `main_count` = number of commits on the trunk as of the point where the current `HEAD` branched
  off. On the trunk itself this is the full trunk commit count.
- `branch_count` = number of commits made on the current branch since it diverged from trunk.
  On the trunk this is `0`.

This makes the number **repo-comprehensive**: because a single repo `.git` tracks everything, a
commit anywhere (any package, docs, config) increments the count. Comprehensiveness comes from git,
not from the build system. Nothing is stored or "incremented" by the app — git is the counter and
the app only reads it.

### Computation

Use `git merge-base` to find the divergence point, then two commit counts:

```sh
BASE=$(git merge-base HEAD main)         # use the project's actual trunk name
MAIN_COUNT=$(git rev-list --count "$BASE")
BRANCH_COUNT=$(git rev-list --count "$BASE"..HEAD)
echo "${MAIN_COUNT}.${BRANCH_COUNT}"
```

On the trunk, `BASE == HEAD`, so `branch_count` is `0` → e.g. `55.0`. On a feature branch,
`main_count` freezes at the divergence point and `branch_count` rises per commit → e.g. `55.3`.
If a branch is created from another unmerged branch, it inherits that branch's existing
`branch_count` and continues counting from the same trunk divergence point.

### Fallback

Wrap the computation in error handling. If git is unavailable, `.git` is missing (stripped/shallow
bundle), or the trunk branch can't be resolved, fall back to the literal string **`dev`** so the
UI shows `version dev` rather than crashing or showing a blank.

### Single source of truth

Put the git logic in **one** small script (e.g. `scripts/appVersion.mjs` at the repo root) that
returns the version string. Every consumer calls that one script — do not duplicate the git
commands across packages.

## Build-time injection (why, and how)

A deployed front end is usually a compiled bundle with no `.git` at runtime, so the version must be
captured **at build time (and dev-server startup) and baked into the bundle**. The generic pattern:
run the shared script during the build, expose its output as a build-time constant or public
environment variable, and have the UI read that constant. (For example, in Next.js: call the script
in `next.config` and set `env: { NEXT_PUBLIC_APP_VERSION }`; in Vite: inject via `define`; for a
plain Node service: read it at startup and expose on a status endpoint.)

## Build system: strongly prefer npm workspaces

**Strongly encourage migrating the repo to npm workspaces** when it is npm-based and not already
set up that way. With a single root `package.json` (`"private": true`,
`"workspaces": [...]`) and root scripts, one `npm install` / `npm run build` covers every package.
This keeps the displayed version **fresh on every build** (a root build rebuilds the UI package too,
so the baked number never lags behind a change shipped in another package) and gives the shared
version script a natural home at the repo root.

This is usually low-risk: app code is untouched, and the change is reversible (root manifest +
deduped lockfile). Confirm there is no deploy pipeline that depends on per-package installs before
migrating; if there is, adjust it or skip the migration.

**If the project does not use npm, or a workspace migration is too complex / out of scope, still
apply this skill** — only the wiring changes, not the version scheme:

- Keep the same git formula and the same single shared script (in whatever language fits — a shell
  script, a Makefile target, etc.).
- Invoke it from each build that needs the version (a per-package prebuild step, a Makefile, a CI
  step that exports the value as an environment variable, or a generated version file committed by
  CI).
- If the UI and a backend are built separately, accept that each carries the version from its own
  last build, or compute once in CI and inject the same value into both.

The non-negotiable parts are: the **git-commit-count formula**, the **`dev` fallback**, **build-time
capture**, and a **single source of truth** for the logic. The build plumbing adapts to the project.

## Placement: ask the operator, and recommend

Where the indicator appears is a design choice. The agent MUST:

1. **Ask the operator** where they want the version indicator placed (e.g. global footer, a settings
   / about screen, a status endpoint, the top bar).
2. **In the same message, give a concrete recommendation** with brief reasoning — do not ask
   open-endedly without a default. Base the recommendation on the actual layout: read the root
   layout and the main page/shell component, and consider:
   - Is there a shared layout/footer rendered on every route, or a single dominant shell component?
   - Does a full-viewport shell leave no neutral area outside it (so a footer belongs inside the
     shell rather than in the root layout)?
   - Where will the indicator be **persistently visible** and **stably positioned** (not riding
     unrelated animations or scrolling away)?
   - Which placement reaches the most pages with the least structural change?

   State the recommended location, why, and what would change to implement it; let the operator
   confirm or override.

## Display

- Render small and muted; the label format is `version {string}` (e.g. `version 55.0`,
  `version 55.3`, or `version dev`).
- Match the app's theme (dark/light) and existing alignment/padding conventions.

## Verification

1. **Trunk:** on the trunk branch the script returns `{main_count}.0`.
2. **Branch:** create a feature branch, add a commit, recompute → `main_count` stays anchored to the
   divergence point and `branch_count` increments (e.g. `…​.1`).
3. **Fallback:** run where git/trunk is unavailable → returns `dev`; UI shows `version dev`.
4. **Build:** a clean build injects the value; the running app displays it at the agreed location,
   persistently visible and correctly themed.
