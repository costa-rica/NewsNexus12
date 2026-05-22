---
created_at: 2026-05-22
updated_at: 2026-05-22
created_by: claude (opus-4.7)
modified_by: codex (gpt-5)
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
ls: cannot access 'node_modules/next/dist/compiled/babel/': No such file or directory
```

### 1b. Output of `find node_modules/next/dist/compiled -maxdepth 2 -name "*eslint*" 2>&1`:

Answer:
```
find: ‘node_modules/next/dist/compiled’: No such file or directory
```

### 1c. Output of `ls node_modules/next/dist/compiled/ 2>&1 | head -40`:

Answer:
```
ls: cannot access 'node_modules/next/dist/compiled/': No such file or directory
```

---

## 2. What is `eslint-config-next` actually requiring?

Please paste the relevant require line(s) from `eslint-config-next/dist/parser.js`.

### 2a. Output of `head -40 node_modules/eslint-config-next/dist/parser.js`:

Answer:
```
"use strict";
var _eslintparser = require("next/dist/compiled/babel/eslint-parser");
var _packagejson = require("../package.json");
var parser = {
    parse: _eslintparser.parse,
    parseForESLint: _eslintparser.parseForESLint,
    meta: {
        name: 'eslint-config-next/parser',
        version: _packagejson.version
    }
};
module.exports = parser;
```

### 2b. Output of `grep -rn "compiled/babel" node_modules/eslint-config-next/dist/ 2>&1`:

Answer:
```
node_modules/eslint-config-next/dist/parser.js:2:var _eslintparser = require("next/dist/compiled/babel/eslint-parser");
```

---

## 3. Full ESLint error and require stack

The previous report showed a truncated require stack. Please rerun lint
with stack visibility and paste the full output.

### 3a. Output of `npm run lint --workspace newsnexus12portal 2>&1 | head -60`:

Answer:
```

> newsnexus12portal@0.1.0 lint
> eslint


Oops! Something went wrong! :(

ESLint: 9.39.4

Error: Cannot find module 'next/dist/compiled/babel/eslint-parser'
Require stack:
- /home/limited_user/applications/NewsNexus12/node_modules/eslint-config-next/dist/parser.js
- /home/limited_user/applications/NewsNexus12/node_modules/eslint-config-next/dist/index.js
- /home/limited_user/applications/NewsNexus12/node_modules/eslint-config-next/dist/core-web-vitals.js
    at Module._resolveFilename (node:internal/modules/cjs/loader:1476:15)
    at wrapResolveFilename (node:internal/modules/cjs/loader:1049:27)
    at defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1073:10)
    at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1094:12)
    at Module._load (node:internal/modules/cjs/loader:1262:25)
    at wrapModuleLoad (node:internal/modules/cjs/loader:255:19)
    at Module.require (node:internal/modules/cjs/loader:1576:12)
    at require (node:internal/modules/helpers:153:16)
    at Object.<anonymous> (/home/limited_user/applications/NewsNexus12/node_modules/eslint-config-next/dist/parser.js:2:21)
    at Module._compile (node:internal/modules/cjs/loader:1830:14)
