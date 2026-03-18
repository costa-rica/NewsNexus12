# PRE_REQUIREMENTS_AI_APPROVER_20260317

1. objective
- Add an AI approval likelihood score for articles under review.
- Estimate likelihood that an article will be approved for a client report submitted to the consumer protection and safety agency.
- Show the score in the `/articles/review` table.
- Base the score on one or more AI agent evaluations stored through the worker-python flow.

2. initial user-facing scope

## 2.1 review table column
- Add a new score column to the review table.
- Display a percent score from `0%` to `100%`.
- Support sorting similar to existing scoring columns.
- Make the score clickable.

## 2.2 score details modal
- Open a modal when the score is clicked.
- Show per-agent scores.
- Show agent reasoning.
- Allow optional human feedback input.
- Question: confirm whether human feedback is per article, per agent score, or per article-agent score record.

## 2.3 automation trigger
- Add an `AI Approver` section to the articles automations page.
- Allow the user to start the scoring flow from the portal.
- Pass run options from portal to API.
- Question: existing route is `/articles/automations`, not `/articles/automation`.

3. scoring model

## 3.1 scoring purpose
- Predict likelihood of final report approval.
- Use a numeric score between `0` and `100`.
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
- Question: current worker patterns use named workflow routes plus shared queue/job status endpoints; confirm if this flow should also be a queued job instead of a direct loop request.

## 4.3 run request body
- Accept `numberOfArticles` or equivalent limit value.
- Accept optional filtering options.
- Default to processing latest eligible articles first.
- Default to requiring an existing AI-assigned state.
- Question: finalize request field names for long-term API stability.

## 4.4 article selection rules
- Start with the highest `articleId` values first.
- Only include articles not yet scored by this AI approver flow.
- Optionally filter to articles with an existing `ArticleStateContract02` row.
- Require `stateId` not null.
- Require `isDeterminedToBeError = 0`.
- Pass this state-filter behavior as a selectable option from the portal.
- Default this state-filter behavior to enabled.
- Question: define whether "not yet scored" means no rows at all or no rows for a specific agent/prompt/version combination.

5. worker-python architecture

## 5.1 module organization
- Add a dedicated worker-python module for the AI approver workflow.
- Keep route handlers thin.
- Keep SQL in repository modules.
- Keep orchestration and processor stages separated.
- Note: this matches the current `worker-python/src/modules/` pattern.

## 5.2 agent organization
- Create a directory for the AI approver workflow.
- Create a separate file per AI agent strategy.
- Keep shared prompt execution, validation, and persistence logic centralized.
- Question: prefer per-agent strategy files inside one workflow module over one top-level module per agent to avoid duplicating load/write pipeline code.

## 5.3 FastAPI considerations
- Define request and response schemas clearly.
- Reuse current worker queue/job status patterns if this becomes a long-running workflow.
- Plan for adding agents without changing the external contract heavily.
- Question: confirm expected response shape for portal polling and modal detail retrieval.

6. database and data model

## 6.1 artificial intelligence records
- Keep each AI agent represented in `ArtificialIntelligences`.
- Continue using the existing AI entity pattern as the system identity for agents.
- Question: confirm whether this flow also needs matching `EntityWhoCategorizedArticles` records like the current scorer/state flows.

## 6.2 prompts table updates
- Add optional `name` column to `Prompts`.
- Add optional `description` column to `Prompts`.
- Use prompts as reusable instructions for AI approver agents.
- Support reassigning prompts to agents.
- Question: `ArtificialIntelligences` already has `name` and `description`; clarify whether prompt `name`/`description` are prompt metadata, agent metadata, or both.

## 6.3 score storage table
- Add a new table tentatively named `ArticlesApproved03`.
- Store `articleId`.
- Store `aiAgentId`.
- Store `promptId`.
- Store AI approval likelihood score.
- Store AI reason text.
- Store `isHumanApproved` as nullable by default.
- Store `reasonHumanRejected`.
- Question: current naming may conflict conceptually with existing `ArticleApproveds` and `ArticlesApproved02`; consider whether a more explicit table name like `ArticleApprovalLikelihoods` would be clearer.

## 6.4 row granularity
- One row should represent one article scored by one AI agent with one prompt.
- Preserve history when prompts or scoring logic change.
- Question: decide whether prompt changes overwrite current mapping only or require versioned prompt history.

7. prompt and agent management

## 7.1 prompt flexibility
- Allow adding new prompts.
- Allow editing existing prompts.
- Allow assigning a prompt to an agent.
- Allow changing the prompt used by an agent over time.

## 7.2 portal management page
- Add a page for viewing AI approver agents and their prompts.
- Allow viewing current prompt text per agent.
- Allow reassigning prompt-to-agent mapping.
- Allow creating and editing prompts.

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
- Note: current automations page already uses per-workflow sections, so this fits existing UI structure.

## 8.3 configuration page changes
- Add UI for prompt visibility and reassignment.
- Add UI for AI approver agent list.
- Add UI for future agent expansion.

9. open questions and risks
- Confirm final worker endpoint naming and whether it should live under an analysis namespace.
- Confirm whether approval scores should be recalculated or stored as historical snapshots.
- Confirm whether one article can show a single aggregate score, a primary agent score, or a multi-agent aggregate in the review table.
- Confirm how human approval and rejection feedback should affect later rescoring.
- Confirm whether the first release needs only manual run support or also scheduled automation support.
- Note: existing worker and portal job flows are queue-based, so consistency with queue status/polling likely matters.

10. first implementation target
- Build the end-to-end flow with one agent: `Residential House Fire`.
- Support manual launch from the portal automations page.
- Store one score and one reason per eligible article.
- Show the score on `/articles/review`.
- Open a modal with score detail and optional human feedback.
