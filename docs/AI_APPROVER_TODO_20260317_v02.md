# AI_APPROVER_TODO_20260317_v02

1. purpose

- This checklist is based on `docs/PRE_REQUIREMENTS_AI_APPROVER_20260317_V03.md`.
- The feature is defined enough to begin implementation in phases.
- At the end of each phase:
  - Run the relevant tests and verification commands.
  - If the phase is complete and tests pass, check off the completed tasks.
  - Create a commit.
  - The commit message should refer to `docs/AI_APPROVER_TODO_20260317_v02.md` and mention the phase completed.

## 2. phase 1 - database models and API contracts

- [x] Add `AiApproverPromptVersions` model in `db-models`.
- [x] Add `AiApproverArticleScores` model in `db-models`.
- [x] Add the new models to `db-models/src/models/_index.ts`.
- [x] Add any required associations in `db-models/src/models/_associations.ts`.
- [x] Define `AiApproverPromptVersions` fields:
  - `id`
  - `name`
  - `description` nullable
  - `promptInMarkdown`
  - `isActive`
  - `endedAt` nullable
- [x] Define `AiApproverArticleScores` fields:
  - `id`
  - `articleId`
  - `promptVersionId`
  - `resultStatus`
  - `score`
  - `reason`
  - `errorCode` nullable
  - `errorMessage` nullable
  - `isHumanApproved` nullable
  - `reasonHumanRejected` nullable
  - `runKey` or `jobId` nullable
- [x] Add indexes needed for active prompt lookup and article score lookup.
- [x] Add a composite unique constraint on `(articleId, promptVersionId)`.
- [x] Ensure prompt rows are treated as immutable after creation.
- [x] Ensure score rows support per-score-row human validation state.
- [x] Seed or otherwise create the initial active prompt version for the first flow.
- [x] Build `db-models`.
- [x] Build `api` against the updated `db-models`.
- [x] Run relevant tests for this phase.
- [x] If tests pass, check off completed tasks in this phase.
- [x] Commit with a message that references `docs/AI_APPROVER_TODO_20260317_v02.md` and phase 1.

## 3. phase 2 - prompt management API

- [x] Add API routes for AI approver prompt management.
- [x] Add API handler to list rows from `AiApproverPromptVersions`.
- [x] Add API handler to create a new prompt row.
- [x] Add API handler to copy an existing prompt row into a new row.
- [x] Add API handler to activate or deactivate a prompt row.
- [x] Ensure `endedAt` is managed by the API, not the user.
- [x] Add API handler to delete a prompt row only when no `AiApproverArticleScores` rows reference it.
- [x] Return clear error responses when delete is blocked.
- [x] Add API validation for `promptInMarkdown`, `name`, `description`, and `isActive`.
- [x] Implement hard delete for unused prompt rows.
- [x] Add API tests for create, copy, list, activate/deactivate, and guarded delete behavior.
- [x] Run relevant tests for this phase.
- [x] If tests pass, check off completed tasks in this phase.
- [x] Commit with a message that references `docs/AI_APPROVER_TODO_20260317_v02.md` and phase 2.

## 4. phase 3 - worker-python OpenAI integration and AI approver workflow

- [x] Add the required OpenAI dependency to `worker-python/requirements.txt`.
- [x] Add `OPENAI_API_KEY` to worker-python environment requirements.
- [x] Add startup/config validation for `OPENAI_API_KEY`.
- [x] Add a thin OpenAI client wrapper or shared request utility for the AI approver flow.
- [x] Add a new generic `ai_approver` workflow module in `worker-python/src/modules/`.
- [x] Add a worker-python route for the AI approver flow.
- [x] Reuse the shared queue and job-status patterns.
- [x] Use a queue-based `start-job` route pattern.
- [x] Add repository queries to load active rows from `AiApproverPromptVersions`.
- [x] Add repository queries to select eligible articles.
- [x] Add filtering logic for:
  - article count limit
  - require AI state assignment flag
  - optional `stateIds: number[]` filter from the request body
  - skip any article that already has at least one row in `AiApproverArticleScores`
- [x] Filter by `stateId` values from `ArticleStateContract02` when `stateIds` are provided.
- [x] Load article content using the existing pattern:
  - prefer `ArticleContents`
  - fall back to article description if needed
- [x] Use `gpt-4o-mini` for v1 AI approver calls.
- [x] Send all active prompt versions through the inner loop for each eligible article.
- [x] Run prompt-version executions sequentially per article.
- [x] Require structured JSON responses.
- [x] Persist each score row immediately after each prompt-version response is processed.
- [x] Persist valid responses as `completed`.
- [x] Persist invalid JSON responses as `invalid_response`.
- [x] Persist provider or execution failures as `failed`.
- [x] Ensure invalid and failed attempts still create score rows.
- [x] Capture usage data from OpenAI responses when available.
- [x] Include enough job/result data for portal polling and troubleshooting.
- [x] Add worker-python tests for filtering, prompt lookup, response handling, persistence behavior, and OpenAI configuration behavior.
- [x] Run relevant tests for this phase.
- [x] If tests pass, check off completed tasks in this phase.
- [x] Commit with a message that references `docs/AI_APPROVER_TODO_20260317_v02.md` and phase 3.

## 5. phase 4 - API worker integration and score endpoints

- [x] Add API route to start the AI approver workflow.
- [x] Proxy requests from `api` to `worker-python`.
- [x] Accept request body fields for:
  - article count limit
  - require AI state assignment flag
  - optional `stateIds: number[]`
