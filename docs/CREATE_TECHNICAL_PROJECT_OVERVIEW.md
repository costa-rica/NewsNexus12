---
created_at: 2026-05-29T22:52:22Z
updated_at: 2026-08-05T21:32:12Z
created_by: claude (unknown-model) unknown-machine
modified_by: codex (gpt-5) macbook-air
---

# Create Technical Project Overview

A reusable workflow for AI coding agents operating inside a project repository. It produces one evidence-based document that gives a technically capable new contributor a working map of the project's technical reality.

This workflow is referred to as `create-technical-project-overview`. The project's purpose and strategic direction are recorded separately by `create-project-purpose-and-direction`.

---

## How to use this workflow

1. Open this file in NickVault, copy the entire prompt block below.
2. Paste it into your AI coding agent's first message inside the project repo.
3. Review the agent's questions before it writes; correct any wrong assumptions.
4. After the agent writes the file (default path: `docs/YYYYMMDD_TECHNICAL_PROJECT_OVERVIEW.md` if a `docs/` directory exists, otherwise `./YYYYMMDD_TECHNICAL_PROJECT_OVERVIEW.md` at the repo root), review it.
5. When the file is accurate, copy it into NickVault as `Context/onboardings/<Project>_Technical_Project_Overview.md`, using the canonical project name with underscores.

---

## The prompt

```
You are producing a single markdown document — `YYYYMMDD_TECHNICAL_PROJECT_OVERVIEW.md` (where `YYYYMMDD` is today's date, e.g. `20260521_TECHNICAL_PROJECT_OVERVIEW.md`) — that explains this project's technical reality. The reader is a technically capable contributor who has never seen this codebase. Give them the architectural understanding they would otherwise spend two weeks acquiring.

**Output path:** save the file at `docs/YYYYMMDD_TECHNICAL_PROJECT_OVERVIEW.md` if a `docs/` directory already exists at the repo root. If `docs/` does not exist, save it at `YYYYMMDD_TECHNICAL_PROJECT_OVERVIEW.md` at the repo root. Do **not** create a new `docs/` directory just for this file. Always prefix the filename with today's date in `YYYYMMDD_` format.

**Required YAML frontmatter:** the file MUST begin with a YAML frontmatter block delimited by `---` lines containing exactly these four keys:

```yaml
---
created_at: YYYY-MM-DDTHH:MM:SSZ
updated_at: YYYY-MM-DDTHH:MM:SSZ
created_by: <agent name> (<model>) <machine>
modified_by: <agent name> (<model>) <machine>
---
```

Rules:
- `created_at` and `updated_at` are UTC timestamps in `YYYY-MM-DDTHH:MM:SSZ` form.
- `created_by` and `modified_by` are both set to the same value on initial creation, using `<agent name> (<model>) <machine>` — lowercase only, no email addresses, no angle brackets in the actual value.
- On any future edit, only `updated_at` and `modified_by` are rewritten; `created_at` and `created_by` MUST NEVER be modified.

This document covers the technical side only. Strategic intent, business goals, and product objectives are owned by the project owner and documented separately. Do not invent objectives or claim you know "why" the project exists beyond what the code and configuration tell you.

## How to investigate

Before writing, in this order:

1. Read the top-level README and any `docs/` directory.
2. Read `package.json` / `pyproject.toml` / `go.mod` / `Cargo.toml` / equivalent — note language, framework, key dependencies.
3. Map the top-level directory structure. Note what each top-level directory contains.
4. Identify the entry points: server bootstrap, CLI entry, main function, route handlers.
5. Find the data layer — schemas, migrations, ORM models. Map the top 5-10 most important entities and their relationships.
6. Find the deployment surface — Dockerfiles, CI/CD configs, infrastructure-as-code, deploy scripts.
7. Identify external integrations — third-party APIs, message queues, auth providers.
8. Skim `tests/` for what's actually tested and how.
9. Check git log for the last 30 commits to see where active work is.

Resolve uncertainty from repository evidence first. Ask the user before writing only when an unresolved answer would materially affect the document's accuracy. Otherwise flag the uncertainty in the document and proceed.

## Output structure

Write the document with these sections, in this order. Skip a section only if it does not apply to this project (and say so if you skip).

### 1. One-paragraph summary
What does this project do, technically? What does it produce or consume? Length: 3-5 sentences. No marketing language.

### 2. Tech stack
- Language(s) and version(s)
- Framework(s) and key libraries (only the structurally important ones — not every dependency)
- Database(s) and storage
- Runtime / deployment target

### 3. Repository layout
Tree-style listing of top-level directories and their purpose. One line per directory. Highlight the 3-5 most important paths a new engineer should read first.

### 4. Architecture
The shape of the system. How requests flow through it. Where the boundaries are. Use a diagram if one fits in ASCII or Mermaid; otherwise prose. Cover:
- Components and how they communicate
- Where state lives
- Synchronous vs asynchronous paths
- Any background jobs or workers

### 5. Data model
The 5-10 most important entities. For each: name, what it represents, key relationships. A migrations folder summary if the project has one.

### 6. External integrations
Every external service this project talks to. For each: which service, what it's used for, how authentication works, where the credentials are configured.

### 7. Running it locally
Concrete steps. Assume the reader has the repo cloned. Cover prerequisites, environment variables, dependency install, dev server, common gotchas.

### 8. Deployment
How code gets to production. Trigger, pipeline, target environment, rollback story. If there is no deployment story (early-stage), say so.

### 9. Testing
What's tested, how, and how to run the tests. Be honest about coverage gaps if they're obvious.

### 10. Active areas of work
Based on the last 30 commits and any TODO/FIXME/WIP markers: what is the team currently focused on? Where are the rough edges? List 3-5 items.

### 11. Open questions for the project owner
What did you find unclear, contradictory, or undocumented that the project owner should clarify? List as bullet points. This is the most valuable section for the owner.

## Constraints

- **Be terse.** Every sentence should earn its place.
- **No code dumps.** Reference files by path; do not paste large blocks. A code excerpt of 5-10 lines is fine when it's the most efficient way to convey a pattern.
- **No filler.** Skip phrases like "this project is interesting because" or "modern stack." State facts.
- **Cite paths.** When you make a claim, point to the file or directory that supports it: `(see src/api/routes.ts)`.
- **Flag uncertainty.** "Appears to" / "based on commits since X" is better than asserting something you inferred.
- **No invented "why".** If you cannot tell from the code why a choice was made, say so or skip it.
- **Target length: 800-1500 words.** If the project genuinely needs more, ask before exceeding 1500.

## Before you write

Resolve these from repository evidence when possible. Ask the user only when the answer is unresolved and would materially affect accuracy:

1. Whether to override the default output path because the project has a different documentation convention.
2. Whether any non-obvious directories should be ignored as generated, vendored, or archived.
3. Whether an existing technical project overview should be updated instead of creating a new snapshot.

After resolving any material question, investigate and write the file. Report the path and a one-paragraph summary of its contents.
```

---

## Notes for Nick

- What this does not capture: strategic intent, the user or customer, why the project exists, what done looks like, and the underlying bets. The matching Project Purpose and Direction document owns that layer.
- NickVault copy: after review, update `Context/onboardings/<Project>_Technical_Project_Overview.md` as an undated living document with four-key, machine-bearing frontmatter.
- Refreshing: projects evolve. Re-run the workflow every quarter or after a major refactor. The agent should diff against the previous file rather than rewriting from scratch.
