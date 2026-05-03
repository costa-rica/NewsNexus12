# 2026-05-02 Codex Handoff — Gatekeeper Prompt Records and Backup Restore

## Purpose

This handoff is for the Codex instance that runs after Nick lands the worker-python AI approver gatekeeper architecture. That future task is not to redesign the architecture again. It is to seed the new gatekeeper prompt records safely, preserve legacy AI approver evidence, and verify that db-manager backup/rebuild/import still works with the final schema.

Desired post-architecture state:

- AI approver has one auditable gatekeeper stage before expensive category scoring.
- Gatekeeper rows can say not run, rejected, passed with tier-2/category scores, manual review, failed/invalid, or legacy category scores exist.
- Portal and API queries do not confuse a gatekeeper confidence/decision with a category approval score.
- Rejected gatekeeper articles still get a persisted analysis row/status so the review modal can explain why category prompts were skipped.
- Legacy `AiApproverArticleScores` rows are retained and interpreted as pre-gatekeeper/category-score evidence, not backfilled into fake gatekeeper decisions.

## Source Context To Re-Read

Before making seed or prompt-record changes, re-read the final versions of:

- `db-models/src/models/AiApproverPromptVersion.ts`
- `db-models/src/models/AiApproverArticleScore.ts`
- `worker-python/src/standalone/setup_ai_approver_prompt.py`
- worker-python AI approver route/orchestrator/repository/client code
- API routes that expose AI approver prompts and article score details
- portal review modal and prompt-management expectations
- `db-manager/src/modules/backup.ts`
- `db-manager/src/modules/zipImport.ts`
- `db-manager/src/modules/dryRunValidator.ts`
- `db-manager/src/index.ts`
- `db-manager/src/modules/cli.ts`

The model shape may differ from the pre-architecture state. Trust the final code, not this document, when choosing exact columns and insert SQL.

## Backup And Restore Expectations

Based on current db-manager code:

- `--create_backup` writes one CSV per exported `@newsnexus/db-models` model that has data. Files are placed in a temporary backup directory and zipped with compression level 9.
- ZIP import calls `rebuildSchema()`, which drops and recreates the `public` schema, runs `sequelize.sync()` against the current `db-models` schema, optionally reapplies `PG_APP_ROLE` grants, then imports CSV files.
- Import loads CSVs in `MODEL_LOAD_ORDER`, not arbitrary ZIP order.
- Import uses `bulkCreate(..., { ignoreDuplicates: true })`, so duplicate rows are ignored where the model/database has duplicate constraints.
- Import sanitizes invalid dates to `null`, SQLite-style booleans (`1`/`0`) to `true`/`false`, empty integer values to `null`, and empty float values to `null`.
- If a batch hits a foreign-key violation, import falls back to row-by-row insertion and skips only orphaned FK rows.
- After import, `resetAllSequences(sequelize)` runs to repair serial/identity sequence values.
- `--drop_db` also calls `rebuildSchema()` and leaves an empty current-schema database. It is destructive.
- `--dry_run --zip_file <zip>` creates a scratch database, imports the ZIP into that scratch DB using the same import path, prints a validation report, and drops the scratch DB.

Compatibility caveats:

- Old backup CSVs will not contain columns added after the backup was created. New schema additions that must restore old backups should be nullable, have defaults, or be backfilled after import.
- Adding a new `NOT NULL` column without a default can break restore from an old ZIP because the CSV cannot provide that value.
- Renamed or removed models/tables can make old CSV files get skipped because no matching exported model exists.
- Renamed or removed columns can produce import errors unless Sequelize/database behavior tolerates the missing or extra CSV fields.
- Foreign keys introduced after old data was created can cause orphaned rows to be skipped. That may be acceptable for bad legacy rows, but it must be reviewed if the skipped rows are business-critical.
- Prompt/score schema changes should preserve enough compatibility for legacy `AiApproverPromptVersions.csv` and `AiApproverArticleScores.csv` to import into the new schema.

## Safe Operator Sequence

