---
created_at: 2026-05-21T23:27:44Z
updated_at: 2026-11-03T19:48:16Z
created_by: nick
modified_by: claude (opus-5.5) nicksmacbookair
---

# AGENTS.md

This file provides guidance to agent / engineers when working with code in this repository.

## Repository Authority

1. The operator's instructions for the current task have the highest authority.
2. Except for operator instructions, this `AGENTS.md` file is the primary repository authority.
3. If it exists, the `docs/_CANONICAL_RULES.md` is the second repository authority and contains detailed project-specific production rules.
4. When instructions conflict, follow the higher authority in this order: operator instructions, `AGENTS.md`, then `docs/_CANONICAL_RULES.md`.
5. If `docs/_CANONICAL_RULES.md` exists, read it completely before creating or revising any project artifact and follow all applicable rules.


## Honesty

- Do not lie, exaggerate, embellish, or create a misleading impression.
- Make claims only when supported by the operator's statements, source documents, or inspected work.
- Do not present an inference, exposure, or interest as experience.
- When evidence is missing or unclear, use a narrower factual statement, omit the claim, or ask the operator.
- Tailoring may change emphasis, but never the facts.

## Chat responses

- Keep chat responses under 100 words, excluding code, folder trees, and tables.
- Prefer numbers, bullets, sections, and subsections.
- Avoid long paragraphs.

## Workflows

Workflows are named instruction files. When the operator invokes one by name, read the referenced file and follow it.

### plan-and-vet

See `docs/PLAN_AND_VET.md`.

## Creating Markdown Files

These defaults apply throughout the project unless the operator or another applicable authority document instructs differently. Preserve established fixed filenames such as `AGENTS.md`, `README.md`, and named authority or workflow files.

### Filenames

The default naming pattern should be

- prefix date using the `YYYYMMDD_` format
- descriptive name in lowercase
- use "\_" in place of spaces
- end new Markdown filenames with `_v##`, starting at `_v01` and incrementing through `_v99`

### YAML frontmatter

Every generated `.md` file will begin with a YAML frontmatter block delimited by `---` lines containing exactly these four keys:

```yaml
---
created_at: YYYY-MM-DDTHH:MM:SSZ
updated_at: YYYY-MM-DDTHH:MM:SSZ
created_by: <agent name> (<model>) <machine>
modified_by: <agent name> (<model>) <machine>
---
```

Rules:

- `created_at` / `updated_at` are UTC timestamps in ISO 8601 format: `YYYY-MM-DDTHH:MM:SSZ`. Use a 24-hour clock and include zero-padded hours, minutes, and seconds; the trailing `Z` identifies UTC.
- `created_at` is set once, at file creation, and MUST NEVER be modified on later edits.
- `updated_at` is rewritten to the current UTC timestamp on every modification.
- `created_by` is set once, at file creation, and MUST NEVER be modified on later edits.
- `modified_by` is rewritten on every modification. On the very first write, set it to the same value as `created_by`.
- The `created_by` / `modified_by` value uses the format `<agent name> (<model>) <machine>`, lowercase only, with no email addresses and no angle brackets. The machine is mandatory so the operator can identify which host wrote the file.
- Exception: `nick` (the operator) is a valid `created_by` / `modified_by` value for files the operator writes.

Acceptable examples:

```yaml
created_by: claude (opus-4.7) macbook-air
created_by: codex (gpt-5.5) fsdc-avatar09
modified_by: claude (haiku-4.5) macbook-air
```

### Archive Subfolder

- Really old docs are moved into `docs/archive/`.
- Organized into per-month subfolders named `YYYYMM/` (e.g. `202604/`).
- Not every month will have a folder — only months with archived files exist.
- Usually managed by the operator, not the AI coding agent.
- Agents: these files are kept for reference only; do not review them when scanning the project to build context.

## Human-readable documents

Treat these as strong operator preferences rather than strict requirements. If they conflict with a requested document structure, template, or established heading hierarchy, preserve the intended structure and adapt these preferences to fit.

- Use plain, human-readable language.
- Do not use bold text.
- Prefer bullets and numbering over long paragraphs.
- Keep each paragraph under 50 words.
- Multiple short paragraphs are acceptable.
- Keep sections focused and easy for the operator to scan and answer.

## Open questions created by agents

Use an open-questions section when the operator asks for one or when unresolved decisions would materially help the document.

- Make open questions the final section of the PRD, plan, or other agent-authored document.
- Use `## Open Questions` as the section heading.
- If the document's required structure uses different heading levels, adjust the hierarchy while preserving the pattern below.
- Give each question its own numbered `###` heading.
- Keep the numbered question heading description to 40 characters or fewer.
- Put the full question below its heading.
- Focus each question on one decision.
- Bullets are acceptable when they make choices or context easier to scan.
- Add a `#### Operator Response` subsection under every question.
- Leave the operator response empty unless an agent recommendation would be useful.
- When providing a recommendation, begin it with the agent's name in parentheses.
- Prefer recommendations under 30 words.
- Apply the human-readable document preferences to questions and recommendations.

Example:

```markdown
## Open Questions

### 1. Default date range

Should a report without dates cover the trailing seven days, including today?

#### Operator Response

(codex) Recommend the trailing seven days in the Toggl user timezone.
```

## Commit Message Guidance

### Guidelines

- Only generate the message for staged files/changes
- Title is lowercase, no period at the end.
- Title should be a clear summary, max 50 characters.
- Use the body to explain _why_ and the main areas changed, not just _what_.
- Bullet points should be concise and high-level.
- Try to use the ideal format. But if the commit is too broad or has too many different types, then use the borad format.
- When committing changes from TODO or task list that is already part of the repo and has phases, make refernce to the file and phase instead of writing a long commit message.
- Add a commit body whenever the staged change is not trivially small.
- A body is expected when the commit:
  - touches more than 3 files
  - touches more than one package or app
  - includes both implementation and tests
  - adds a new route, component, workflow, or integration point
- For broader commits, the title can stay concise, but the body should summarize the main change areas so a reader can understand scope without opening the diff.
- Do not use the body as a file inventory. Summarize the logical changes in 2-5 bullets.
- append co-authored-by line(s) at the end of the commit message
  - format: `co-authored-by: <agent name> (<model>)`
  - examples:
    - `co-authored-by: claude (sonnet-4)`
    - `co-authored-by: codex (gpt-5)`
- never include emails or angle brackets (`< >`)
- use lowercase only
- if multiple agents contributed, add one line per agent (no bullets, just separate lines)

### Format

#### Ideal Format

```
<type>:<space><message title>

<bullet points summarizing what was updated>
```

#### Broad Format

```
<message title>

<bullet points summarizing what was updated>
```

#### Types for Ideal Format

| Type     | Description                           |
| -------- | ------------------------------------- |
| feat     | New feature                           |
| fix      | Bug fix                               |
| chore    | Maintenance (e.g., tooling, deps)     |
| docs     | Documentation changes                 |
| refactor | Code restructure (no behavior change) |
| test     | Adding or refactoring tests           |
| style    | Code formatting (no logic change)     |
| perf     | Performance improvements              |
