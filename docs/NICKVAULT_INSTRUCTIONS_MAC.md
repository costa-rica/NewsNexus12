---
created_at: 2026-08-05T16:50:25Z
updated_at: 2026-08-05T16:50:25Z
created_by: codex (gpt-5) macbook-air
modified_by: codex (gpt-5) macbook-air
---

# NickVault Instructions

## Path block

- Host profile: macOS `macbook-air`
- Vault root: `/Users/nick/Documents/NickVault`
- Crosswalk: `/Users/nick/Documents/NickVault/_canon/crosswalk.md`
- Context root: `/Users/nick/Documents/NickVault/Context`
- Vault reachable: yes

## Purpose

This template tells a network project agent, or NPA, how to work with NickVault. The project repository's `AGENTS.md` should point to its local copy of this file rather than repeat these rules.

## Read boundary

1. Read the project repository's own instructions.
2. Read the vault's `_canon/spec-document-map.md` using the vault root above.
3. Follow the NPA tier-one boundary in that map.
4. Read tier-two content only when the operator directs it.

## Resolve the project

`_canon/crosswalk.md` is authoritative for entries it contains and intentionally not exhaustive.

- Use the canonical name from the project's entry.
- A missing entry means the project has not been onboarded yet; it is not an invalid project or a crosswalk defect.
- Do not infer the canonical name from the repository or directory name.
- If the project cannot be resolved, report that and stop name-dependent vault work.

When the operator asks for a crosswalk proposal, provide:

1. canonical project name;
2. aliases;
3. client;
4. repositories and URLs;
5. absolute repository paths by machine.

The operator consolidates the proposal. Do not edit the crosswalk unless directed.

## Write to the vault

1. Sync before writing.
2. Write only when the operator or repository instructions direct it.
3. Follow `_canon/spec-context.md` for Context files and onboarding documents.
4. Append to existing context; do not delete or silently rewrite prior material.
5. Sync after writing and report the path changed.

Every Markdown file written into the vault uses exactly four frontmatter keys unless canon defines an exemption:

```yaml
---
created_at: YYYY-MM-DDTHH:MM:SSZ
updated_at: YYYY-MM-DDTHH:MM:SSZ
created_by: <agent> (<model>) <machine>
modified_by: <agent> (<model>) <machine>
---
```

Preserve `created_at` and `created_by` on later edits. Use UTC timestamps and machine-bearing lowercase identity values.

If the path block says the vault is unreachable, or access fails, do not invent a substitute vault path. Write the proposed artifact into the project repository's `docs/` directory and report both the fallback path and the access failure.

## Fail loudly

Report missing knowledge, unresolved names, inaccessible paths, and unsupported operations. Do not guess, invent a project name, or improvise a new document shape.
