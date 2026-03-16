# Worker-Python Location Scorer TODO

This checklist breaks the absorption of NewsNexusClassifierLocationScorer01 into worker-python into phases. Each phase is self-contained and should be committed separately after tests pass.

Prerequisite: The shared queue infrastructure from `WORKER-PYTHON_QUEUE_REFACTOR_TODO.md` should be complete through at least Phase 3 (queue engine) before starting Phase 4 of this TODO, which wires the location scorer into the queue. Phases 1-3 here can proceed in parallel with the queue refactor.

Implementation decisions captured for this TODO:

1. worker-python startup should fail if any required location scorer env vars are missing once the workflow is wired into runtime startup validation
2. startup validation should log which env var is missing before exiting
3. the env var name for the location scorer AI entity should be `NAME_AI_ENTITY_LOCATION_SCORER`
4. queue status values should remain aligned with the shared queue contract, but location scorer jobs may store additional progress details in persisted job result metadata so the portal can show more informative status text without adding new queue status enums
5. route naming should follow the current hyphenated convention such as `/queue-info/check-status/{jobId}` and `/queue-info/cancel-job/{jobId}`
6. the repository may rely on the existing uniqueness constraint on `ArticleEntityWhoCategorizedArticleContracts(articleId, entityWhoCategorizesId, keyword)`

Testing guidance follows the same principles as the queue refactor TODO:

1. test behavior and contract, not internal implementation details
2. keep tests deterministic by mocking boundaries such as filesystem, ML model, and database
3. keep route tests thin and focused on request, response, and key side effects
4. use temporary directories and in-memory SQLite for repository tests
5. keep env setup explicit in each suite
6. cover a happy path and at least one failure path per new module

Recommended test layout:

1. `tests/unit/location_scorer/`
   - config validation
   - repository queries
   - orchestrator pipeline flow
   - individual processors
2. `tests/integration/`
   - location scorer route behavior with FastAPI test client
   - end-to-end pipeline with mock classifier
3. `tests/contracts/`
   - stable response contracts for location scorer start-job endpoint

## Phase 1. Define module structure, config, types, and errors

- [x] Create `src/modules/location_scorer/__init__.py` with public API exports.
- [x] Create `src/modules/location_scorer/errors.py` with:
  - `LocationScorerError` (base)
  - `LocationScorerConfigError`
  - `LocationScorerDatabaseError`
  - `LocationScorerProcessorError`
- [x] Create `src/modules/location_scorer/types.py` with:
  - `LocationScorerStep` StrEnum: `load`, `classify`, `write`
  - `LocationScorerRunMode` StrEnum (e.g., `score`)
  - `StepProgress` dataclass (reuse or mirror deduper pattern)
  - `PipelineSummary` dataclass
- [x] Create `src/modules/location_scorer/config.py` with:
  - `LocationScorerConfig` dataclass with `from_env()` classmethod
  - Required env vars: `PATH_DATABASE`, `NAME_DB`, `NAME_AI_ENTITY_LOCATION_SCORER`
  - Optional env vars: `LOCATION_SCORER_BATCH_SIZE` (default `10`), `LOCATION_SCORER_CHECKPOINT_INTERVAL` (default `10`)
  - `validate_location_scorer_startup_env()` function that logs the specific missing env var name before raising
- [x] Create `src/modules/location_scorer/processors/__init__.py` (empty).

Tests to implement in this phase:

- [x] Add unit tests for config `from_env()` with valid and missing env vars.
- [x] Add unit tests for `validate_location_scorer_startup_env()` with missing required keys.
- [x] Add unit tests for status enum values and step enum values.

Suggested test files:

1. `tests/unit/location_scorer/test_config.py`
2. `tests/unit/location_scorer/test_types.py`

Phase completion instructions:

1. Run:

```bash
cd worker-python
source venv/bin/activate
pytest tests/unit/location_scorer/test_config.py tests/unit/location_scorer/test_types.py
```

2. If all tests pass, check off the completed tasks in this file.
3. Commit all Phase 1 changes before starting Phase 2.

## Phase 2. Build the repository

- [x] Create `src/modules/location_scorer/repository.py` following the deduper repository pattern:
  - Use raw `sqlite3` (not SQLAlchemy) to match the deduper pattern.
  - Lazy connection initialization with `get_connection()`.
  - `close()` method for cleanup.
  - `healthcheck()` method.
- [x] Implement `get_entity_who_categorized_article_id(ai_entity_name)`:
  - Look up `ArtificialIntelligences.id` by name.
  - Look up `EntityWhoCategorizedArticles.id` by `artificialIntelligenceId`.
  - Return the entity ID or `None`.
