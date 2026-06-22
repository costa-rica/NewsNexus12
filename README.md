# News Nexus 12 - Monorepo

This project is the monorepo of applicaitons that are part of the News Nexus ecosystem. The focus is the website / database which includes the API / NextJS frontend, and custom database package. The News Nexus project makes use of node.js and python services. This mono repo will incorporate these microservices in queueing APIs one for Node.js app and another for Python apps, respectivly named: worker-node/ and worker-python.

- This News Nexus 12 project is built off the News Nexus 11 project with changing database infrastructure from SQLite to PostGres.


## Setup

Run from root of project.

### 1. Install Node dependencies:

```bash
npm install
```

The root npm workspace includes `db-models`, `db-manager`, `api`, `worker-node`, and `portal`.
`worker-python` is not included in the npm workspace flow.

### 2. Set up worker-python:

```bash
cd worker-python
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cd ..
```

### 3. Build the npm workspace apps:

```bash
npm run build
```

The root build runs the packages in dependency order, including `db-models` before the apps that depend on it.

### 4. Start locally in separate terminals:

```bash
# terminal 1: API, port 3000
npm run start:api

# terminal 2: worker-node, port 3002 by default
npm run start:worker-node

# terminal 3: portal, port 3001
npm run start:portal

# terminal 4: worker-python, port 5000
cd worker-python && source venv/bin/activate && uvicorn src.main:app --host 0.0.0.0 --port 5000
```

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
