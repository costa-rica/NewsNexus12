---
created_at: 2026-07-23
created_by: claude (claude-fable-5)
---

# AI Approver V02 Claude Assessment

## Complexity and feasibility (30 words)

Feasible with existing architecture. Medium-high complexity: touches db-models, worker-python, api, portal, and deployment. Harness02 already proves the core classifier. Main risks are selection-boundary logic and V01 isolation side effects.

## Remaining questions Codex did not ask

Codex's 29 operator questions cover most ambiguity. These gaps remain:

### 1. Concurrent runs

Should the portal or worker block a second V02 run while one is active, or queue it? Double-clicking the trigger could duplicate work.

#### Operator response

No only allow one run of V02 at a time. Block from the portal's automations page and from worker-python.

### 2. Run progress and cancel

How does the automations page show progress and completion — polling a status endpoint, or fire-and-forget? Is a cancel button needed in release one?

#### Operator response

Let's use the same refresh or polling feature we have in teh current ai-approver-v01. there is an icon the user can click ot refresh the status.

### 3. Harness02 porting

Harness02 is a separate repository on the workstation. Should its code be copied into worker-python, or only its prompt and parsing logic re-implemented?

#### Operator response

The harness02 is only a reference. do not copy entire folder or groups of files. However, during imlemetnation code can be copied.

### 4. Article-count guardrail

Should the article-count input have a maximum, given each article is one Codex CLI call with real cost and runtime?

#### Operator response

No the defaults are enough, but if the codex response is an error we shoudl have a protection to stop after 3 errors in a row. Or 5 non-useful predictions.

### 5. Duplicate predictions

Is one prediction per article per prompt version enforced with a unique constraint, or are repeat runs of the same pair allowed?

#### Operator response

Enforce unqiue constraint on one prediction per article per prompt version. For now let's make it if an article id has been analyzed by V02 once it will not be analyzed again. This brings up a good question. If a run has been started but then stops before the total set of articles is analyzed or the last articleId is run then the ai-appover-v02 flow will prevent us from going back. I think when the run is triggered there shoudl be a modal that says two options (radio buttons): 1)run n articles count with an input that allows the user to enter a count of articles to go backwards, 2)run until last articledId report (include the number of articles),
