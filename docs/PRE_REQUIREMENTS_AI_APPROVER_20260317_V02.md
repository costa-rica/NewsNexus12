# PRE_REQUIREMENTS_AI_APPROVER_20260317_V02

1. objective
- Add an AI approval likelihood score for articles under review.
- Estimate likelihood that an article will be approved for a client report submitted to the consumer protection and safety agency.
- Show the score in the `/articles/review` table.
- Base the score on one or more AI agent evaluations stored through the worker-python flow.

2. initial user-facing scope

## 2.1 review table column
- Add a new score column to the review table.
- Display the highest AI approver score for each `articleId`.
- Store scores as `FLOAT` values from `0.0` to `1.0`.
- Convert score display to percent-style UI only if needed in the frontend.
- Support sorting similar to existing scoring columns.
- Make the score clickable.

## 2.2 score details modal
- Open a modal when the score is clicked.
- Show per-agent scores.
- Show agent reasoning.
- Allow optional human feedback input.
- Show all stored agent rows for the selected `articleId`.

## 2.3 automation trigger
- Add an `AI Approver` section to the articles automations page.
- Allow the user to start the scoring flow from the portal.
- Pass run options from portal to API.
- Question: existing route is `/articles/automations`, not `/articles/automation`.

3. scoring model

## 3.1 scoring purpose
- Predict likelihood of final report approval.
- Use a `FLOAT` score between `0.0` and `1.0`.
- Keep the first version simple with one agent.

## 3.2 initial agent
- Start with one agent: `Residential House Fire`.
- Have the agent return a score and concise reason.
- Use this as the pilot for the end-to-end flow.

## 3.3 next planned agent
- Prepare for a second agent: `ATV Accident`.
- Keep architecture flexible for additional agents later.

4. workflow and orchestration

## 4.1 high-level flow
- Portal automation section starts the run.
- API acts as gatekeeper to worker-python.
- Worker-python runs the AI article approver loop.
- Persist scores and related metadata to the database.

## 4.2 proposed API and worker endpoint
- Add an API route that proxies to worker-python.
- Add a worker-python endpoint named `ai-article-approver`.
- Design the endpoint to support multiple agents.
- Design the endpoint to support future filter options.
- Question: current worker patterns use named workflow routes plus shared queue/job status endpoints; confirm if this flow should also be a queued job.

## 4.3 run request body
- Accept a limit value for article count.
- Accept optional filtering options.
- Default to processing latest eligible articles first.
- Default to requiring an existing AI-assigned state.
- Allow the request body to specify whether `ArticleStateContract02` filtering is applied.

## 4.4 article selection rules
- Start with the highest `articleId` values first.
- Only include articles with no existing row in `AiApproverArticleScores`.
- Optionally filter to articles with an existing `ArticleStateContract02` row.
- Require `stateId` not null.
- Require `isDeterminedToBeError = 0`.
- Pass this state-filter behavior as a selectable option from the portal.
- Default this state-filter behavior to enabled.
- Note: v1 skips any article once at least one `AiApproverArticleScores` row exists for that `articleId`.

## 4.5 agent execution order
- Run all AI approver agents for each selected article.
- Run agents sequentially, one at a time, per article.
- Start the next agent only after the previous agent result is written or marked invalid.
- Require each agent response to return structured JSON for database persistence.
- Store one row per `articleId` per agent in `AiApproverArticleScores`.
- Note: one article can have multiple score rows when multiple agents exist.
- Treat invalid agent output as a completed attempt with status and error metadata.

5. worker-python architecture

## 5.1 module organization
- Add a dedicated worker-python module for the AI approver workflow.
- Keep route handlers thin.
- Keep SQL in repository modules.
- Keep orchestration and processor stages separated.
- Note: this matches the current `worker-python/src/modules/` pattern.

## 5.2 agent organization
- Create one AI approver workflow module.
- Create a separate file per agent strategy inside that workflow.
- Keep shared loading, prompt lookup, scoring, and persistence logic centralized.
- Recommendation keyword: strategy-based agent files inside one workflow module.

## 5.3 run behavior
- Resolve the current active prompt for each selected agent.
- Score each eligible article with all active AI approver agents.
- Apply filtering functions before the scoring loop begins.
- Skip any article that already has at least one row in `AiApproverArticleScores`.
- Run agents sequentially per article.
- Use the same OpenAI model currently used by the worker-node AI state assigner for v1.
- Persist score rows with the exact prompt version used.
- Persist an explicit result status for every agent attempt.
- Persist invalid agent responses as completed attempts with error metadata, not as unscored gaps.
- Return job status suitable for portal polling.

6. database and data model

## 6.1 design goals
- Separate agent identity from prompt history.
- Preserve the exact prompt version used for each score.
- Keep current prompt lookup simple.
- Keep historical audits and rescoring traceable.
- Reduce ambiguity between prediction tables and final approval tables.

## 6.2 AI approver agents table
- Add table: `AiApproverAgents`.
- One row per logical AI approver agent.
- Examples: `Residential House Fire`, `ATV Accident`.
- Suggested fields:
  - `id`
  - `key`
  - `name`
  - `description`
  - `modelProvider`
  - `modelName`
  - `artificialIntelligenceId` nullable or required depending on integration choice
  - `isActive`
