---
created_at: 2026-05-29T22:52:22Z
updated_at: 2026-08-05T21:32:12Z
created_by: claude (unknown-model) unknown-machine
modified_by: codex (gpt-5) macbook-air
---

# Create Project Purpose and Direction

A reusable workflow for producing one document that explains why a project exists, what purpose it serves, and where it is going.

This workflow is referred to as `create-project-purpose-and-direction`. It pairs with the Technical Project Overview, which owns technical reality. Together they form the project's living project context.

The prompt is single-pass. The operator supplies or identifies the available inputs in the initial request. The agent does not pause for questions or confirmation; unresolved material becomes explicit open questions in the document.

---

## How to use this workflow

1. Copy the prompt block below into the agent's first message.
2. Include or identify the source documents the agent should use.
3. Name the project and desired repository output path when it differs from the default.
4. Review the completed repository document.
5. When accurate, update `Context/onboardings/<Project>_Purpose_And_Direction.md` in NickVault, using the canonical project name with underscores.

---

## The prompt

```
Produce one Markdown document named `YYYYMMDD_PROJECT_PURPOSE_AND_DIRECTION.md`, using today's date, that explains this project's purpose, spirit, current state, and intended direction.

The reader is a capable collaborator who has never seen the project. Give them the understanding they would otherwise spend two weeks of meetings acquiring.

This is a single-pass request. Use the documents supplied or identified by the operator and any accessible matching Technical Project Overview. Do not pause to request more documents, ask blocking questions, summarize for confirmation, or wait for another response. Record material gaps and unresolved questions in the final section instead of guessing.

Do not infer product strategy from the codebase. The objective must come from operator-provided material, existing product documents, and explicit operator statements.

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

## Inputs

Use whatever relevant material the operator supplied or identified, including:

- the matching Technical Project Overview;
- proposals, pitch decks, and statements of work;
- customer research and interview notes;
- sales or marketing material;
- strategic memos, OKRs, and roadmaps;
- competitive analyses and meeting notes;
- public product artifacts.

Cite the source of each material claim. Distinguish operator statements, documentary evidence, and inference.

## Output structure

Use these sections in order:

1. One-paragraph summary
2. Purpose
3. People served
4. The problem
5. Intended value
6. Spirit and principles
7. Strategic bets and assumptions
8. Current state
9. Intended direction
10. What success means
11. Open risks and unknowns
12. Open questions for the project owner

For an unsupported section, state `Not established in the supplied material` and briefly identify what is missing. Do not invent an answer.

The final open-questions section contains only questions whose answers would materially improve the onboarding document. Do not require answers before completing this version.

## Constraints

- Be terse and factual.
- Cite sources near the claims they support.
- Label inference as inference.
- Do not invent strategy, metrics, customers, or rationale.
- Avoid marketing language.
- Target 1,000–1,800 words.
- Do not exceed 1,800 words unless the operator authorized it in the initial request.

Write the file in this pass. Report its path and summarize its contents in one paragraph.
```

---

## Notes for Nick

- This captures why the project exists, who it serves, the problem and intended value, its spirit and principles, strategic bets, current state, direction, success, and risks.
- Sparse inputs produce an honest document with explicit gaps, not a fabricated strategy.
- The matching Technical Project Overview remains the technical half.
- After review, update `Context/onboardings/<Project>_Purpose_And_Direction.md` as an undated living document with four-key, machine-bearing frontmatter.
- Refresh after a major pivot, funding event, or customer change.