Use this as the recommended sequence for Nick/dev server. Do not include or print secrets. Do not run destructive commands without Nick's explicit approval.

1. Build the shared model package and db-manager from the branch under test.

```bash
cd /home/limited_user/applications/NewsNexus12/db-models
npm install
npm run build

cd /home/limited_user/applications/NewsNexus12/db-manager
npm install
npm run build
npm test
```

2. Create a backup ZIP of the current old data before schema changes or destructive operations.

```bash
cd /home/limited_user/applications/NewsNexus12/db-manager
npm start -- --create_backup
```

3. Dry-run the backup ZIP against a scratch database.

```bash
cd /home/limited_user/applications/NewsNexus12/db-manager
npm start -- --dry_run --zip_file /absolute/path/to/db_backup_YYYYMMDDHHMMSS.zip
```

4. Implement or pull the final gatekeeper schema/application architecture, then rebuild and run tests.

```bash
cd /home/limited_user/applications/NewsNexus12/db-models
npm run build

cd /home/limited_user/applications/NewsNexus12/db-manager
npm run build
npm test

cd /home/limited_user/applications/NewsNexus12/api
npm run build
npm test

cd /home/limited_user/applications/NewsNexus12/worker-python
# run the available worker-python validation for this branch, if present
```

5. Import the old backup ZIP into a scratch or test database using the new schema. Prefer `--dry_run` first. If using a dedicated test DB, point db-manager env at that test DB and import there.

```bash
cd /home/limited_user/applications/NewsNexus12/db-manager
npm start -- --dry_run --zip_file /absolute/path/to/db_backup_YYYYMMDDHHMMSS.zip
```

6. Verify counts and AI status interpretation before touching the target database.

Examples of what to verify:

- total row counts for important tables before/after dry-run are plausible
- `AiApproverPromptVersions` legacy rows import
- `AiApproverArticleScores` legacy rows import
- legacy prompt rows are interpreted as `category_score` or `legacy_category_score`
- no gatekeeper prompt is active unless Nick asked for activation
- portal article/review modal distinguishes gatekeeper state from category scores
- rejected gatekeeper sample row/status is explainable in the portal

7. Only after backup creation, dry-run validation, final tests, and Nick approval, run destructive target operations.

Destructive examples, do not run without explicit approval:

```bash
# DESTRUCTIVE: wipes the target database and rebuilds empty current schema.
cd /home/limited_user/applications/NewsNexus12/db-manager
npm start -- --drop_db
```

```bash
# DESTRUCTIVE: import rebuilds the target schema before restoring the ZIP.
cd /home/limited_user/applications/NewsNexus12/db-manager
npm start -- --zip_file /absolute/path/to/db_backup_YYYYMMDDHHMMSS.zip
```

## Exact Future Codex Assignment

After the gatekeeper architecture lands:

1. Inspect the final `AiApproverPromptVersion` and `AiApproverArticleScore` model schemas.
2. Inspect the final prompt setup script and decide whether to extend it, replace it, or add a new idempotent seed script.
3. Inspect API and portal expectations for prompt role, prompt key, pipeline version, decision/status, confidence, metadata, and legacy category-score interpretation.
4. Create a markdown prompt file for the gatekeeper and/or a seed script that inserts the gatekeeper prompt record(s).
5. Make the insertion idempotent and safe: rerunning the seed should not create duplicate active gatekeepers.
6. Keep new gatekeeper prompt records inactive by default unless Nick explicitly requests activation.
7. Verify backup dry-run compatibility with a real backup ZIP before any destructive restore/drop/import on a target DB.

## Proposed Gatekeeper Prompt Record Plan

Use the final schema names if they exist. If a field does not exist, do not invent ad hoc SQL against a missing column.

