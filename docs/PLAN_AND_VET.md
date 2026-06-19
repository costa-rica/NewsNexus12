---
created_at: 2026-06-15
updated_at: 2026-06-15
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# Plan and Vet

## Overview

This workflow coordinates two AI agents that vet a plan against a project before any code is written. The **operator** is whoever oversees and directs this loop — the one who decides when to advance, re-write, reassign roles, or begin implementation. By default the operator is the human requesting the work (the person who writes the requirements), but the human may delegate this overseeing role to an agent such as Hermes. The workflow begins when the operator creates, or relays, a feature requirement or product requirements document.

Two roles drive the workflow: a **planner agent** and an **assessing agent**. The planner agent writes a plan as described in the [[#Plan]] section. Once the plan is finished, the assessing agent reviews it.

These roles carry through the entire workflow by default: the planner agent is also the **todo creator**, and the assessing agent assesses both the plan and the todo. So if the operator simply asks an agent to continue with the todo, the planner agent knows it is the default todo creator and the assessing agent knows it is the default assessor. The operator may reassign these roles at any time.

If the assessing agent writes an assessment, the planner agent reviews it and decides whether the concerns warrant a re-write. If so, the planner agent produces a "v02" of the plan, and the assessing agent reviews the v02 under the same conditions.

This pattern repeats until the assessing agent has no concerns that meet the criteria. By default the loop is capped at **10 versions**: if the plan reaches v10 and the assessing agent still finds qualifying concerns, the loop stops and the agent waits for the operator's instructions. The operator may set this maximum higher or lower.

Once there are no qualifying concerns, the assessing agent determines whether the plan is clear enough that an implementing agent can implement the requirements without a task style todo list. A todo list is unnecessary only when the plan ultimately requires a trivial change — for example renaming a variable, or adding roughly five lines of code or fewer. Anything larger or multi-step should go through the todo phase.

If a todo list is not needed, the operator can direct an agent to begin implementation.

Otherwise, the todo creator — the planner agent by default — takes the latest version of the plan and creates a task style todo list with phases, as described in the [[#Todo]] section. The assessing agent then vets that todo list through the same loop used for the plan, as described in the [[#Todo Assessment]] section. Once the todo list has no qualifying concerns, the operator can direct an agent to begin implementation.

## File location and versioning

All plan, todo, and assessment files are written to the repository's root-level `docs/` directory by default.

Agents never overwrite an existing file. The `_v##` naming convention exists precisely so that each step writes a **new** file — a new plan version, a new todo version, or a new assessment is always a separate file (for example, assessing v02 of a plan produces a new `..._plan_v02_assessment_{agent}.md`, leaving the v01 assessment untouched). An agent should only modify an existing file when the operator explicitly directs it to.

All generated plan, todo, and assessment filenames must use lowercase alphabetic components. Agents should use lowercase for descriptive names, file type labels, version labels, assessment labels, and agent names.

## Plan

This plan is not a task list. It is the overview of technology used, a general flow and key functions that a feature that the operator has requested. If the requirements are large, then the plan should have sections for components of the implementation. If the requirements are so large that it would make sense to have separate plans for separate requirements or if when building requirements it finds that the scope of the requirements are larger than the operator realized then planning agent should suggest to the operator making multiple plan files or restructuring the requirements.

### Plan filename convention

The plan file should be named `YYYYMMDD_` +`{descriptive_name}`+`_plan_v01.md`. Where:

- YYYYMMDD is the current date
- descriptive_name is a descriptive name in lowercase less than 30 characters, underscores instead of spaces.
- increment only the version number with each version, for example `plan_v02`, `plan_v03`, while keeping the label lowercase
- If this is the first set of requirements for the project use the project repo name. If the project is a monorepo with the sub apps include the sub app folder name.

Some examples of plan name:

- 20260529_golightly04_api_plan_v01.md
  - where the monorepo's name is GoLightly04 and this is the plan for the api in the monorepo
- 20260522_portal_lint_plan_v02.md
- 20260528_resume_download_via_api_plan_v01.md

## Plan Assessment

The plan assessment is looking for the feasibility of successfully achieving the operators desired goal of implementing the requirements. This assessment should only be written if the assessing agent finds

- the plan poses risks to existing functionality
- the plan's approach to implement is infeasible or a misunderstanding of technology
- the plan will not work
- the plan restructures contrary to the initial design or architecture
- the plan implements functionality that already exists or creates redundant functionality
- the plan includes a poor naming convention - whether by a naming pattern contrary to existing variable names or variable names that are unclear

### Plan Assessment filename convention

The plan assessment file should be named `{plan_filename}` + `_assessment_` + `{agent_name}.md` . Where:

- plan_filename is the original name (without the extension)
- agent name will be short name in lowercase, for example: claude code should write `claude`

Some examples of plan assessment names:

- 20260522_portal_lint_plan_v02_assessment_claude.md
- 20260528_resume_download_via_api_plan_v01_assessment_codex.md

## Todo

The todo file will be a checklist style task list where tasks are grouped into phases.

The todo list phases will instruct the agent what tasks it needs to do to implement aspects of the feature.
At the end of each phase the implementing agent will be instructed to do the following (if there is infrastructure for these tests):

1. run any type or lint checks
2. run tests
3. attempt to build

If any tests fail the agent should go back to fix the code so that the functionality remains and the tests pass. After testing passes, the agent should checkoff all completed tasks and commit all changes related to the tasks completed.

### Todo filename convention

The todo file should be named `YYYYMMDD_` +`{descriptive_name}`+`_todo_v01.md`. Where:

- YYYYMMDD is the current date
- descriptive_name is a descriptive name in lowercase less than 30 characters, underscores instead of spaces.
- increment only the version number with each version, for example `todo_v02`, `todo_v03`, while keeping the label lowercase
- If this is the first set of requirements for the project use the project repo name. If the project is a monorepo with the sub apps include the sub app folder name.

Some examples of todo names:

- 20260529_golightly04_api_todo_v01.md
  - where the monorepo's name is GoLightly04 and this is the plan for the api in the monorepo
- 20260522_portal_lint_todo_v02.md
- 20260528_resume_download_via_api_todo_v01.md

## Todo Assessment

The todo assessment is looking for the feasibility of successfully achieving the operators desired goal of implementing the requirements. This assessment should only be written if the assessing agent finds:

- the tasks do not align with the plan
- an implementing agent would be confused or a task leaves too much ambiguity
- a task will break existing code
- or any other concern that risk successful implementation

This works the same way as the plan / plan-assessment loop. If the assessing agent writes an assessment, the todo creator reviews it and decides whether the concerns warrant a re-write. If so, the todo creator produces a "v02" of the todo, which the assessing agent reviews under the same conditions. This pattern continues until the assessing agent has no qualifying concerns. By default the loop is capped at **10 versions**: if the todo reaches v10 and the assessing agent still finds qualifying concerns, the loop stops and the agent waits for the operator's instructions. The operator may set this maximum higher or lower.

### Todo Assessment filename convention

The assessment file should be named `{todo_filename}` + `_assessment_` + `{agent_name}.md` . Where:

- todo_filename is the original name (without the extension)
- agent name will be short name in lowercase, for example: claude code should write `claude`

Some examples of todo assessment names:

- 20260522_portal_lint_todo_v02_assessment_claude.md
- 20260528_resume_download_via_api_todo_v01_assessment_codex.md
