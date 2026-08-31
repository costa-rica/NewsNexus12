---
created_at: 2026-08-31T22:04:24Z
updated_at: 2026-08-31T22:19:07Z
created_by: claude (claude-opus-5) nicksmacbookair
modified_by: claude (claude-opus-5) nicksmacbookair
---

# Weekly Article Processing Cron PRD V02 — Assessment (claude)

## Scope of this assessment

The operator asked for a plan-and-vet style assessment applied to a PRD rather than a plan, using the
`docs/PLAN_AND_VET.md` assessment threshold, with the review lens set to **ambiguity in the stated
requirements**. Findings below are limited to places where the PRD is internally contradictory, is
contradicted by the current codebase, or leaves a requirement underspecified enough that two competent
implementing agents would produce materially different systems.

Reviewed document: `docs/20260829_weekly_article_processing_cron_prd_v02.md`.

The PRD is well-structured and factually grounded in the repository: the cohort relationship in §7.3 is
correct (Google RSS does create `NewsApiRequest` rows and stamps `Articles.newsApiRequestId` —
`worker-node/src/modules/jobs/requestGoogleRssJob.ts:341`, `:391`), the db-manager flags in §10.3 and
§10.4 exist (`db-manager/README.md:44`, `:48`), `article_position_count` is a real V02 selection mode,
and the proposed `--clear_duplicate_analyses` flag matches db-manager's existing snake_case flag naming.
The additive database design in §7 is sound and low-risk as written.

The concerns below are therefore about specification gaps, not about approach.

---

## C1 — Blocking: the RSS success gate contradicts the dev-canary configuration

§10.5 requires `endingReason = queries_exhausted` for the RSS stage to pass.

§8.1 requires that dev canary "uses a small operator-configured target."

These cannot both hold. In `worker-node/src/modules/jobs/requestGoogleRssJob.ts:629-635`, when
`targetArticlesAddedCount` is set and met, the job sets `endingReason = 'target_articles_collected'` and
breaks. A dev canary configured per §8.1 will therefore *always* terminate with an ending reason that
§10.5 treats as stage failure. The entire §15.3 canary sequence is unreachable as written.

Additionally, `GoogleRssEndingReason` (`requestGoogleRssJob.ts:54-61`) includes `rate_limited`, which the
PRD never classifies. Rate limiting during a Friday production run is plausible and the PRD gives no
ruling on whether it is a failure, a retry condition, or an accepted partial completion.

**Needed:** an explicit per-mode table of accepted terminal ending reasons, covering all six enum values.

## C2 — Blocking: the five-consecutive-failure circuit breaker has no specified home

§10.7 requires stopping the whole flow after five consecutive article failures, and §2 item 6 and
acceptance criterion 8 repeat it. The PRD never says *where the counting happens*, and the two readings
produce materially different systems:

- **Inside worker-node.** The job loop tracks consecutive failures and aborts early. Requires modifying
  `processStateAssignmentsWithTimeout`, and is a true circuit breaker.
- **In the coordinator.** The coordinator inspects results after the job finishes. This cannot stop
  anything — by then every article has already been attempted. It is a post-hoc failure classification
  wearing the word "breaker."

Today neither exists. `processStateAssignmentsWithTimeout`
(`worker-node/src/modules/jobs/stateAssignerJob.ts:269-323`) returns `Promise<void>`, logs each failure,
and unconditionally continues. There is no counter and no outcome collection.

Compounding this, §5 defines a consecutive failure as "a failed state-assignment attempt," but in the
code an iteration timeout (`stateAssignerJob.ts:305-311`) and a caught error (`:313-321`) both take the
same `continue` path — while §10.7 requires recording "skipped" and "failed" as separate categories. The
PRD does not say whether a timeout advances the breaker counter. Given the breaker is a hard stop on a
weekly production flow, that distinction decides whether a slow AI provider silently kills the run.

**Needed:** state which component owns the counter, and state explicitly whether a timeout counts as a
failure for breaker purposes.

## C3 — Blocking: two of the three worker-node stages return no structured result

§10.6 requires recording "selected, scored, skipped, and failed IDs and counts." §10.7 requires
"attempted, successful, skipped, and failed IDs and counts." §12 requires those counts in JSONL, and
acceptance criteria 7 and 8 depend on them.

