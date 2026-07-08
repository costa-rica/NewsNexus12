---
created_at: 2026-07-08
updated_at: 2026-07-08
created_by: claude (fable-5)
modified_by: claude (fable-5)
---

# Db manager delete retired-source articles plan v03

## Purpose

1. Add a db-manager CLI operation that deletes articles found by the retired aggregator sources **NewsAPI**, **GNews**, and **NewsData.IO**. These sources are permanently decommissioned — the platform no longer collects articles from them.
2. "Found by" means the chain `Articles.entityWhoFoundArticleId` → `EntityWhoFoundArticles.newsArticleAggregatorSourceId` → `NewsArticleAggregatorSources.nameOfOrg`.
3. Articles found by users (`EntityWhoFoundArticles.userId` set, aggregator id null), by other sources (e.g. Google News RSS), or with no `entityWhoFoundArticleId` are never touched.
4. Supersedes `docs/20260708_db_manager_retired_sources_plan_v02.md`. Incorporates both revision requests from `docs/20260708_db_manager_retired_sources_plan_v02_assessment_codex.md`:
   - candidate-selection correctness verified through SQL-shape assertions, not only mocked return rows (Concern 1),
   - stale plan cross-reference replaced with the live implementation files (Concern 2).
5. All v02 naming is unchanged, per the assessment's requested revision 3: flag `--delete_articles_retired_sources`, module `deleteArticlesRetiredSources.ts`, tests `deleteArticlesRetiredSources.test.ts`, identifiers using `RetiredSources` / `RETIRED_SOURCE_NAMES`.

## Reference implementation (revised — addresses Concern 2)

1. This feature mirrors the implemented no-state deletion feature. The live sources of truth are the implementation files, not any planning doc:
   - `db-manager/src/modules/deleteArticlesNoState.ts` — module shape: preview function + delete function, raw candidate SQL with `EXISTS` protection columns, precedence-based exclusion counting, batched `Article.destroy()`,
   - `db-manager/src/modules/cli.ts` — exact flag-token parsing, optional positive-integer value handling, `KNOWN_FLAGS` typo suggestions,
   - `db-manager/src/index.ts` — dry-run gating and execution order,
   - `db-manager/tests/modules/deleteArticlesNoState.test.ts` — mocked-model test patterns, including existing SQL-shape assertions against the query string passed to `sequelize.query`.
2. The originating plan for that feature is archived at `docs/archive/202607/20260708_db_manager_scripts_plan_v03.md` — historical context only, per the repo's archive convention; implementers should not need to read it.

## Flag name

1. New flag: `--delete_articles_retired_sources`, with an optional positive-integer limit:
   - `--delete_articles_retired_sources` — delete all eligible articles,
   - `--delete_articles_retired_sources <n>` / `--delete_articles_retired_sources=<n>` — cap deletions for a cautious first pass,
   - `--delete_articles_retired_sources --dry_run` — read-only preview.
2. Naming rationale (operator-decided): "retired" conveys permanent decommissioning; "old" was rejected because "old" already means article age in this CLI (`--delete_articles 90`), and "discontinued" was rejected as awkward and long. The `--delete_articles_` prefix is kept so the flag groups with `--delete_articles`, `--delete_articles_trim`, and `--delete_articles_no_state`.
3. Register the flag in `KNOWN_FLAGS` so Levenshtein typo suggestions cover it. The parser already uses exact flag-token matching, so the shared `--delete_articles` prefix causes no collision; collision tests are still required (see Testing).

## Source identification

1. A module-level constant `RETIRED_SOURCE_NAMES` lists the retired source names exactly as the api package writes them: `["NewsAPI", "GNews", "NewsData.IO"]` (verified in `api/src/modules/newsOrgs/requestsNewsApi.ts`, `requestsGNews.ts`, `requestsNewsDataIo.ts` — all query `nameOfOrg` with these exact strings).
2. Matching is exact (`IN` list, case-sensitive), consistent with how the api resolves these rows. No pattern matching — Google News RSS shares the same tables and must never match.
3. Guard against spelling drift: before selecting candidates, the module queries `NewsArticleAggregatorSources` for the three names and logs a warning for any name with no matching row (that name then contributes zero candidates). This makes a silent no-op visible in both dry-run and execute logs.

## Candidate definition

An article is a candidate when all of the following hold:

1. `Articles.entityWhoFoundArticleId` is non-null and joins to an `EntityWhoFoundArticles` row,
2. that row's `newsArticleAggregatorSourceId` is non-null and joins to a `NewsArticleAggregatorSources` row,
3. that source's `nameOfOrg` is one of the three retired names.