- `promptRole`: use `gatekeeper` if this column exists.
- `promptKey`: use a stable key such as `consumer_product_gatekeeper_v1` if this column exists.
- `pipelineVersion`: use `ai_approver_gatekeeper_v1` if this column exists.
- `name`: use a clear display value such as `Consumer Product Gatekeeper v1`.
- `description`: state that this is a first-pass, high-recall CPSC/product-safety router that decides whether category prompts should run.
- `isActive`: initially `false` unless Nick explicitly requests activation.
- `endedAt`: `NULL` for an inactive draft prompt unless the final prompt lifecycle uses a different convention.
- `responseSchemaVersion`: if present, set to the final gatekeeper response schema version, for example `gatekeeper_json_v1`.
- `modelName`: if present, set only if the architecture uses prompt-intended model names; otherwise leave nullable/defaulted.

Preferred gatekeeper output should be richer JSON if the implemented parser supports it:

```json
{
  "decision": "pass",
  "confidence": 0.86,
  "reasonCode": "cpsc_product_incident",
  "reason": "Article describes a consumer product involved in a fire injury incident.",
  "signals": {
    "consumerProductMentioned": true,
    "hazardOrInjuryMentioned": true,
    "deathOrInjuryMentioned": true,
    "likelyAdvertisement": false,
    "likelyCelebrityNews": false,
    "likelyGeneralCrimeOrPolitics": false
  }
}
```

Only include score/reason fallback if the implemented parser still requires the old shape:

```json
{
  "score": 0.85,
  "reason": "route=pass_downstream; Article plausibly describes a consumer product safety incident."
}
```

Fallback route mapping, if needed:

- `0.80` to `1.00`: `pass_downstream`
- `0.45` to `0.79`: `manual_review`
- `0.00` to `0.44`: `reject_gatekeeper`

Start conservatively. During the initial rollout, only hard-skip downstream category prompts for clear rejects with high confidence or a very low fallback score threshold.

## Prompt Content Requirements

The markdown prompt should make the gatekeeper a router, not a final approval judge.

It should instruct the model to:

- use high recall because false negatives are worse than false positives
- pass or route to manual review when a consumer product safety event is plausible
- reject only clearly out-of-scope articles
- choose manual review when content is missing, incomplete, or ambiguous
- avoid final CPSC jurisdiction decisions
- avoid category scoring, duplicate detection, state assignment, report inclusion, and final human approval decisions
- preserve explainability with a short reason and structured reason/status fields if supported

Strong pass/manual-review signals include consumer products, household products, appliances, furniture, tools, toys, nursery products, sports/recreation products, batteries, chargers, generators, heaters, stoves, grills, candles, pools, ladders, mowers, playground equipment, scooters, e-bikes, ATVs/UTVs, household chemicals, pesticides, fuels, containers, magnets, button batteries, injuries, deaths, fires, explosions, burns, poisoning, shock, electrocution, falls, crushing, choking, drowning, ingestion, laceration, amputation, entrapment, malfunction, defect, recall, or warning.

Strong rejection signals include ads, coupons, shopping guides, product reviews with no incident, product launches with no incident, celebrity/entertainment/sports score/finance/politics/opinion stories with no product hazard, general crime with no product injury source, ordinary traffic crashes with no product-defect or consumer-product angle, and workplace/industrial/medical/environmental/weather stories with no ordinary consumer product angle.

## Acceptance Criteria For Future Codex Work

- Prompt record(s) can be inserted idempotently or safely without duplicate active gatekeepers.
- New gatekeeper prompt records are inactive by default unless Nick explicitly approves activation.
- Restored legacy category prompt rows are marked, backfilled, or interpreted as `category_score` / `legacy_category_score` where applicable.
- Portal can distinguish gatekeeper rows from category scores.
- API/reporting/top-score queries do not rank gatekeeper rows as category approval scores.
- A rejected gatekeeper article produces a persisted analysis row/status that the review modal can explain.
- Gatekeeper failed/invalid responses are persisted and visible as failed/invalid, not silently treated as not run.
- Backup ZIP dry-run passes before destructive operations.
- Import warnings for skipped files, orphaned FK rows, or sanitized values are reviewed and explained before target restore.
- No destructive `--drop_db` or target `--zip_file` import is run without Nick's explicit approval.