- Purpose:
  - stable identity for each approver agent
  - decouple agent identity from prompt text
  - store the default LLM provider and model for the agent
  - simplify agent list queries in portal and worker
- Question: decide whether `AiApproverAgents` replaces or references `ArtificialIntelligences` for this flow.

## 6.3 AI approver prompt versions table
- Add table: `AiApproverPromptVersions`.
- One row per saved prompt version for one agent.
- Do not overwrite old prompt text.
- Suggested fields:
  - `id`
  - `agentId`
  - `version`
  - `name` nullable
  - `description` nullable
  - `promptInMarkdown`
  - `isActive`
  - `endedAt` nullable
- Purpose:
  - track prompt history per agent
  - identify the current prompt with `isActive = true`
  - archive old prompts without deletion using `endedAt`
- Rule:
  - only one active prompt version per agent

## 6.4 AI approver article scores table
- Add table: `AiApproverArticleScores`.
- One row per article scored by one agent using one prompt version.
- Suggested fields:
  - `id`
  - `articleId`
  - `agentId`
  - `promptVersionId`
  - `resultStatus`
  - `score`
  - `reason`
  - `errorCode` nullable
  - `errorMessage` nullable
  - `isHumanApproved` nullable
  - `reasonHumanRejected` nullable
  - `runKey` or `jobId` nullable
- Purpose:
  - keep score history
  - preserve exact prompt traceability
  - support modal detail by agent
  - avoid confusion with final approval tables
  - track completed, invalid, and failed agent attempts explicitly
- Rule:
  - one `articleId` can have multiple rows when multiple agents exist
  - v1 filtering skips articles after the first existing score row is found

## 6.5 result status behavior
- Store an explicit status for each agent attempt.
- Suggested statuses:
  - `completed`
  - `invalid_response`
  - `failed`
- `completed` means a valid structured result was returned and stored.
- `invalid_response` means the agent responded but the payload could not be accepted as valid scoring output.
- `failed` means the attempt did not complete successfully due to execution or provider error.
- Invalid and failed attempts still count as existing rows for v1 article filtering.

## 6.6 current prompt lookup
- Worker finds the active prompt from `AiApproverPromptVersions`.
- Query by `agentId` and `isActive = true`.
- Archived prompts remain queryable through historical score rows.
- `promptVersionId` on score rows is the main historical link.

## 6.7 prompt reassignment behavior
- Changing an agent prompt creates a new prompt version row.
- New prompt version becomes `isActive = true`.
- Previous active row becomes `isActive = false`.
- Previous active row gets `endedAt` set.
- Existing score rows do not change.

## 6.8 indexing and query shape
- Index `AiApproverPromptVersions` on `agentId`, `isActive`.
- Index `AiApproverArticleScores` on `articleId`, `agentId`.
- Index `AiApproverArticleScores` on `promptVersionId`.
- Index `AiApproverArticleScores` on `resultStatus`.
- Consider index on `AiApproverArticleScores` for `jobId` or `runKey`.
- Goal: fast lookup for latest article score display and modal breakdown queries.

## 6.9 relationship to existing tables
- Keep each AI approver agent aligned with the broader AI identity model in the system.
- Preserve optional linkage to `ArtificialIntelligences`.
- Avoid storing these score rows in `ArticleApproveds` or `ArticlesApproved02`.
- Note: this flow is prediction/scoring, not final approval.

7. prompt and agent management

## 7.1 prompt flexibility
- Allow adding new prompts.
- Allow editing by creating new prompt versions.
- Allow activating a new prompt version per agent.
- Allow viewing archived prompt versions.

## 7.2 portal management page
- Add a page for viewing AI approver agents and their prompts.
- Allow viewing current prompt text per agent.
- Allow creating a new prompt version.
- Allow changing which prompt version is active.
- Hardcode allowed model-name options in the frontend for now.
- Start with a single allowed model option matching the worker-node AI state assigner model.

## 7.3 suggested portal location
- Option A: new item under `Analysis` for AI approver management.
- Option B: new item under `Articles` near `Automations`.
- Option C: keep trigger in `Articles > Automations` and add management under `Analysis`.
- Recommendation keyword: split run controls and configuration pages.

8. portal integration details

## 8.1 review page changes
- Add a new approval likelihood column to the articles review table.
- Add sortable score rendering.
- Add click behavior to open modal details.
- Show agent breakdown and human input in the modal.

## 8.2 automations page changes
- Add an `AI Approver` section to the existing automations page.
- Allow starting a run with configurable article count.
- Allow optional filter selections.
- Show job/run status.

## 8.3 configuration page changes
- Add UI for AI approver agent list.
- Add UI for current and archived prompt versions.
- Add UI for activating a new prompt version.

9. open questions and risks
- Confirm whether the review table should show one agent score or an aggregate score later.
- Confirm whether rescoring should create new score history rows every time.
- Confirm whether `AiApproverAgents` should reference `ArtificialIntelligences` or replace that role for this feature.
- Confirm final worker endpoint naming and queue behavior.
- Confirm whether human feedback should affect later scoring logic or remain audit-only.

10. first implementation target
- Build the end-to-end flow with one agent: `Residential House Fire`.
- Support manual launch from the portal automations page.
- Store one score and one reason per eligible article.
- Store one active prompt version for that agent.
- Show the score on `/articles/review`.
- Open a modal with score detail and optional human feedback.