- [x] Use a queue-based start-job route pattern for the worker integration.
- [x] Add API route to fetch AI approver score rows for one `articleId`.
- [x] Return all prompt-version score rows and prompt metadata needed by the modal.
- [x] Add API route to update human validation fields on one `AiApproverArticleScores` row.
- [x] Allow `isHumanApproved` values of `true`, `false`, or `null`.
- [x] Allow `reasonHumanRejected` only when rejecting.
- [x] Add API route or query support for the review table to fetch the highest non-rejected score per article.
- [x] Ensure review-table queries treat `isHumanApproved = false` as excluded from top-score display.
- [x] Return no score link and `N/A` or blank behavior when an article has no AI approver score rows.
- [x] Add API tests for start, fetch details, human validation update, and top-score query behavior.
- [x] Run relevant tests for this phase.
- [x] If tests pass, check off completed tasks in this phase.
- [x] Commit with a message that references `docs/AI_APPROVER_TODO_20260317_v02.md` and phase 4.

## 6. phase 5 - portal automations UI

- [x] Add an `AI Approver` section to `/articles/automations`.
- [x] Reuse the existing automation section/status patterns where possible.
- [x] Add input for article count.
- [x] Add checkbox, checked by default, for requiring AI state assignment.
- [x] Add state filter dropdown.
- [x] Implement multi-select behavior for the state filter.
- [x] Pass the selected filters in the request body to the API.
- [x] Add `Manage Agent Prompts` button.
- [x] Route the button to the new prompt-management page.
- [x] Show run/job status in the section.
- [x] Add portal tests or lint verification for this phase.
- [x] Run relevant tests for this phase.
- [x] If tests pass, check off completed tasks in this phase.
- [ ] Commit with a message that references `docs/AI_APPROVER_TODO_20260317_v02.md` and phase 5.

## 7. phase 6 - review table and modal

- [ ] Add a new AI approver score column to the `/articles/review` table.
- [ ] Display the highest non-rejected AI approver score for each article.
- [ ] Show `N/A` or blank with no link when an article has no AI approver scores.
- [ ] Render the score as a clickable circle using the Nexus Semantic Rating color style.
- [ ] Add modal entry behavior when the score is clicked.
- [ ] Create a modal using the existing modal structure in `portal/src/components/ui/modal`.
- [ ] Fetch AI approver score rows for the selected `articleId` when the modal opens.
- [ ] Show all score rows and reasons in score order.
- [ ] Make each prompt name clickable to reveal the prompt text.
- [ ] Add human validation controls for the current highest non-rejected score row.
- [ ] Ensure human validation controls do not appear for lower-ranked rows while a higher non-rejected row exists.
- [ ] Support `approve`, `reject`, and `undetermined`.
- [ ] Show rejection text input only when `reject` is selected.
- [ ] Add `Validate Human Approval Status` action.
- [ ] Submit validation changes to the API.
- [ ] Refresh modal data after validation.
- [ ] Ensure that rejecting the current top row promotes the next highest non-rejected row in the table and modal.
- [ ] Ensure the UI makes clear that score acceptance is not final article approval.
- [ ] Add portal tests or lint verification for this phase.
- [ ] Run relevant tests for this phase.
- [ ] If tests pass, check off completed tasks in this phase.
- [ ] Commit with a message that references `docs/AI_APPROVER_TODO_20260317_v02.md` and phase 6.

## 8. phase 7 - portal prompt management page

- [ ] Add a new portal page for AI approver prompt management.
- [ ] Add a top form for prompt creation.
- [ ] Show `id` as read-only when applicable.
- [ ] Add inputs for `name`, `description`, `promptInMarkdown`, and `isActive`.
- [ ] Show `endedAt` as visible but read-only.
- [ ] Add a table below for `AiApproverPromptVersions` rows.
- [ ] Add `Copy` action in the table.
- [ ] Add `Delete` action in the table.
- [ ] Ensure there is no direct edit flow for existing prompts.
- [ ] Make `Copy` create a new prompt draft from an existing row.
- [ ] Hard delete prompts only when no `AiApproverArticleScores` rows reference that `promptVersionId`.
- [ ] Show blocked-delete feedback when score rows reference the prompt.
- [ ] Refresh the table after create, copy, activate/deactivate, or delete actions.
- [ ] Add portal navigation entry or route wiring for the prompt-management page as needed.
- [ ] Add portal tests or lint verification for this phase.
- [ ] Run relevant tests for this phase.
- [ ] If tests pass, check off completed tasks in this phase.
- [ ] Commit with a message that references `docs/AI_APPROVER_TODO_20260317_v02.md` and phase 7.

## 9. phase 8 - final verification and cleanup

- [ ] Verify the full end-to-end flow:
  - create prompt
  - activate prompt
  - run AI approver automation
  - display score in review table
  - open modal
  - validate score row
  - confirm fallback to next highest non-rejected score
- [ ] Verify prompt delete guard behavior.
- [ ] Verify state filter behavior in the automation flow.
- [ ] Verify skipped-article behavior when any score row already exists.
- [ ] Verify invalid JSON and failed attempts are stored correctly.
- [ ] Verify the review table query excludes rejected top rows.
- [ ] Verify no UI suggests prompt editing.
- [ ] Update any related documentation if implementation details changed.
- [ ] Run final relevant tests for this phase.
- [ ] If tests pass, check off completed tasks in this phase.
- [ ] Commit with a message that references `docs/AI_APPROVER_TODO_20260317_v02.md` and phase 8.
