---
created_at: 2026-07-23
updated_at: 2026-07-23
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# AI Approver V02 Assessment

## Feasibility and Complexity

### Feasibility

- The feature is feasible within the current architecture.
- The harness already supplies the main classifier behavior:
  - one prompt per article
  - Codex CLI execution
  - `approved` or `irrelevant` prediction
  - structured response validation
  - retry handling
- The existing worker-python queue, API proxy pattern, Sequelize models, and portal automation components can be extended without changing V01 code names.

### Complexity

- Overall complexity is medium-high because the work crosses:
  1. `db-models`
  2. `worker-python`
  3. `api`
  4. `portal`
  5. production database deployment
  6. tests and documentation
- Hiding V01 in the portal is simple. Safely isolating it is more involved because V01 is also used by the weekly orchestrator, prompt page, article review page, API routes, startup validation, reports, and worker-python endpoints.
- The highest-risk areas are article-range continuation, prompt immutability, concurrent runs, production schema creation, and preventing V01 and V02 data from being mixed.

## Responses to Questions to Coding Agent

### 1. Does the name `ai-approver-v02` conflict?

- No direct naming conflict exists if V02 receives its own:
  - worker route, such as `/ai-approver-v02/start-job`
  - Python module, such as `ai_approver_v02`
  - API route namespace
  - portal components and page
  - database models and tables
  - environment-variable prefix
- The name should not reuse `/ai-approver/start-job`. That endpoint currently belongs to V01 and is called by both the API and weekly orchestrator.
- V02 should use environment variables such as:
  - `AI_APPROVER_V02_MODEL_NAME`
  - `AI_APPROVER_V02_CODEX_TIMEOUT_SECONDS`
- Reusing V01 variables could make independent rollout and troubleshooting difficult.
- The existing documentation folder is spelled `ai-appover-v02`. This does not create a runtime conflict, but the spelling difference should be treated as an intentional repository path to avoid splitting documents across two folders.

#### Operator comment

### 2. Does assigning the old flow the reference name `ai-approver-v01` pose issues?

- No runtime issue is created when V01 is a documentation and user-interface label only.
- Existing V01 source names, routes, table names, environment variables, and orchestration step names should remain unchanged.
- The label must be documented clearly because the current code usually says only `ai_approver` or `AI Approver`.
- Renaming and hiding the portal automation cards does not fully disable V01. It remains reachable through:
  - direct API requests
  - worker-python requests
  - the weekly orchestrator backend
  - the existing prompt-management URL
  - article-review AI Approver actions
- A future removal report should inventory these dependencies before any V01 code or table is removed.

#### Operator comment

### 3. Are there better names to use?

- Keep `AI Approver V02` as the operator-facing feature name. It matches the requested terminology and clearly distinguishes the replacement.
- Use `ai-approver-v02` for URLs and `ai_approver_v02` for Python modules.
- Prefer prediction terminology over score terminology in new code:
  - `AiApproverArticlePredictionV02`
  - `AiApproverPromptVersionV02`
  - `AiApproverRunV02`
- `AiApproverArticleScoreV02` would work technically, but it suggests a numeric score that V02 does not produce.
- Avoid renaming V01 classes or tables. Their existing names describe historical data and are referenced throughout the API, portal review flow, worker-python repository, backups, and tests.

#### Operator comment

### 4. Should V02 have one or multiple database tables, and what should they be named?

- V02 should have at least two tables:
  1. `AiApproverPromptVersionsV02`
  2. `AiApproverArticlePredictionsV02`
- A third table is recommended: 3. `AiApproverRunsV02`

#### Prompt versions

- `AiApproverPromptVersionsV02` should store:
  - ID
  - optional title
  - editable prompt text
  - active state
  - first-used timestamp or immutable state
  - creation and update timestamps
- Only one prompt should normally be active.
- Activation and first use should be transaction-safe so a run cannot begin while its prompt is being edited.

#### Article predictions

- `AiApproverArticlePredictionsV02` should store:
  - article ID
  - prompt-version ID
  - optional run ID
  - result status
  - nullable prediction
  - reasoning
  - error code and error message
  - model name used
  - optional raw-response metadata
  - nullable `humanValidation`
  - nullable `humanComment`
  - creation and update timestamps
- Database checks should restrict predictions to `approved` and `irrelevant`.
- Failures and invalid responses should have a null prediction and a separate result status.
- Foreign keys and indexes should cover article ID, prompt-version ID, run ID, status, prediction, and common compound lookups.

#### Runs

- `AiApproverRunsV02` would provide durable audit and continuation data:
  - queue job ID
  - prompt-version ID
  - model name
  - requested article count
  - resolved article bounds
  - status
  - attempted, completed, failed, and skipped counts
  - start and end timestamps
- A run table is preferable to deriving every run boundary from prediction rows. Prediction rows alone cannot reliably describe a canceled run, a run with only failures, or the exact selection boundary.
- If the initial scope must remain smaller, two tables are sufficient, but continuation rules and job history will be less explicit.

#### Operator comment

### 5. Is another prediction option needed besides `irrelevant` or `approved`?

- No third business prediction is required for the requested binary classifier.
- Keep operational outcomes separate from predictions:
  - `completed`
  - `failed`
  - `invalid_response`
  - `canceled`