Only the RSS job can supply this. It has a declared result contract (`GoogleRssJobResult`,
`requestGoogleRssJob.ts:76-81`) and reports through `updateResult` (`:661-668`). Neither
`semanticScorerJob.ts` nor `stateAssignerJob.ts` has a result interface or any `updateResult` call — a
grep for both returns nothing. The coordinator has no way to observe what those stages did.

§6.2 scopes worker-node to "optional weekly run input for RSS and exact-ID targeting needed by downstream
stages." Building result-reporting contracts into two jobs is real, non-trivial work that this scoping
sentence does not cover, and an implementing agent reading §6.2 would not know to plan for it.

**Needed:** add job result reporting to worker-node's §6.2 ownership line, and specify the result shape
each stage must return.

## C4 — Resolved by operator decision: semantic scorer is not cohort-scoped

**Original concern.** §10.6 requires "Target exact cohort article IDs, not only an arbitrary newest
count," then softens it to "Extend the route to accept validated explicit `articleIds` if required." The
scorer route accepts only a contiguous ID range — `articleIdMinExclusive` / `articleIdMaxInclusive`
(`worker-node/src/routes/semanticScorer.ts:61-64`) — while the state assigner already supports
`articleIds` (`worker-node/src/modules/articleTargeting.ts:88`). Because the RSS stage has a 24-hour
window and §3 item 3 preserves concurrent ingestion, cohort IDs are not guaranteed contiguous, so range
targeting could score non-cohort articles.

**Operator decision (2026-08-31).** Semantic scoring does not need to stay within the weekly cohort.
Scoring is cheap and is permitted to run across all eligible articles. The weekly flow must not concern
itself with restricting the scorer to the cohort.

**Consequence: this concern is withdrawn, and no `articleIds` support needs to be added to the scorer
route.** The asymmetry between the scorer and the state assigner is intentional, not a defect. The state
assigner remains cohort-scoped per §10.7.

**PRD edits this decision requires.** The decision resolves the ambiguity but leaves the PRD stating the
opposite in four places, all of which must change in V03:

1. §10.6 first bullet — remove "Target exact cohort article IDs, not only an arbitrary newest count" and
   replace it with the operator's rule: scoring runs across all eligible articles and is deliberately not
   cohort-restricted.
2. §10.6 second bullet — remove "Extend the route to accept validated explicit `articleIds` if required."
   No route change is needed.
3. §10.6 last bullet — "Stop only for a stage-level failure or an unexplained reconciliation gap" no
   longer applies, because there is no cohort reconciliation at this stage. Reduce to stage-level failure
   only.
4. Acceptance criterion 7 — "Semantic scoring targets the cohort and reports terminal skips" must drop the
   cohort clause and keep only the terminal-skip reporting.

§15.3 step 5 ("Run semantic scoring on the cohort") should likewise be reworded for the dev canary.

**What this does not resolve.** C3 still applies in full. The scorer still has no result contract and no
`updateResult` call, so "Record selected, scored, skipped, and failed IDs and counts" and "Report every
terminal skip in JSONL" remain unimplementable. Widening the scorer's target set makes the reporting
requirement larger, not smaller.

**One item for the operator to confirm.** Scoring is cheap per article, but "all eligible articles"
against a production-scale table is a different workload than a weekly cohort of new articles. The §11
four-hour scorer timeout was set when the stage was cohort-scoped. Worth confirming that four hours still
covers a full-table pass on production, or that the scorer's own eligibility filter (articles lacking a
score) keeps the working set small in steady state.

## C5 — Major: V02 selection is position-based and the PRD sets no rule for cohort overlap

§10.8 requires `selectionMode = article_position_count` with `requestedArticleCount = articlesAddedCount`,
then requires recording "the overlap between the frozen V02 selection and the weekly cohort," and forbids
silently increasing the count to compensate for exclusions.

Position-count selection is not cohort-scoped — it takes the top N of an eligibility-ordered list. Between
V02's own exclusions (individually approved articles, existing valid predictions, state-assignment
requirements) and any concurrent ingestion, the frozen selection can diverge from the weekly cohort by an
arbitrary amount.

The PRD requires *measuring* that divergence but never says what to do with the measurement. There is no
tolerance, no status, and no action. Is 90% overlap fine? Is 30% a failure? Acceptance criterion 9 only
requires that V02 "uses Mode A, the RSS-added count, description fallback, and boundary crossing" — it
never checks the overlap the PRD went out of its way to record. An implementing agent has nothing to code
against, and the recorded number becomes decoration.