npm error Lifecycle script `lint` failed with error:
npm error code 2
npm error path /home/limited_user/applications/NewsNexus12/portal
npm error workspace newsnexus12portal@0.1.0
npm error location /home/limited_user/applications/NewsNexus12/portal
npm error command failed
npm error command sh -c eslint
```

### 3b. Output of `cd portal && DEBUG=eslint:* npx eslint --print-config eslint.config.mjs 2>&1 | tail -40` (if it errors, paste the error; if it succeeds, paste the last 40 lines):

Answer:
```
2026-05-22T16:15:41.352Z eslint:config-loader [Legacy]: Calculating config for /home/limited_user/applications/NewsNexus12/portal/eslint.config.mjs
2026-05-22T16:15:41.352Z eslint:config-loader [Legacy]: Using config file /home/limited_user/applications/NewsNexus12/portal/eslint.config.mjs and base path /home/limited_user/applications/NewsNexus12/portal
2026-05-22T16:15:41.353Z eslint:config-loader Calculating config array from config file /home/limited_user/applications/NewsNexus12/portal/eslint.config.mjs and base path /home/limited_user/applications/NewsNexus12/portal
2026-05-22T16:15:41.355Z eslint:config-loader Loading config file /home/limited_user/applications/NewsNexus12/portal/eslint.config.mjs
2026-05-22T16:15:41.358Z eslint:config-loader Loading config from /home/limited_user/applications/NewsNexus12/portal/eslint.config.mjs
2026-05-22T16:15:41.358Z eslint:config-loader Config file URL is file:///home/limited_user/applications/NewsNexus12/portal/eslint.config.mjs
2026-05-22T16:15:44.441Z eslint:rules Loading rule 'consistent-return' (remaining=291)
2026-05-22T16:15:44.526Z eslint:rules Loading rule 'dot-notation' (remaining=290)
2026-05-22T16:15:44.538Z eslint:rules Loading rule 'init-declarations' (remaining=289)
2026-05-22T16:15:44.541Z eslint:rules Loading rule 'max-params' (remaining=288)
2026-05-22T16:15:44.627Z eslint:rules Loading rule 'no-dupe-class-members' (remaining=287)
2026-05-22T16:15:44.647Z eslint:rules Loading rule 'no-empty-function' (remaining=286)
2026-05-22T16:15:44.688Z eslint:rules Loading rule 'no-invalid-this' (remaining=285)
2026-05-22T16:15:44.692Z eslint:rules Loading rule 'no-loop-func' (remaining=284)
2026-05-22T16:15:44.695Z eslint:rules Loading rule 'no-loss-of-precision' (remaining=283)
2026-05-22T16:15:44.696Z eslint:rules Loading rule 'no-magic-numbers' (remaining=282)
2026-05-22T16:15:44.814Z eslint:rules Loading rule 'no-restricted-imports' (remaining=281)
2026-05-22T16:15:45.007Z eslint:rules Loading rule 'no-unused-expressions' (remaining=280)
2026-05-22T16:15:45.018Z eslint:rules Loading rule 'no-useless-constructor' (remaining=279)
2026-05-22T16:15:45.104Z eslint:rules Loading rule 'prefer-destructuring' (remaining=278)

Oops! Something went wrong! :(

ESLint: 9.39.4

Error: Cannot find module 'next/dist/compiled/babel/eslint-parser'
Require stack:
- /home/limited_user/applications/NewsNexus12/node_modules/eslint-config-next/dist/parser.js
- /home/limited_user/applications/NewsNexus12/node_modules/eslint-config-next/dist/index.js
- /home/limited_user/applications/NewsNexus12/node_modules/eslint-config-next/dist/core-web-vitals.js
    at Module._resolveFilename (node:internal/modules/cjs/loader:1476:15)
    at wrapResolveFilename (node:internal/modules/cjs/loader:1049:27)
    at defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1073:10)
    at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1094:12)
    at Module._load (node:internal/modules/cjs/loader:1262:25)
    at wrapModuleLoad (node:internal/modules/cjs/loader:255:19)
    at Module.require (node:internal/modules/cjs/loader:1576:12)
    at require (node:internal/modules/helpers:153:16)
    at Object.<anonymous> (/home/limited_user/applications/NewsNexus12/node_modules/eslint-config-next/dist/parser.js:2:21)
    at Module._compile (node:internal/modules/cjs/loader:1830:14)
```

---

## 4. Install integrity

The original report noted that `npm install` did not resolve the failure.
Please check whether `next` is actually fully extracted in `node_modules`.

### 4a. Output of `npm ls next eslint-config-next @babel/eslint-parser 2>&1`:

Answer:
```
newsnexus12@0.1.0 /home/limited_user/applications/NewsNexus12
└─┬ newsnexus12portal@0.1.0 -> ./portal
  ├── eslint-config-next@16.2.4
  └── next@16.2.4