- A failed or malformed model response should not be converted into `irrelevant`.
- Human uncertainty should be represented through nullable human validation and comments, not by changing the model’s binary prediction.
- Add `needs_review` only if the operator wants the model to abstain. That would change the tested harness behavior and the meaning of the classifier.

#### Operator comment

## Questions for the Operator

### V01 visibility and access

#### 1. V01 automation visibility

Does “hide” mean removing the V01 cards from `/articles/automations`, or must V01 also be inaccessible through direct portal URLs?

##### Operator response

Yes, let's remove the crads from `/articles/automations`. But do not delete code files, just make them inaccessible .

#### 2. V01 prompt page

Should `/articles/automations/ai-approver-prompts` remain reachable for historical V01 prompt review?

##### Operator response

No, let's disable access, but not delete files.

#### 3. V01 review page

Should V01 actions and results remain visible on `/articles/review`?

##### Operator response

yes, but by default let's make the column hidden.

#### 4. Orchestrator visibility

Should the entire Weekly Orchestrator V01 card be hidden, or only its AI Approver step?

##### Operator response

hide / remove from the `/articles/automations` page. Do not delete code files, just make them inaccessible .

#### 5. Direct V01 access

May direct V01 API and worker-python calls continue after the portal controls are hidden?

##### Operator response

Yes

#### 6. V01 startup validation

Should worker-python continue failing startup when V01 Codex configuration is invalid, even if operators can no longer start V01 from the automation page?

##### Operator response

This needs to be an open questions when we make our first plan or PRD. Can we safely adn with low complexity remove teh worker-python failing on startup when V01 Codex configuration is invalid? if so let's remove this fail feature.

### V02 article selection

#### 7. Continuation watermark

What exactly is the V02 continuation watermark?

- The lowest article ID selected by the last run
- The lowest successfully completed article ID
- The lowest article ID with any prediction attempt
- Another boundary selected by the operator

##### Operator response

I don't understand this ? elaborate in details.

#### 8. Initial approved boundary

When there is no V02 history, does “up to the last approved article” mean stop before or include the highest `articleId` found in `ArticleApproveds`?

##### Operator response

#### 9. Approved-row exclusion

Should any `ArticleApproveds` row exclude an article, or only a row where `isApproved` is true?

##### Operator response

#### 10. Insufficient eligible rows

If fewer eligible articles exist in the resolved range, should the run stop below the requested count or continue past the watermark?

##### Operator response

#### 11. New-prompt continuation

When a new prompt becomes active, should V02 continue from the global watermark or reprocess earlier articles with the new prompt?

##### Operator response

#### 12. Automatic retries

Should failed and invalid responses retry automatically on the next run?

##### Operator response

### State and content eligibility

#### 13. State-row selection

Does any valid `ArticleStateContracts02` row qualify, or must the latest row qualify?

##### Operator response

#### 14. AI state verification

How should the implementation verify that a state assignment came from the AI state assigner rather than another source?

##### Operator response

#### 15. Content fallback

Should an article require successful `ArticleContents02` content, matching the harness default, or may it fall back to `Articles.description`, matching V01?

##### Operator response

#### 16. Multiple content rows

If several `ArticleContents02` rows exist, should V02 use the latest successful row or the longest successful content?

##### Operator response

#### 17. Article-count meaning

Does the requested article count mean:

- selected articles
- attempted model calls
- completed predictions

##### Operator response

### Prompt integrity

#### 18. Active-prompt requirement

Must there be exactly one active prompt at all times, or may there temporarily be none?

##### Operator response

#### 19. Prompt immutability

Does any prediction row make a prompt immutable, including failed and invalid-response rows?

##### Operator response

#### 20. Prompt reactivation

May an inactive but previously used prompt be reactivated?

##### Operator response

#### 21. Prompt-title rules

Should prompt titles be unique, or are duplicate and blank titles acceptable?

##### Operator response

#### 22. Rendered-prompt audit

Should the stored prediction include a snapshot or hash of the final rendered prompt for audit purposes?

##### Operator response

### Review and rollout

#### 23. Human-review location

Where should operators edit `humanValidation` and `humanComment`?

- A new V02 review page
- The existing article review page
- Database access only in the first release
- Another operator-specified location

##### Operator response

#### 24. Prediction effects

Should V02 predictions affect article approval, filtering, reports, or orchestration, or remain advisory in the first release?

##### Operator response

#### 25. Observation period

Should V02 initially run in a non-destructive observation period before V01 access is hidden?

##### Operator response

#### 26. Future orchestration

Should V02 ever replace the V01 step in a future weekly orchestrator, or remain manually triggered?

##### Operator response

#### 27. V01 removal report

Is a separate pre-implementation V01 removal report still required in addition to this assessment?

##### Operator response

#### 28. Schema deployment

What production schema-deployment method should be used?

- Existing databases are not automatically altered by the normal API startup path.

##### Operator response

#### 29. Production model access

Has `gpt-5.4-mini` been confirmed as available to the production Codex CLI account?

##### Operator response

## Operator comments

The scores should be a new column in the TableReviewArticles. The column should be "ai appover v02" or something with v02 in the names so users know. Teh column should have the prediction and be clickable or "n/a" if no prediction is made.

If a user clicks they will see a modal that has the reason at the top. The bottom will have a section fro the user to validate - so they'll see a question liek "was ai appover correct?" and yes / no radio. if selection is clicked they can undo to not put a response. then they have an option for their comment. both comments and validation are optional - they can enter one or both.
