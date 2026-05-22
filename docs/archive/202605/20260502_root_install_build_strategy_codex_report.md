# root install/build strategy recommendation

## recommendation

Use a hybrid centered on a root `package.json` with npm workspaces for Node dependency installation, plus explicit ordered root scripts for builds and checks.

Do not make `worker-python` an npm workspace. Expose Python setup through clearly named root npm scripts that call Python tooling, but keep it separate from default Node install/build commands.

This gives Nick the simple root commands he wants:

```bash
npm install
npm run build
```

`npm build` should also work as npm's alias for `npm run build`, but docs should prefer `npm run build`.

## why this is the best fit

- `npm install` at the root is the durable Node install path npm already understands.
- npm workspaces can install `db-models`, `db-manager`, `api`, `worker-node`, and `portal` from one root lockfile.
- Build order still matters because `api`, `db-manager`, and `worker-node` consume `@newsnexus/db-models` through local dependencies whose `main` and `types` point at `dist`.
- Explicit root scripts are clearer and safer than relying on workspace traversal order.
- Shell-only orchestration would work, but it would make `npm install` at the root less natural and would preserve multiple independent lockfiles as the main install surface.
- Python setup should be explicit because `worker-python` is not a Node package and may require venv, system packages, and prod-specific service management.

## proposed root package.json

Add `/home/limited_user/applications/NewsNexus12/package.json`:

```json
{
  "name": "newsnexus12",
  "version": "0.1.0",
  "private": true,
  "description": "Root orchestration package for the NewsNexus12 monorepo.",
  "workspaces": [
    "db-models",
    "db-manager",
    "api",
    "worker-node",
    "portal"
  ],
  "scripts": {
    "build": "npm run build:node",
    "build:node": "npm run build --workspace @newsnexus/db-models && npm run build --workspace @newsnexus/db-manager && npm run build --workspace newsnexus12api && npm run build --workspace newsnexus12-worker-node && npm run build --workspace newsnexus12portal",
    "build:backend": "npm run build --workspace @newsnexus/db-models && npm run build --workspace @newsnexus/db-manager && npm run build --workspace newsnexus12api && npm run build --workspace newsnexus12-worker-node",
    "build:portal": "npm run build --workspace newsnexus12portal",
    "clean": "npm run clean --workspace @newsnexus/db-models && npm run clean --workspace @newsnexus/db-manager",
    "lint": "npm run lint --workspace newsnexus12portal",
    "check": "npm run build:node && npm run lint",
    "test:api": "npm test --workspace newsnexus12api",
    "test:worker-node": "npm test --workspace newsnexus12-worker-node",
    "test:db-manager": "npm test --workspace @newsnexus/db-manager",
    "test:node": "npm run test:api && npm run test:worker-node && npm run test:db-manager",
    "check:dev": "npm run check && npm run test:node && npm run python:test",
    "python:venv": "python3 -m venv worker-python/venv",
    "python:install": "worker-python/venv/bin/python -m pip install -r worker-python/requirements.txt",
    "python:install:dev": "worker-python/venv/bin/python -m pip install -r worker-python/requirements.txt -r worker-python/requirements-dev.txt",
    "python:test": "cd worker-python && venv/bin/python -m pytest",
    "setup:python": "npm run python:venv && npm run python:install",
    "setup:python:dev": "npm run python:venv && npm run python:install:dev",
    "postinstall:chrome": "npm run puppeteer:browsers:install --workspace newsnexus12-worker-node"
  },
  "engines": {
    "node": ">=20"
  }
}
```

Notes:

- Do not add a root `install` script. In npm, an `install` script runs as a lifecycle hook during `npm install`; using it for orchestration can create surprising behavior.
- `postinstall:chrome` is intentionally not a real npm lifecycle hook. It is a manual command for worker-node browser setup.
- `clean` only calls packages that already have `clean`; it avoids inventing delete behavior for packages that do not define it.
- `check` should remain safe for prod: compile Node packages and lint portal, but do not run DB maintenance, seed prompts, restore backups, start services, or hit AI workflows.

## worker-python handling

