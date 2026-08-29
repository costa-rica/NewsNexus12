# AI Approver V02

We need to make a new ai approver. The key features:

- add to worker-python, name of this flow should be ai-approver-v02
- scoring is a prediction either `irrelevant` or `approved`.
- use codex cli, model gpt-5.4-mini default, but has .env var to change model
- use a single prompt workflow based on the harness02 (see /Users/nick/Documents/NewsNexus12-ArticleApproverHarness02 on mac workstation)
- create a new database table: suggested table names: AiApproverArticleScoreV02 and AiApproverPromptVersionV02
- hide access to current worker-python's ai-approver flow, add instructions in the AGENTS.md that this is the ai-appover-v01. Rename the /articles/automations page's section for "Weekly Orchestrator" to "Weekly Orchestrator V01" and hide it. Then rename the "AI Approver" section to "AI Approver V01" and hide it. Do not rename any worker-python code on this, we just want to keep terminology clear, when I am making requests so that the ai coding agents know which flow i'm refering to.
- add instruction in AGENTS.md that the new ai approver with predition instead of scoring is ai-appover-v02.
- Make a new table in database to store ai agent prediction, reasoning as well as columns for human_validation (boolean and nullable), human_comment (text and nullable).
- store all documentation that has to do with this new feature or removing old ai approver (i.e. ai-approver-v01) in the docs/ai-appover-v02. When this feature is implemented we'll archive the entire subfolder or create a corresponding archive subfolder.

## How it runs

We will add a section in the /articles/automations page that triggers a request to the api and the api directs the request to the worker-python.

At the default the ai approver v02 flow should work backwards from teh last article added (highest articleId value). The /articles/automations page section should have an input to say how many articles it will analyze. The default analysis flow will got back to the last article with a `ArticleApproveds` table with `isApproved` is true.

### other defaults

- do not anlayze approved articles i.e. artilceIds in ArticleApproved table.
- analzye articles with state assignments from ai state assigner (worker-node) i.e. aricleIds in the ArticleStateContract02 table.

### prompt

Let's make a /articles/automations/ai-approver-v02-prompts page. This page will allow users to create a new prompt and pick the prompt to activate or edit existing prompts. No prompt deletion. But we can edit prompts that have not been run in an analysis. If a run was made using a prompt we want to keep the integrity of the predictions in the AiApproverArticleScoreV02 that are tied to the prompt.

The form should just give an optional prompt title, and prompt.

#### prompt flow features

- I want the artilce title and content injections to occur in the worker-python's script not in the prompt.
- I want the agent's response instructions to be hardcoded in the worker-python's scritp not handled in the prompt our users edit.

## Report: safely remove ai-approver-v01

This is not an action to remove the ai-appover-v01. This is a task to create a document that will be a reference to potentially remove the ai-approver-v01 flow and database table. Create this document before any ai-approver-v02 code is written so that the coding agent will have clearer picture of how to do this cleanly and safely.

### Post ai-appover-v02 report

After implementation of ai-appover-v02 create and updated report specifically aimed and identifying any confusion the new ai approver could have caused and clearing up the process. Do not delete the inital report.

No removal should be implemented. This just reporting in case the operator decides to remove ai-appover-v01 later.

## Questions to Coding Agent

- does the name ai-approver-v02 conflict?
- does assigning a reference name for the old ai approver to ai-approver-v01 pose any issues?
- are there better name to use?
- should ai-approver-v02, have one or multiple database tables? what should they be named?
- do we need another prediction option besides: `irrelevant` or `approved` ?