- [x] Implement `get_unscored_articles(entity_id, limit=None)`:
  - Query `Articles` for `id`, `title`, `description`.
  - Exclude articles already in `ArticleEntityWhoCategorizedArticleContracts` for this entity.
  - Apply optional limit.
  - Return list of dicts.
- [x] Implement `write_scores_batch(entity_id, scores)`:
  - Insert rows into `ArticleEntityWhoCategorizedArticleContracts`.
  - Fields: `articleId`, `entityWhoCategorizesId`, `keyword`, `keywordRating`, `createdAt`, `updatedAt`.
  - Skip duplicates gracefully using the existing unique constraint on `(articleId, entityWhoCategorizesId, keyword)` and catch `IntegrityError`.
  - Return count of rows inserted and duplicates skipped.

Tests to implement in this phase:

- [x] Add unit tests using an in-memory SQLite database with the required table schemas.
- [x] Test `get_entity_who_categorized_article_id()` with existing and missing entities.
- [x] Test `get_unscored_articles()` with scored and unscored articles, and with limit.
- [x] Test `write_scores_batch()` with valid data and duplicate handling.
- [x] Test `healthcheck()` success and failure.

Suggested test files:

1. `tests/unit/location_scorer/test_repository.py`

Phase completion instructions:

1. Run:

```bash
cd worker-python
source venv/bin/activate
pytest tests/unit/location_scorer/test_repository.py
```

2. If all tests pass, check off the completed tasks in this file.
3. Commit all Phase 2 changes before starting Phase 3.

## Phase 3. Build the processors and orchestrator

### 3a. Load processor

- [x] Create `src/modules/location_scorer/processors/load.py`.
- [x] Implement `LoadProcessor` with `execute(should_cancel=None)`:
  - Use repository to look up the AI entity ID.
  - Raise `LocationScorerConfigError` if the AI entity is not found in the database.
  - Use repository to fetch unscored articles.
  - Return `{ "processed": count, "articles": list }` where articles is the list of unscored article dicts.
- [x] Support `should_cancel` callback for cooperative cancellation.

### 3b. Classify processor

- [x] Create `src/modules/location_scorer/processors/classify.py`.
- [x] Implement `ClassifyProcessor` with `execute(articles, should_cancel=None)`:
  - Accept the articles list from the load processor output.
  - Load `facebook/bart-large-mnli` model via `transformers.pipeline("zero-shot-classification")`.
  - For each article, classify `title + "\n\n" + description` against labels: `"Occurred in the United States"`, `"Occurred outside the United States"`.
  - Extract the US score.
  - Skip articles with empty title and description.
  - Check `should_cancel` at checkpoint intervals.
  - Return `{ "processed": count, "scores": list_of_score_dicts }` where each score dict has `article_id`, `score`, `rating_for`.
- [x] Implement lazy model loading so the model is loaded once and reused across calls.

### 3c. Write processor

- [x] Create `src/modules/location_scorer/processors/write.py`.
- [x] Implement `WriteProcessor` with `execute(entity_id, scores, should_cancel=None)`:
  - Accept the entity ID and scores list from prior processors.
  - Use repository `write_scores_batch()` to insert scores in batches.
  - Check `should_cancel` between batches.
  - Return `{ "processed": inserted_count, "duplicates": duplicate_count }`.

### 3d. Orchestrator

- [x] Create `src/modules/location_scorer/orchestrator.py`.
- [x] Implement `LocationScorerOrchestrator` following the deduper orchestrator pattern:
  - Constructor accepts `LocationScorerRepository` and `LocationScorerConfig`.
  - Implement `run_score(limit=None, should_cancel=None)`:
    - Step 1: `LoadProcessor.execute()` to get unscored articles.
    - Step 2: `ClassifyProcessor.execute(articles)` to classify articles.
    - Step 3: `WriteProcessor.execute(entity_id, scores)` to write results.
  - Use `_execute_pipeline_steps()` pattern with `StepProgress` tracking.
  - Return `PipelineSummary`.
- [x] Implement `check_ready()` via repository healthcheck.

Tests to implement in this phase:

- [x] Add unit tests for `LoadProcessor` with mocked repository.
- [x] Add unit tests for `ClassifyProcessor` with a mocked `transformers.pipeline` to avoid downloading the real model.
- [x] Add unit tests for `WriteProcessor` with mocked repository.
- [x] Add unit tests for orchestrator pipeline flow with all processors mocked.
- [x] Add cancellation tests for each processor and the orchestrator.
- [x] Add at least one failure-path test for missing AI entity in the load step.

Suggested test files:

1. `tests/unit/location_scorer/test_load_processor.py`
2. `tests/unit/location_scorer/test_classify_processor.py`
3. `tests/unit/location_scorer/test_write_processor.py`
4. `tests/unit/location_scorer/test_orchestrator.py`

Phase completion instructions:

1. Run:

