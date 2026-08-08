---
created_at: 2026-05-29T22:52:22Z
updated_at: 2026-08-05T23:02:07Z
created_by: claude (unknown-model) unknown-machine
modified_by: codex (gpt-5) macbook-air
---

# Create Project Purpose and Direction

A reusable guide for deciding whether a project needs a purpose-and-direction document and, when useful, producing one that explains why the project exists.

This workflow is referred to as `create-project-purpose-and-direction`. It covers context that is distinct from the repository's technical reality, which remains the responsibility of the Technical Project Overview.

The document is optional. A script, investigation, experiment, or repository ancillary to a larger project may not need an independent purpose-and-direction document. The agent and operator decide this before writing.

---

## How to use this workflow

1. Copy the prompt block below into the agent's first message.
2. Identify the project and any repository or external documents the agent should review.
3. Let the agent review those materials and discuss whether a separate purpose-and-direction document would be useful.
4. If the document is useful, agree on any sections needed beyond the one-paragraph summary and purpose.
5. Review the completed repository document.
6. When the operator wants a living NickVault profile and the project has a canonical crosswalk entry, update `Context/project_profiles/<Project>_Purpose_And_Direction.md` using the canonical project name with underscores.

---

## The prompt

```
Help the operator decide whether this project needs a separate purpose-and-direction document. The document, when useful, should give a new collaborator concise context about why the project exists without duplicating its technical overview.

Review the documents the operator supplies or identifies. These may be inside the repository or at external paths. Use only the identified external material; do not expand the review into unrelated files.

After reviewing the available material, tell the operator whether a separate document appears useful and why. Ask whether the operator wants it created. A separate document may be unnecessary when the work is a script, investigation, experiment, ancillary repository, or already covered adequately by an authoritative brief, PRD, statement of work, or parent-project document.

If the operator has already confirmed that the document is needed, do not ask again.

Before writing, discuss whether the supplied material calls for any sections beyond the two listed below. The operator decides which additional subjects are useful. Do not introduce additional sections by default.

Do not infer purpose or strategy from implementation details. Base the document on operator statements and the supplied or identified purpose-bearing material. Use technical detail only when it is needed to explain the purpose.

## Output path

Save to `docs/YYYYMMDD_PROJECT_PURPOSE_AND_DIRECTION.md` when `docs/` exists at the repository root. Otherwise save to `YYYYMMDD_PROJECT_PURPOSE_AND_DIRECTION.md` at the root. Do not create `docs/` solely for this file.

## Required frontmatter

Begin with exactly four keys:

```yaml
---
created_at: YYYY-MM-DDTHH:MM:SSZ
updated_at: YYYY-MM-DDTHH:MM:SSZ
created_by: <agent name> (<model>) <machine>
modified_by: <agent name> (<model>) <machine>
---
```

Use UTC timestamps and lowercase machine-bearing identity values. On later edits, preserve `created_at` and `created_by`; update only `updated_at` and `modified_by`.

## Output structure

Unless the operator agrees to additional sections, create only:

1. One-paragraph summary
2. Purpose

Additional sections are chosen through discussion with the operator, especially when external documentation contains context that would be useful to preserve. The former standard list of recommended sections does not apply.

## Constraints

- Keep the document useful, concise, and distinct from technical documentation.
- Cite identified source documents where that helps the reader trace important context.
- Do not invent strategy, metrics, customers, rationale, or missing context.
- Let the supplied material set the length and never pad the document.
- Do not exceed 1,800 words.
- Do not modify, create, or delete any file other than the output document. Do not run builds, installs, migrations, or tests. Do not commit or push.

When the operator confirms the document is needed and the sections are settled, write it and report its path. If the operator decides it is unnecessary, do not create a file and briefly record that outcome in the response.
```

---

## Notes for Nick

- A short document is a valid result.
- No document is also a valid result when a separate purpose layer would not add useful context.
- The operator and agent choose any sections beyond the summary and purpose after reviewing the available material.
- External files may be used when the operator identifies them for review.
- The Technical Project Overview remains separate and does not require a matching purpose-and-direction document.
- After review, update `Context/project_profiles/<Project>_Purpose_And_Direction.md` only when the operator wants a living profile for a canonical project.
- Refresh after a major pivot, funding event, or customer change.
