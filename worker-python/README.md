# NewsNexus Python Queuer (FastAPI)

This is the new FastAPI-based worker service for NewsNexus11.

## Current status

- Worker API and deduper pipeline run in-process.
- Legacy Flask service remains in `worker-python-flask/` for fallback.
- Implementation and maintenance guidance is in `AGENT.md`.

## Quick start

1. Create or reuse a virtual environment.
2. Install dependencies.
3. Run the API with Uvicorn.

```bash
cd worker-python
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn src.main:app --reload --host 0.0.0.0 --port 5000
```

## Test setup

Install dev dependencies:

```bash
pip install -r requirements-dev.txt
```

Run tests:

```bash
make test
make test-fast
make test-contract
```

## AI Approver prompt setup

The AI Approver flow can use prompt rows from `AiApproverPromptVersions` before the portal prompt-management page exists.

Use the one-time setup script to insert a prompt row from a markdown file:

```bash
cd worker-python
python3 src/standalone/setup_ai_approver_prompt.py --active
```

Default behavior:

- loads environment variables from `worker-python/.env`
- reads `PATH_DATABASE` and `NAME_DB`
- reads `worker-python/docs/PROMPT_RESIDENTIAL_FIRE.md`
- inserts a row into `AiApproverPromptVersions`
- marks the row active when `--active` is provided

Optional arguments:

- `--prompt-file` to load a different markdown file
- `--name` to override the prompt row name
- `--description` to override the prompt row description

Example:

```bash
cd worker-python
python3 src/standalone/setup_ai_approver_prompt.py \
  --prompt-file docs/PROMPT_RESIDENTIAL_FIRE.md \
  --name "Residential Fire" \
  --description "Initial AI approver prompt for residential fire scoring." \
  --active
```

## Endpoints currently implemented

- `GET /`
- `GET /test`
- `GET /deduper/jobs`
- `GET /deduper/jobs/reportId/{report_id}`
- `GET /deduper/jobs/{job_id}`
- `POST /deduper/jobs/{job_id}/cancel`
- `GET /deduper/jobs/list`
- `GET /deduper/health`
- `DELETE /deduper/clear-db-table`

## Next work

- Finalize deployment checklist and rollout safeguards.
- Continue endpoint and operations documentation maintenance.