Inner joins enforce 1–2 structurally; user-found articles are excluded because their `newsArticleAggregatorSourceId` is null. The candidate path must **not** route through `Articles.newsApiRequestId` / `NewsApiRequests` — `entityWhoFoundArticleId` is the operator-specified linkage, and the SQL-shape tests assert the request-table path is absent.

## Protections (always on)

1. Identical to the no-state deletion's protected set, applied with the same fixed precedence for deterministic exclusion counting: `relevant` (`ArticleIsRelevant`) → `approved` (`ArticleApproved`) → `aiApproved` (`ArticlesApproved02`) → `reportLinked` (`ArticleReportContract`). Any row in any of these tables protects the article.
2. Rationale: db-manager's core invariant is that approved/relevant/report-linked articles are never deleted (AGENTS.md "Key Behaviors"). The operator's request says "any articles", but many articles from these three sources were approved and appear in client reports; deleting them would break report history. The dry-run preview reports how many candidates each protection excluded, so the operator can see exactly what is being kept and can request a follow-up if truly-everything deletion is wanted.
3. Count invariants (tested): `totalExcluded` = sum of per-protection counts; `totalCandidates` = `totalExcluded` + pre-limit eligible count.

## Module: `src/modules/deleteArticlesRetiredSources.ts`

1. Mirrors `deleteArticlesNoState.ts` exactly in shape — two exports:
   - `getRetiredSourcesDeletionPreview(limit?)` — pure read. One raw SQL query (a module-level constant, like `NO_STATE_CANDIDATES_SQL`, so tests can assert its shape) that inner-joins `Articles` → `EntityWhoFoundArticles` → `NewsArticleAggregatorSources`, filters `nameOfOrg IN (...)`, and returns per-row: `articleId`, `title`, `publishedDate`, `sourceName` (`nameOfOrg`), plus the four `EXISTS(...)` protection columns. Returns a summary object:

     ```
     {
       totalCandidates: number;                 // before protections
       excludedByProtection: { relevant; approved; aiApproved; reportLinked };
       totalExcluded: number;
       eligibleBeforeLimitCount: number;
       eligible: Array<{ articleId; title; publishedDate; sourceName }>;
       selectedForDeletionCount: number;
       appliedLimit: number | null;
       sourceCounts: Record<string, number>;    // eligible count per source name
       missingSources: string[];                // configured names with no NewsArticleAggregatorSources row
     }
     ```

   - `deleteRetiredSourcesArticles({ dryRun, limit })` — calls the preview, logs the summary, stops when `dryRun` is true or nothing is eligible; otherwise deletes `eligible` ids with `Article.destroy({ where: { id: { [Op.in]: batchIds } } })` in batches of 5000 with progress logging — the same deletion mechanics production already runs.
2. `sourceCounts` replaces the no-state module's `reasonCodeCounts` as the per-category breakdown: the dry run shows how many eligible articles each of the three sources contributes.
3. Logged preview output (both modes): total candidates, per-protection exclusions and total excluded, eligible/selected counts and applied limit, per-source breakdown, any missing-source warnings, and a sample of up to 20 eligible rows (article id, source name, publishedDate, title).
4. Volume note: these were primary ingestion sources, so the candidate set may be large (potentially hundreds of thousands). The candidate query returns one narrow row per article, which is fine at this scale, and deletion is already batched. No pagination is needed; if the dry run reveals an extreme count, the limit argument supports incremental runs.
5. Out of scope (same as the no-state feature): multi-table orphan cleanup beyond what `Article.destroy()` already does; changing `EntityWhoFoundArticles` or `NewsArticleAggregatorSources` rows themselves (the source rows stay, only articles are deleted).

## CLI and entrypoint changes

1. `src/modules/cli.ts`: new branch for `--delete_articles_retired_sources` with optional positive-integer value (inline `=n` or next-arg), exactly mirroring the `--delete_articles_no_state` branch. New `CliOptions` fields: `deleteArticlesRetiredSources?: boolean`, `deleteArticlesRetiredSourcesLimit?: number` in `src/types/cli.ts`.
2. `src/index.ts` dry-run gating: `--dry_run` currently composes with `--zip_file` XOR `--delete_articles_no_state`. Extend to allow exactly one dry-runnable target among `--zip_file`, `--delete_articles_no_state`, `--delete_articles_retired_sources`; combining two or more with `--dry_run` is an error, and `--dry_run` alone remains an error. Error messages updated to name all three.
3. Execution order in `src/index.ts` becomes: backup, import, trim, delete, no-state delete, **retired-sources delete**, status.

## Testing plan (revised — addresses Concern 1)

