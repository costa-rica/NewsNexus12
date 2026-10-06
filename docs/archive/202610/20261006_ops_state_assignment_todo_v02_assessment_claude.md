---
created_at: 2026-10-06T16:57:00Z
updated_at: 2026-10-06T16:57:00Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Ops State Assignment Todo V02 Assessment

## Summary

The todo covers every plan V06 requirement:

- Only the source job is normalized from a V04 marker.
- Attempt identity is exact `jobId + jobCreatedAt`.
- The `replacementJobId` completion check is removed.
- One protected continuation-start operation is used for every replacement reason.
- The three completion chains from the plan are tested.
- The systemd restart warning is included.

One concern qualifies. The phase split does not match how the code depends on itself, so the Phase 1 and Phase 2 checkpoints cannot pass as written.

## Concern 1: Phase 1 and Phase 2 checkpoints cannot pass

Criteria: a task will break existing code, and an implementing agent would be confused about scope.

Each phase must pass the ops type check, tests, and build before its commit. The work is split by layer, but the layers depend on one shared type and one shared method.

### Phase 1

Phase 1 says "Change `PhaseSixIncompatibleContractRecovery` to contain an `attempts` array." That type (`ops/src/weekly-flow-02/persistence.ts`) is used with its V04 fields in all of these files:

- `sequelizePersistence.ts`
- `phases/06_runStateAssignment.ts` (`markerInput`, `markerRole`, `cancelIncompatibleJob`)
- `tests/weekly-flow-02/persistenceTestSupport.ts`
- `persistence.test.ts`
- `06_runStateAssignment.test.ts`

Changing it in Phase 1 breaks type checking in every one of them. Those files are only updated in Phases 2 and 3.

### Phase 2

Phase 2 replaces `recordPhaseSixIncompatibleReplacementStarted`, but the runner still calls it until Phase 3. Phase 2 also lists "Use the protected operation for replacements of failed, canceled, ..." jobs. That is runner work, which Phase 3 repeats.

### Likely result

An implementing agent will either pull Phase 3 runner changes into Phase 1 or 2, or skip the type check. Either way the phase commits and checkoffs stop matching the todo.

### Where normalization lives

The todo does not say where the V06 parser and V04 normalizer go. The runner and both persistence implementations each parse `phaseData.phase6` themselves today. Separate copies can disagree.

One example: Phase 2 persists the V06 shape "on the first successful Phase 6 recovery write." A legacy run whose compatible replacement completes might never make a recovery write. Its V04 marker then reaches `recordPhaseSixCompleted` unconverted. If completion reads the raw marker and not the shared normalizer, the old slot can still decide the outcome.

### Recommendation

- In Phase 1, add the attempt types, V06 parser, and V04 normalizer as new exports in one shared module. Leave the existing `PhaseSixIncompatibleContractRecovery` type and its callers alone. Phase 1 then type-checks.
- In Phase 2, switch both persistence implementations and their progress input type to the shared helpers. Add the new continuation-start operation. Keep the old method as a thin wrapper over it until the runner moves.
- In Phase 3, switch the runner, remove the old type, method, wrapper, and `markerRole`, and use the protected operation for every replacement reason. Move the "use the protected operation for replacements of ..." list from Phase 2 into Phase 3.
- State that the runner, `recordPhaseSixProgress`, and `recordPhaseSixCompleted` all read Phase 6 marker data through the shared normalizer. Say that any Phase 6 write persists the V06 shape, not only recovery writes.
- Add a persistence test where a legacy run's compatible replacement completes without any earlier incompatible-attempt write.