Keep `worker-python` outside npm workspaces. Root npm scripts can delegate to Python commands for convenience:

```bash
npm run setup:python
npm run setup:python:dev
npm run python:test
```

Default `npm install` should install only Node workspaces. Default `npm run build` should build only Node/Next projects. Python has no build step, and pretending it is an npm package would hide the real operational requirement: create a venv and install `requirements.txt`.

For production, use:

```bash
npm ci
npm run build
npm run setup:python
```

For development, use:

```bash
npm install
npm run setup:python:dev
npm run check:dev
```

If production does not need Python dev tools, do not install `requirements-dev.txt`.

## prod vs dev safe defaults

Production-safe defaults:

- `npm install` or preferably `npm ci` after the root lockfile is committed.
- `npm run build`.
- `npm run setup:python` when the Python worker is deployed on that machine.
- `npm run postinstall:chrome` only on machines running worker-node scraper flows that require Puppeteer Chrome.

Development defaults:

- `npm install`.
- `npm run setup:python:dev`.
- `npm run check:dev`.
- Package-specific dev servers should stay explicit, for example `npm run dev --workspace newsnexus12api`.

Commands that should not be part of default install/build/check:

- `db-manager npm start` with any flags.
- database drop, restore, backup import, cleanup, or seed operations.
- long-running `dev` or `start` servers.
- worker workflow starters.
- AI approver prompt setup or gatekeeper activation.
- Puppeteer browser install as an automatic postinstall lifecycle hook.

## npm workspace risks and pitfalls

- Existing package lockfiles are independent. A root workspace install will create a root `package-lock.json`; after that, root `npm ci` uses the root lockfile, not each workspace's lockfile as the primary source of truth.
- The transition will likely create a large root lockfile diff and may reveal old lockfile drift. One example from inspection: `api/package-lock.json` still has an extraneous `../NewsNexus12Db` entry.
- Local `file:../db-models` dependencies can work with workspaces, but they are redundant once `db-models` is also a workspace. The safer first implementation is to keep the existing `file:` specs, add workspaces, run one root install, and inspect the resulting links/lockfile before changing dependency specs.
- A later cleanup could replace local specs with workspace-aware ranges such as `"@newsnexus/db-models": "file:../db-models"` kept as-is, or `"workspace:*"` if the repo standardizes on npm workspace protocol support. Do not do that in the first pass unless install/build is verified.
- Hoisting can change where dependencies are physically installed. Code should not rely on package-local `node_modules` paths.
- `npm run --workspaces build` is not enough because traversal order is not the contract Nick cares about; explicit ordered scripts are clearer.
- Next.js 16 and modern tooling make Node 20 a more realistic root engine than the older `>=16` in `db-models` and `db-manager`.

## recommended implementation steps

If Nick asks to implement this next:

1. Add the root `package.json` above.
2. Run root `npm install` once to generate the root `package-lock.json`.
3. Verify workspace links and local package resolution without changing source files.
4. Run `npm run build` from the root.
5. Run `npm run check` from the root.
6. Run Python setup separately only when appropriate: `npm run setup:python` or `npm run setup:python:dev`.
7. Update the root `README.md` with the new root commands and keep package-specific commands as advanced/manual operations.
8. Decide whether to keep or remove per-package lockfiles. For a true workspace repo, prefer one committed root `package-lock.json`; if keeping package lockfiles temporarily, document that root install is authoritative.
9. Do not touch the uncommitted AI approver gatekeeper changes while making this infrastructure change.

## proposed files

Add:

- `package.json`
- `package-lock.json` generated by root `npm install`
- root `README.md` setup section update

Optional later:

- `scripts/setup-python.sh` if the Python setup needs OS checks, idempotent venv repair, or clearer failure messages than an npm one-liner can provide.
- `scripts/prod-setup.sh` only if deployment needs a single command wrapper around `npm ci`, `npm run build`, and `npm run setup:python`.

Do not add:

- `worker-python/package.json`
- npm lifecycle scripts that run Python installs automatically
- root scripts that run database mutation, prompt seed, service startup, or workflow starter commands