1. **SQL-shape assertions (required).** The destructive safety of this feature lives in the candidate query, and mocked `sequelize.query` return rows cannot prove the query joins and filters correctly. Following the existing precedent in `tests/modules/deleteArticlesNoState.test.ts` (which asserts fragments of the SQL string passed to the mocked `sequelize.query`), `tests/modules/deleteArticlesRetiredSources.test.ts` must capture the candidate SQL and assert:
   - it contains `INNER JOIN "EntityWhoFoundArticles"` joined on `Articles."entityWhoFoundArticleId"`,
   - it contains `INNER JOIN "NewsArticleAggregatorSources"` joined on `"newsArticleAggregatorSourceId"`,
   - both candidate-chain joins are `INNER JOIN` (assert the exact join fragments; the candidate query contains no `LEFT JOIN`),
   - the source-name filter contains exactly `'NewsAPI'`, `'GNews'`, and `'NewsData.IO'` and no other source names,
   - the SQL contains neither `NewsApiRequests` nor `newsApiRequestId` (no candidate path through the request tables),
   - all four protection `EXISTS` clauses are present, one per protection table (`ArticleIsRelevants`, `ArticleApproveds`, `ArticlesApproved02`, `ArticleReportContracts`).
   Alternative rejected: a database-backed query fixture (assessment option 2). The db-manager test convention is explicit — all tests use mocked models, no real database required — and introducing a Postgres dependency for one suite would break that convention and CI expectations. SQL-shape assertions on a module-level SQL constant achieve the assessment's goal within the convention.
2. Parser tests (extend `tests/modules/cli.test.ts`):
   - flag alone, `<n>` and `=<n>` forms; zero / negative / non-numeric rejected,
   - collision tests: none of the forms set `deleteArticlesDays`, `deleteArticlesTrimCount`, or `deleteArticlesNoState`,
   - typo suggestion resolves toward the new flag,
   - `--dry_run` composes with the new flag; `--dry_run` alone still rejected.
3. Module behavior tests (mocked return rows — valid for counting, limits, batching, and logging, per the assessment):
   - protection columns exclude candidates; multi-protection article counted once under highest precedence; count invariants hold,
   - `sourceCounts` per-source breakdown correct; `missingSources` populated when a configured name has no source row, with a warning logged,
   - limit caps `eligible` and is reported in `appliedLimit`,
   - `dryRun: true` performs no deletions; execute deletes exactly the previewed `eligible` ids in 5000-id batches.
4. Entrypoint routing tests (extend `tests/modules/indexRouting.test.ts`): dry-run gating accepts the new flag, rejects multi-target dry runs, and the execute path runs in the documented order.
5. Validation from `db-manager/`: `npm test`, `npm run build`.

## Documentation updates

1. `db-manager/AGENTS.md` and `db-manager/README.md`: add the flag to CLI usage examples, execution order, key behaviors, and the dry-run description.
2. Root `AGENTS.md` needs no change.

## Operator workflow

1. Dry run: `npm start -- --delete_articles_retired_sources --dry_run`
2. Inspect total/per-source counts, per-protection exclusions, and samples; confirm no missing-source warnings.
3. Limited execute: `npm start -- --delete_articles_retired_sources 1000`
4. Re-run the dry run and confirm counts dropped as expected.
5. Full execute: `npm start -- --delete_articles_retired_sources`
6. Recommended: `npm start -- --create_backup` before the full execute; production runs follow the existing AGENTS.md `nohup sudo -u limited_user ...` pattern unchanged.

## Open questions

1. Does the operator want approved/relevant/report-linked articles from these sources preserved (this plan's default) or truly all articles deleted? The dry run's exclusion counts will show the size of the difference.
2. Should the three source names come from a CLI value or env var instead of a code constant? Rejected here: a hardcoded constant is simpler, testable, and this is a one-time decommissioning cleanup; a follow-up can generalize if more sources are retired.

## Implementation summary

1. Add `--delete_articles_retired_sources [n]` to `src/modules/cli.ts` and `src/types/cli.ts`; register in `KNOWN_FLAGS`.
2. Extend `src/index.ts` dry-run gating and execution order.
3. Add `src/modules/deleteArticlesRetiredSources.ts` with `getRetiredSourcesDeletionPreview(limit?)` and `deleteRetiredSourcesArticles({ dryRun, limit })`: module-level candidate SQL constant with inner joins against the three exact retired source names (`RETIRED_SOURCE_NAMES`), missing-source warnings, always-on precedence-counted protections, batched `Article.destroy()`.
4. Extend cli, module, and routing test suites per the testing plan — including the required SQL-shape assertions; run `npm test` and `npm run build` in `db-manager/`; update db-manager AGENTS.md and README.