```

### 4b. Output of `npm view next@16.2.4 files 2>&1 | grep -E "babel|eslint" | head -20`:

Answer:
```
Summary: command produced no output.
```

### 4c. Output of `du -sh node_modules/next 2>&1` (just to confirm next is not partially installed):

Answer:
```
du: cannot access 'node_modules/next': No such file or directory
```

---

## 5. Current portal eslint config

Confirm what config the lint step is loading.

### 5a. Output of `cat portal/eslint.config.mjs`:

Answer:
```
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
```

### 5b. Are there any other ESLint config files in `portal/` (e.g. `.eslintrc*`, `eslint.config.js`)? Output of `ls -la portal/ | grep -i eslint`:

Answer:
```
-rw-rw----    1 nick limited_user    361 May  2 21:55 eslint.config.mjs
```

---

## 6. Server agent's own diagnosis

After running the above, please share your read.

### 6a. Based on the directory listings above, does `next@16.2.4` actually ship `dist/compiled/babel/eslint-parser` in its tarball? If not, what does it ship in `dist/compiled/babel/`?

Answer:
```
Summary: `node_modules/next` does not exist at the repo root, so the requested root-level directory listings cannot show `dist/compiled/babel/eslint-parser`. Read-only follow-up inspection found `portal/node_modules/next/dist/compiled/babel/eslint-parser.js`, and `npm pack next@16.2.4 --dry-run --json | grep -E "dist/compiled/babel|eslint-parser|compiled/babel" | head -40` shows the `next@16.2.4` tarball does ship:

- `dist/compiled/babel/bundle.js`
- `dist/compiled/babel/eslint-parser.js`
- other files under `dist/compiled/babel/`

The failing require is from root-hoisted `node_modules/eslint-config-next/dist/parser.js`, but `next` is nested under `portal/node_modules/next`, so Node does not find `next` when resolving from the root-hoisted `eslint-config-next` package.
```

### 6b. Is this consistent with a known upstream packaging change in Next 16 (e.g. removal of the bundled Babel ESLint parser)? Cite the upstream changelog/PR if you can find it.

Answer:
```
Summary: No. The local diagnostics are not consistent with an upstream removal of the bundled Babel ESLint parser in `next@16.2.4`; the tarball and the installed workspace copy under `portal/node_modules/next` both include `dist/compiled/babel/eslint-parser.js`. I did not find evidence here that a Next 16 packaging change removed this path. The observed failure is consistent with dependency placement/module resolution in the workspace install.
```

### 6c. What is the smallest fix you would propose? Options to consider, in order of preference:
- pin `next` and `eslint-config-next` to a different patched version known to ship the path,
- add a direct dependency on `@babel/eslint-parser` and adjust `portal/eslint.config.mjs` to use it explicitly,
- swap to a non-Babel parser (e.g. `@typescript-eslint/parser`-only config), removing the dependency on the Babel parser entirely,
- something else.

Answer:
```
Summary: smallest fix would be to make `eslint-config-next` and `next` resolve from the same package scope. Prefer correcting the workspace install/dependency placement so the root-hoisted `eslint-config-next` can resolve `next`, or so `eslint-config-next` is installed under `portal/node_modules` beside `next`. Pinning to another Next version is not indicated by these diagnostics because `next@16.2.4` does ship the required parser path.

I would not start by adding `@babel/eslint-parser` or replacing the parser config; the failing import is specifically `eslint-config-next` requiring Next's bundled parser, and that file exists in the nested portal install.
```

---

## When finished

Commit this file with your updates and push to `dev_09_issues`. Suggested
commit message:

```
docs: answer issue 3 portal lint diagnostics

co-authored-by: <your-agent-name> (<your-model>)
```
