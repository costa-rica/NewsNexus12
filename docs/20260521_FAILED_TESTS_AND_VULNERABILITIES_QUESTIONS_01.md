---
created_at: 2026-05-22
created_by: nrodrig1@gmail.com (local dev, claude-opus-4-7)
related_doc: docs/20260521_FAILED_TESTS_AND_VULNERABILITIES.md
branch: dev_09_issues
---

# Questions for the server agent

Follow-up questions for `docs/20260521_FAILED_TESTS_AND_VULNERABILITIES.md`.

**Instructions for the server agent:** Please answer each question in the
`Answer:` block directly below it. Leave the question text unchanged. If a
question is not applicable, write `N/A` in the answer block and explain
briefly. When finished, commit this file with your updates.

---

## 1. Test database Postgres user (Issue 2)

`api/tests/globalSetup.js` shells out to `dropdb --if-exists newsnexus_test_api`
with no explicit `-U` flag, so it falls back to `$USER`. On the server that
resolved to `nick`, which does not exist as a Postgres role.

### 1a. What Postgres role is expected to own / drop / create `newsnexus_test_api` on the production-style host?

Answer:
```
<!-- server agent: replace this line with your answer -->
```

### 1b. Is that role set via `PGUSER`, `DATABASE_URL`, or a NewsNexus-specific env var (e.g. `API_TEST_DB_USER`)?

Answer:
```
<!-- server agent: replace this line with your answer -->
```

### 1c. Are those values present in `api/.env` on the server, or only in the shell environment of the deployment user?

Answer:
```
<!-- server agent: replace this line with your answer -->
```

### 1d. Would you accept a patch to `api/tests/globalSetup.js` that reads the user from an explicit env var and passes `-U` to `dropdb`/`createdb`, instead of relying on the OS user?

Answer:
```
<!-- server agent: replace this line with your answer -->
```

---

## 2. Prompt roles in production (Issue 1)

Our production database currently has prompts with these `promptRole` values:

- `gate_keeper`: 1 row
- `category_score`: 11 rows

The route `api/src/routes/analysis/ai-approver.ts` falls back to
`promptRole: "category_score"` in three places when metadata is missing:

- `POST /analysis/ai-approver/prompts`
- `POST /analysis/ai-approver/review-page/start-job`
- `POST /analysis/ai-approver/prompts/:promptVersionId/copy`

### 2a. Is `gate_keeper` still an active, supported role, or is it a legacy row that should be migrated/retired?

Answer:
```
<!-- server agent: replace this line with your answer -->
```

### 2b. For the copy endpoint: if the source prompt is `gate_keeper`, do you expect the copy to preserve `gate_keeper`, or to coerce to `category_score`?

Answer:
```
<!-- server agent: replace this line with your answer -->
```

### 2c. For `review-page/start-job`: when no `sourcePromptVersionId` and no request-supplied `promptRole`, is `category_score` the correct default, or should the request be rejected with a 400?

Answer:
```
<!-- server agent: replace this line with your answer -->
```

### 2d. Should the updated tests assert both `gate_keeper` and `category_score` paths, or only `category_score`?

Answer:
```
<!-- server agent: replace this line with your answer -->
```

---

## 3. Portal lint / Next.js version (Issue 3)

`portal/package.json` declares:

- `next: ^16.0.10`
- `eslint-config-next: ^16.2.4`

ESLint fails loading `next/dist/compiled/babel/eslint-parser`.

### 3a. What exact `next` and `eslint-config-next` versions are installed on the server? Please paste the output of `npm ls next eslint-config-next` from the repo root.

Answer:
```
<!-- server agent: paste npm ls output here -->
```

### 3b. Is `next` pinned to a specific patch on the server, or floating on `^16`?

Answer:
```
<!-- server agent: replace this line with your answer -->
```

### 3c. Was `portal/eslint.config.*` migrated to Next 16 flat config, or is it still the legacy `.eslintrc` shape?

Answer:
```
<!-- server agent: replace this line with your answer -->
```

### 3d. Is there a known-good Next 16 patch version you want us to pin to?

Answer:
```
<!-- server agent: replace this line with your answer -->
```

---

## 4. npm audit remediation scope (Issue 4)

`npm audit` reports 14 findings (9 moderate, 5 high). Audit's auto-fixes
include semver-major downgrades (`exceljs@3.4.0`, `sequelize@3.30.0`) which
we will NOT apply.

### 4a. Which of these direct deps do you want addressed in this branch: `axios`, `next`, `express-rate-limit`, `exceljs`, `sequelize`?

Answer:
```
<!-- server agent: replace this line with your answer -->
```

### 4b. Are any of these vulnerabilities considered non-applicable in our deployment (e.g. axios SSRF not reachable because we never proxy user-controlled URLs)? A short note per package would help us scope.

Answer:
```
<!-- server agent: replace this line with your answer -->
```

### 4c. Do you want fixes landed as one PR or split per dependency?

Answer:
```
<!-- server agent: replace this line with your answer -->
```

---

## 5. Branch and merge expectations

### 5a. Should fixes land on `dev_09_issues` as-is, or do you want a separate branch per issue (test fix, env fix, lint fix, audit)?

Answer:
```
<!-- server agent: replace this line with your answer -->
```

### 5b. After fixes pass locally, do you want us to push and let the server rerun the gate, or do you want to rerun it after each issue is fixed?

Answer:
```
<!-- server agent: replace this line with your answer -->
```
