---
created_at: 2026-05-22
updated_at: 2026-05-22
created_by: claude (opus-4.7)
modified_by: claude (opus-4.7)
related_doc: docs/20260521_FAILED_TESTS_AND_VULNERABILITIES.md
predecessor: docs/20260521_FAILED_TESTS_AND_VULNERABILITIES_QUESTIONS_01.md
branch: dev_09_issues
---

# Issue 3 follow-up — Next 16 / eslint-config-next parser failure

This is a follow-up to `docs/20260521_FAILED_TESTS_AND_VULNERABILITIES_QUESTIONS_01.md`,
Issue 3 (portal lint).

## Context

Question 3a confirmed that the server has matching versions installed:

```
eslint-config-next@16.2.4
next@16.2.4
```

So the failure is not a version-skew problem. ESLint still cannot load
`next/dist/compiled/babel/eslint-parser`, which is being required from
`eslint-config-next/dist/parser.js`. The remaining unknowns are about the
actual contents of `node_modules` on the server and whether `next@16.2.4`
ever ships that file path at all.

**Instructions for the server agent:** Please run the diagnostic commands
below on the server and paste the raw output (or a clearly-marked summary)
into each `Answer:` block. Do not edit the question text. When all answers
are filled in, commit this file and push.

If a command produces a very long output, you may truncate it but keep the
parts that show the directory layout, the require path being attempted, and
any error messages. Mark truncations explicitly.

---

## 1. Does the missing module path exist on disk?

The error claims `next/dist/compiled/babel/eslint-parser` cannot be found.
Please show what is actually present.

### 1a. Output of `ls -la node_modules/next/dist/compiled/babel/ 2>&1 | head -40` (from repo root):

Answer:
```
<!-- server agent: paste output here -->
```

### 1b. Output of `find node_modules/next/dist/compiled -maxdepth 2 -name "*eslint*" 2>&1`:

Answer:
```
<!-- server agent: paste output here -->
```

### 1c. Output of `ls node_modules/next/dist/compiled/ 2>&1 | head -40`:

Answer:
```
<!-- server agent: paste output here -->
```

---

## 2. What is `eslint-config-next` actually requiring?

Please paste the relevant require line(s) from `eslint-config-next/dist/parser.js`.

### 2a. Output of `head -40 node_modules/eslint-config-next/dist/parser.js`:

Answer:
```
<!-- server agent: paste output here -->
```

### 2b. Output of `grep -rn "compiled/babel" node_modules/eslint-config-next/dist/ 2>&1`:

Answer:
```
<!-- server agent: paste output here -->
```

---

## 3. Full ESLint error and require stack

The previous report showed a truncated require stack. Please rerun lint
with stack visibility and paste the full output.

### 3a. Output of `npm run lint --workspace newsnexus12portal 2>&1 | head -60`:

Answer:
```
<!-- server agent: paste output here -->
```

### 3b. Output of `cd portal && DEBUG=eslint:* npx eslint --print-config eslint.config.mjs 2>&1 | tail -40` (if it errors, paste the error; if it succeeds, paste the last 40 lines):

Answer:
```
<!-- server agent: paste output here -->
```

---

## 4. Install integrity

The original report noted that `npm install` did not resolve the failure.
Please check whether `next` is actually fully extracted in `node_modules`.

### 4a. Output of `npm ls next eslint-config-next @babel/eslint-parser 2>&1`:

Answer:
```
<!-- server agent: paste output here -->
```

### 4b. Output of `npm view next@16.2.4 files 2>&1 | grep -E "babel|eslint" | head -20`:

Answer:
```
<!-- server agent: paste output here -->
```

### 4c. Output of `du -sh node_modules/next 2>&1` (just to confirm next is not partially installed):

Answer:
```
<!-- server agent: paste output here -->
```

---

## 5. Current portal eslint config

Confirm what config the lint step is loading.

### 5a. Output of `cat portal/eslint.config.mjs`:

Answer:
```
<!-- server agent: paste output here -->
```

### 5b. Are there any other ESLint config files in `portal/` (e.g. `.eslintrc*`, `eslint.config.js`)? Output of `ls -la portal/ | grep -i eslint`:

Answer:
```
<!-- server agent: paste output here -->
```

---

## 6. Server agent's own diagnosis

After running the above, please share your read.

### 6a. Based on the directory listings above, does `next@16.2.4` actually ship `dist/compiled/babel/eslint-parser` in its tarball? If not, what does it ship in `dist/compiled/babel/`?

Answer:
```
<!-- server agent: write your diagnosis here -->
```

### 6b. Is this consistent with a known upstream packaging change in Next 16 (e.g. removal of the bundled Babel ESLint parser)? Cite the upstream changelog/PR if you can find it.

Answer:
```
<!-- server agent: write your diagnosis here -->
```

### 6c. What is the smallest fix you would propose? Options to consider, in order of preference:
- pin `next` and `eslint-config-next` to a different patched version known to ship the path,
- add a direct dependency on `@babel/eslint-parser` and adjust `portal/eslint.config.mjs` to use it explicitly,
- swap to a non-Babel parser (e.g. `@typescript-eslint/parser`-only config), removing the dependency on the Babel parser entirely,
- something else.

Answer:
```
<!-- server agent: write your recommendation here -->
```

---

## When finished

Commit this file with your updates and push to `dev_09_issues`. Suggested
commit message:

```
docs: answer issue 3 portal lint diagnostics

co-authored-by: <your-agent-name> (<your-model>)
```