```bash
cd worker-python
source venv/bin/activate
pytest tests/unit/location_scorer/
```

2. If all tests pass, check off the completed tasks in this file.
3. Commit all Phase 3 changes before starting Phase 4.

## Phase 4. Add route and wire into queue engine

This phase requires the shared queue engine from the queue refactor TODO (at least through Phase 3 of that document).

- [x] Create `src/routes/location_scorer.py`.
- [x] Implement `POST /location-scorer/start-job`:
  - Accept optional JSON body: `{ "limit": int | null }`.
  - Enqueue the job via the shared queue engine with `endpointName: "/location-scorer/start-job"`.
  - Return 202 with `{ "jobId": "...", "status": "queued", "endpointName": "/location-scorer/start-job" }`.
- [x] Implement the job runner function that the queue engine will call:
  - Create `LocationScorerOrchestrator` and `LocationScorerRepository`.
  - Call `orchestrator.run_score(limit=limit, should_cancel=cancel_callback)`.
  - Ensure repository is closed in a `finally` block.
- [x] Persist enough result metadata during execution to support a more informative portal status display without introducing new shared queue status enum values.
- [x] Register the location scorer router in `src/main.py`.
- [x] Add `validate_location_scorer_startup_env()` call to the startup validation block in `src/main.py`.
- [x] Confirm that queue-info endpoints (`/queue-info/latest-job?endpointName=/location-scorer/start-job`, `/queue-info/check-status/{jobId}`, `/queue-info/cancel-job/{jobId}`) work for location scorer jobs without any changes to the queue-info router.

Tests to implement in this phase:

- [x] Add integration tests for `POST /location-scorer/start-job` using FastAPI test client with the queue enqueue boundary mocked or controlled.
- [x] Test that the start-job response matches the expected shape: `jobId`, `status`, `endpointName`.
- [x] Test that an enqueued location scorer job appears via `/queue-info/latest-job?endpointName=/location-scorer/start-job`.
- [x] Test that cancellation works through the queue-info cancel endpoint.
- [x] Test start-job with and without the optional `limit` body parameter.
- [x] Add at least one failure-path test for startup with missing `NAME_AI_ENTITY_LOCATION_SCORER` env var and assert the log output identifies the missing variable.

Suggested test files:

1. `tests/integration/test_location_scorer_routes.py`
2. `tests/contracts/test_location_scorer_contract.py`

Phase completion instructions:

1. Run:

```bash
cd worker-python
source venv/bin/activate
pytest tests/unit/location_scorer/ tests/integration/test_location_scorer_routes.py tests/contracts/test_location_scorer_contract.py
```

2. If all tests pass, check off the completed tasks in this file.
3. Commit all Phase 4 changes before starting Phase 5.

## Phase 5. Dependencies and documentation

- [x] Add `transformers` to `requirements.txt` with an explicit version pin.
- [x] Verify that `torch` is available transitively via `sentence-transformers`. If not, add it explicitly.
- [x] Update `worker-python/AGENT.md` to document:
  - Location scorer module under the architecture map.
  - Runtime flow for location scorer jobs.
  - Required and optional environment variables for the location scorer.
  - The stable `endpointName` value: `/location-scorer/start-job`.
- [x] Confirm that the AI entity prerequisite (`ArtificialIntelligences` and `EntityWhoCategorizedArticles` rows) is documented. Either:
  - Include a standalone setup script at `src/standalone/update_location_scorer_ai_entities.py`, or
  - Document the manual SQL or existing script from the source project.
- [x] Update `worker-python/docs/worker-python-api-documentation/` with endpoint documentation for `POST /location-scorer/start-job`.

Tests to implement in this phase:

- [x] Run the full worker-python test suite to confirm no regressions.

Phase completion instructions:

1. Run:

```bash
cd worker-python
source venv/bin/activate
pytest
```

2. If all tests pass, check off the completed tasks in this file.
3. Commit all Phase 5 changes.

## Final validation

- [ ] Run the full worker-python test suite.
- [ ] Verify that `POST /location-scorer/start-job` enqueues a job and returns the expected response shape.
- [ ] Verify that `/queue-info/latest-job?endpointName=/location-scorer/start-job` returns the location scorer job.
- [ ] Verify that `/queue-info/cancel-job/{jobId}` cancels a running location scorer job.
- [ ] Verify that the location scorer job transitions through `queued`, `running`, and a terminal status (`completed`, `failed`, or `canceled`).
- [ ] Verify that job state persists to `queue-jobs.json` and survives a process restart.

Final validation commands:

```bash
cd worker-python
source venv/bin/activate
pytest
```

Final completion instructions:

1. If the full suite passes, check off the remaining tasks in this file.
2. Commit all remaining changes.
3. Only then move on to API proxy route work or portal integration work that depends on the location scorer queue contract.
