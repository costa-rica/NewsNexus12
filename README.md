# News Nexus 12 - Monorepo

This project is the monorepo of applicaitons that are part of the News Nexus ecosystem. The focus is the website / database which includes the API / NextJS frontend, and custom database package. The News Nexus project makes use of node.js and python services. This mono repo will incorporate these microservices in queueing APIs one for Node.js app and another for Python apps, respectivly named: worker-node/ and worker-python.

- This News Nexus 12 project is built off the News Nexus 11 project with changing database infrastructure from SQLite to PostGres.


## Root npm Workspace Workflow

```bash
npm install
npm run build
```

Root-level npm commands apply to all Node apps in the workspace list: db-models, db-manager, api, worker-node, and portal. worker-python is not included in the npm workspace flow.

## Key Documentation

- `worker-python/docs/20260502_HOW_TO_USE_AI_APPROVER.md` — AI Approver setup, prompt roles, gatekeeper modes, weekly automation behavior, and `N/A` troubleshooting.


## Directory Structure

```
.
├── AGENTS.md                        - AI assistant guidance for this monorepo
├── README.md
├── api/                            - Express.js REST API (TypeScript)
│   ├── src/
│   └── package.json
├── db-manager/                     - Database management CLI tool (@newsnexus/db-manager)
│   ├── src/
│   └── package.json
├── db-models/                      - Shared Sequelize models (@newsnexus/db-models)
│   ├── src/
│   └── package.json
├── docs/                           - Project-wide documentation
│   ├── PROJECT_OVERVIEW.md
│   ├── api-documentation/          - Per-route API docs
│   ├── images/
│   ├── references/
│   ├── requirements/
│   └── transition-to-newsnexus12/
├── portal/                         - Next.js frontend
│   ├── components/
│   ├── pages/
│   └── package.json
├── worker-python/                  - Python API queueing service
│   ├── src/
│   └── requirements.txt
└── worker-node/                    - ExpressJS / queueing service
    ├── src/
    └── package.json
```
