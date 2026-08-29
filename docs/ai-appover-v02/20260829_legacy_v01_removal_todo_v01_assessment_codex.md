---
created_at: 2026-08-29T21:50:03Z
updated_at: 2026-08-29T21:50:03Z
created_by: codex (gpt-5.6) nicksmacbookair
modified_by: codex (gpt-5.6) nicksmacbookair
---

# Assessment of Legacy Orchestrator and AI Approver V01 Removal Todo V01

Assessed document: `docs/ai-appover-v02/20260829_legacy_v01_removal_todo_v01.md`

## Summary

The todo is detailed and aligned with the passed plan, including article-content preservation, obsolete package deletion, and clean generated outputs. One sequencing concern meets the todo-assessment threshold because the required Phase 2 commit would break downstream package compilation.

## Qualifying Concern

### 1. Shared exports are removed before consumers

Phase 2 deletes the four shared Sequelize models and their exports, then requires a Phase 2 commit after testing only db-models and db-manager. Worker-node cleanup does not occur until Phase 3, and API cleanup does not occur until Phase 5.

Current repository dependencies make the Phase 2 commit invalid:

- `worker-node/src/modules/orchestrator/repository.ts` imports `OrchestratorRun` and `OrchestratorRunStep` from `@newsnexus/db-models`.
- `worker-node/src/modules/orchestrator/types.ts` imports the four orchestrator type exports that Phase 2 removes.
- `api/src/routes/adminDb.ts` imports and registers all four deleted models.
- `api/src/routes/analysis/ai-approver.ts` imports both deleted V01 AI Approver models.

After Phase 2, worker-node and API can no longer compile against the rebuilt local db-models package. The todo then requires committing this broken state and carrying the API failure across Phases 3 and 4. That conflicts with its rule to fix relevant phase failures before proceeding and with the workflow expectation that phase-end checks preserve functionality.

Why this meets the threshold:

- A task explicitly breaks existing code at a required commit boundary.
- An implementing agent following the todo cannot make the Phase 2 repository build clean without doing work assigned to later phases.
- The failure is deterministic and visible from current imports, not hypothetical.

Recommendation:

1. Remove downstream worker-node and API consumers before removing the shared exports, or move shared-model deletion into a later integration phase after both consumer cleanups.
2. Keep the importer attribute-filtering work and pre-removal fixture preparation early if useful, but defer post-removal assertions until the model graph is actually removed.
3. At every phase that changes shared-model consumers or providers, build db-models first and compile both API and worker-node before committing.
4. Preserve the existing operator backup gate before the model-removal phase.

## Result

- Todo status: revision required.
- Operator decision: none; this is a repository-resolvable sequencing correction.
- Implementation status: not ready until the todo phase order and commit boundaries are corrected.