**Needed:** either define a minimum overlap with a named failure status, or state explicitly that overlap
is recorded for operator visibility only and never gates the run.

## C6 — Moderate: clearing before backup makes duplicate-analysis state unrecoverable, and the PRD does not say so

§1 orders duplicate-analysis clearing (step 2) before the backup (step 3), §2 item 2 records this as an
operator decision, and §10.3 requires verifying the archive contains no `ArticleDuplicateAnalyses` data
rows. The document is internally consistent here, and the operator has confirmed this ordering is intended.

The unstated consequence: no backup will ever contain pre-run duplicate-analysis data. If the flow fails
at any later stage, that state is gone. This is very likely acceptable — the table is regenerable scratch
data — but §10.2's requirement for "bounded, resumable primary-key batches" implies a recoverability that
does not exist at the flow level, and a reader could reasonably infer the backup protects this table.

**Needed:** one sentence in §10.2 stating that duplicate-analysis rows are intentionally not preserved by
the weekly backup and are expected to be regenerated.

## C7 — Moderate: "expected exports" is undefined

§10.3 requires verifying "that the archive opens and contains expected exports." No manifest, table list,
per-table row-count floor, or size threshold is given. Two implementers will write two different checks,
and the weakest passing implementation ("the ZIP opens") satisfies the literal text while providing no
real protection before the irreversible `--delete_articles` stage in §10.4.

Given this is the last gate before destructive deletion, the check deserves a concrete definition.

**Needed:** name the required table exports, or define the verification as a manifest comparison.

## C8 — Minor: the stage timeout budget nearly exhausts the run cap

The §11 stage timeouts sum to roughly 62 hours (15m + 60m + 120m + 30m + 24h + 4h + 18h + 12h + 10m)
against a 72-hour total run cap. Not a contradiction, but under sequential worst-case behavior there is
only about 10 hours of slack, and the 72-hour cap would fire mid-stage rather than at a stage boundary.
The PRD does not say what status a run receives when the outer cap preempts a stage that has not yet hit
its own timeout, or how that interacts with the §16 systemd 72-hour service timeout.

**Needed:** state whether the outer cap produces `timed_out` and whether it is expected to preempt stages.

## C9 — Minor: destructive-stage recovery is never exercised before production

§8.1 disables cleanup, backup, and old-article deletion by default in dev canary. §15.2 requires testing
"restart and recovery without destructive repetition," and §11 rule 2 makes non-repetition of completed
destructive stages a core safety property.

With destructive stages off in dev canary and only one supervised manual production run before timer
activation (§17 item 14), the destructive-recovery path is first exercised on production data. Rule 2 is
one of the most consequential requirements in the document and the least tested.

**Needed:** an explicit dev mode that enables destructive stages against the confirmed development
database, so §11 rule 2 is validated on Ubuntu dev before production.

---

## Items reviewed and found sound

- §7 additive database design. Nullable FK, default null, restrict-on-delete, indexed for cohort queries;
  no existing column altered. Consistent with §7.4 and with the repository's lack of a migration
  framework.
- §7.3 cohort query. Matches actual RSS behavior — a new `NewsApiRequest` per query, articles stamped with
  `newsApiRequestId`, URL-level dedup ensuring `articlesAddedCount` equals distinct new articles.
- Naming. `weeklyArticleFlowRunId`, `WeeklyArticleFlowRuns`, and `--clear_duplicate_analyses` follow
  existing repository conventions, and §7.2's prohibition on reusing `orchestratorRunId` is appropriate.
- §6.1 repository location and the shell-entrypoint / TypeScript-coordinator split.
- §14 security posture, including running as `limited_user` and the Open Question 3 resolution that keeps
  Nick's Obsidian credentials out of the service account.

## Recommendation

C1, C2, and C3 are blocking: C1 makes the dev canary unpassable, and C2 and C3 describe behavior that no
current code can produce while §6.2 does not scope the work to build it. C5 leaves a correctness decision
to the implementing agent.

C4 is resolved by operator decision and requires only that V03 correct the four PRD statements that now
contradict it.

Recommend a V03 of the PRD resolving C1, C2, C3, and C5, and applying the C4 edits, before planning
begins. C6 through C9 can be folded into the same revision as clarifying sentences.
