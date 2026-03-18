# AI Approver Feature — Feasibility Assessment & Feedback

## Context

You're proposing a new "AI Approval Likelihood" scoring system that predicts whether an article will be approved for the CPSC client report. The flow is: Portal automation trigger → API → worker-python → LLM agents score articles → results stored in new DB table → displayed in the review table with a clickable modal. First agent: "Residential House Fire", next: "ATV Accident", with architecture to support more.

---

## 1. Overall Feasibility

**Verdict: Feasible, but scope is large.** This touches all 4 apps (portal, api, worker-python, db-models) and introduces a new capability (LLM-based scoring) to worker-python which currently only does classification and deduplication — not LLM prompting. The end-to-end flow is well-understood from existing patterns (state assigner, semantic scorer), so the plumbing is proven. The risk is in scope creep: the prompt management UI alone is a significant sub-feature.

**Realistic scope for a first release:**
- DB schema changes + new model
- Worker-python endpoint + single agent scoring loop
- API proxy endpoint + automation section in portal
- Review table column + modal
- **Defer:** Prompt management UI, prompt reassignment, agent configuration page

---

## 2. Architecture Feedback

### Module organization in worker-python

Your suggestion of a directory per workflow with a file per agent is sound. I'd recommend:

```
worker-python/src/modules/ai_approver/
  __init__.py
  config.py              # env validation, constants
  processor.py           # orchestration: load → score → write loop
  repository.py          # all SQL queries
  strategies/
    __init__.py
    base.py              # abstract base class for agent strategies
    residential_fire.py  # Residential House Fire agent
    atv_accident.py      # (future) ATV Accident agent
```

**Why this over one file per agent at the module root:** The scoring loop (load articles, call LLM, parse response, write to DB) is the same for every agent. Only the prompt and possibly some response parsing differ. A strategy pattern with a shared `processor.py` orchestrator avoids duplicating the load/score/write pipeline in every agent file. Each agent file just defines its prompt template and any agent-specific response parsing.

This matches the existing `location_scorer/` pattern where stages are separated from orchestration.

### Queue vs synchronous loop

**Use the existing queue/job pattern.** Your PRD already asks this question. The answer is clear: LLM scoring of N articles is a long-running operation (potentially minutes to hours). The existing queue pattern with cooperative cancellation, status polling, and job persistence is exactly right. Don't make this a synchronous request — the HTTP request would time out.

---

## 3. Database Design — Issues to Address

### 3a. Table naming: `ArticlesApproved03`

The PRD already flags this. I agree: `ArticlesApproved03` is confusing given existing tables `ArticleApproveds` and `ArticlesApproved02` which serve different purposes. **Recommendation: `ArticleApprovalScores` or `ArticleApprovalLikelihoods`** — makes the purpose immediately clear.

### 3b. `aiAgentId` column — which table does it reference?

Your description says `aiAgentId` referencing `ArtificialIntelligences.id`. But the existing pattern uses `EntityWhoCategorizedArticle` as an intermediary:

```
ArtificialIntelligences → EntityWhoCategorizedArticle → (used as entityWhoCategorizesId in scoring tables)
```

`ArticleStateContract02` stores `entityWhoCategorizesId`, not a direct `artificialIntelligenceId`. The `ArticleEntityWhoCategorizedArticleContract` table also uses `entityWhoCategorizesId`.

**You have two options:**
1. **Follow existing pattern** — use `entityWhoCategorizesId` referencing `EntityWhoCategorizedArticle`. Consistent but adds a join to get the AI name.
2. **Simplify** — use `artificialIntelligenceId` directly. Cleaner for this table but breaks the convention used everywhere else.

**My recommendation:** Follow the existing pattern for consistency. You'll need an `EntityWhoCategorizedArticle` row per AI approver agent anyway (e.g., one for "Residential House Fire"). This is a small cost for keeping the data model consistent.

### 3c. Adding `name` and `description` to `Prompts`

This makes sense. The `ArtificialIntelligences` table has `name`/`description` for the *agent*, while `Prompts.name`/`description` would describe the *prompt itself* (e.g., name: "Residential Fire v2", description: "Scores articles for residential house fire incidents, with emphasis on injury and fatality reporting"). These are conceptually different — an agent can switch prompts over time, and a prompt could theoretically be reused across agents.

**One concern:** You'll need a migration to add these columns. Since this is SQLite and you're using Sequelize, make sure the migration adds them as nullable columns (which you already planned — "optional").

### 3d. Score format: 0-100 integer vs 0.0-1.0 float

Existing scoring patterns in the codebase use 0.0-1.0 floats:
- `ArticleEntityWhoCategorizedArticleContract.keywordRating` is FLOAT 0-1
- Location classifier scores are also 0-1

**Your description says 0-100%.** This is fine for display, but I'd recommend storing as a FLOAT 0.0-1.0 in the database for consistency, then multiplying by 100 for display. This avoids the question of whether 85 means 85% or 0.85 later.

### 3e. Unique constraints

You need a unique constraint to prevent duplicate scores. The natural key is `(articleId, entityWhoCategorizesId, promptId)` — matching the pattern in `ArticleStateContract02`. This means: one score per article per agent per prompt. If you re-score with the same prompt, it overwrites. If you change the prompt, a new row is created, preserving history.

**Important question you should decide:** When re-running the scoring loop, should it:
- **Upsert** (update existing row if same article+agent+prompt)? Simpler, but loses the old score.
- **Append** (always insert, creating history)? More complex queries to get "latest" score, but full audit trail.

The `ArticleStateContract02` table uses a unique constraint and effectively upserts. I'd recommend the same approach for simplicity.

### 3f. `isHumanApproved` and `reasonHumanRejected`

Good design. The nullable boolean (null = not reviewed, true = approved, false = rejected) with an optional rejection reason mirrors the `ArticleStateContract02.isHumanApproved` pattern. Just make sure `reasonHumanRejected` is TEXT not STRING (STRING in Sequelize/SQLite defaults to VARCHAR(255) which may be too short for feedback).

---

## 4. Prompt Management — Historical Integrity

You want prompts to be reassignable: change which prompt an agent uses over time. Since `promptId` is stored per score row, the historical record is preserved — you can always see which prompt produced which score. **This is well-designed.**

However, consider these implications:
- **Editing a prompt in place** (changing `promptInMarkdown` for an existing `promptId`) destroys history. Old scores point to the same promptId but the prompt text has changed. **Recommendation:** Treat prompts as immutable once used. When you want to modify a prompt, create a new one and reassign. Your UI should guide users toward "create new version" rather than "edit in place."
- **You need a linking table or column** to know which prompt is *currently assigned* to an agent. Right now there's nothing connecting `ArtificialIntelligences` to `Prompts`. You could add a `currentPromptId` column to `ArtificialIntelligences`, or create a small `AiAgentPromptAssignments` table. The simpler approach (column on `ArtificialIntelligences`) works for now.

---

## 5. Worker-Python — Critical Considerations

### 5a. LLM API integration — this is new ground for worker-python

**This is the biggest technical consideration.** Worker-python currently uses:
- HuggingFace transformers for classification (location scorer)
- Content hashing and embedding for deduplication

It does **not** currently make LLM API calls (OpenAI, Anthropic, etc.). The state assigner, which does use OpenAI, lives in **worker-node**, not worker-python.

**You need to decide:**
1. Which LLM provider? OpenAI (matching worker-node precedent)? Anthropic?
2. Add the SDK dependency to worker-python's requirements
3. Add API key environment variables
4. Handle authentication, rate limiting, retries

This is achievable but it's a meaningful addition to worker-python's capabilities.

### 5b. Cost and rate limiting

If you have 500 articles to score and each requires an LLM call with the full article text:
- At ~1000 input tokens + ~200 output tokens per article
- GPT-4o: ~$0.003/article → $1.50 for 500 articles (manageable)
- GPT-4: ~$0.04/article → $20 for 500 articles
- Claude Sonnet: ~$0.004/article → $2.00 for 500 articles

**Considerations:**
- Batch size and rate limiting (OpenAI has TPM/RPM limits)
- Add a delay between calls or use batching
- Log token usage and cost estimates in the job status
- Consider a configurable max articles per run (your `numberOfArticles` parameter handles this)

### 5c. Error handling mid-batch

What happens when the LLM API fails on article #47 of 200?
- **Recommendation:** Write results to DB after each successful scoring (not all at once at the end). This way partial progress is preserved. The queue job status should report "scored 46/200, failed on article #47, continuing..." and either skip failures or retry with backoff.
- The existing location scorer pattern (load → classify → write stages) could be adapted: load articles, then score one-by-one with per-article DB writes.

### 5d. SQLite concurrency

SQLite has a single-writer limitation. A long-running scoring loop writing one row at a time should be fine (each write is fast), but be careful about:
- Not holding transactions open for the entire batch
- Using WAL mode (if not already configured) for better concurrent read/write
- Not conflicting with other worker processes writing simultaneously

---

## 6. Portal/UX Considerations

### 6a. Single column vs multi-agent display

When you have one agent (Residential House Fire), the review table column is straightforward: show that score. But when you add ATV Accident agent:
- **Do you show one column per agent?** Gets wide fast.
- **Do you show an aggregate score?** What's the aggregation logic? Average? Weighted? Max?
- **Do you show the highest-scoring agent?** (Most likely to be approved for that category)

**My recommendation for the review table column:** Show a single **aggregate score** (initially just the one agent's score, later an average or weighted score across agents). The modal shows the per-agent breakdown. This keeps the table clean and the modal informative.

**Important conceptual question (see section 7 below):** The agents are category-specific (house fires, ATV accidents). Does every article get scored by every agent, or only by the relevant agent? This fundamentally changes the aggregation.

### 6b. Prompt management UI — defer this

The prompt management page (view prompts, reassign, edit, create) is a significant sub-feature. For v1:
- Store the prompt in the `Prompts` table
- Hardcode the prompt-to-agent assignment (or use a column on `ArtificialIntelligences`)
- Build the management UI in a later phase

### 6c. Navigation placement

**Recommendation:**
- **Automation trigger:** Add "AI Approver" section to existing `Articles > Automations` page (consistent with other automations)
- **Management page (later):** Add under `Analysis` as "AI Approver Config" or similar. This keeps run controls under Articles and configuration under Analysis, matching the existing split where Analysis already houses "AI State Assigner"

---

## 7. Issues You May Not Have Considered

### 7a. Agent specificity vs article generality — the fundamental design question

This is the most important issue. Your agents are **category-specific**: "Residential House Fire" and "ATV Accident" are specific incident types. But articles in the system span many categories.

**The question:** When you run the AI Approver loop, does the "Residential House Fire" agent score *all* articles, or only articles that are about residential house fires?

- **If all articles:** Most articles will score 0-5% (they're not about house fires). This is noise. The score is less "likelihood of approval" and more "likelihood of being a house fire article."
- **If only relevant articles:** You need a pre-filtering step to determine which agent applies to which article. The existing state assignment (from `ArticleStateContract02`) could serve this purpose — the assigned state tells you the incident category, which maps to the right agent.

**This needs to be resolved before implementation.** It affects:
- The scoring loop logic (all agents per article, or route articles to the right agent)
- The aggregate score calculation
- What the score means in the review table
- The prompt design

### 7b. What happens when a new agent is added?

When you add the "ATV Accident" agent, do existing articles need to be scored by it? If the review table shows an aggregate, articles scored by only one agent will have incomplete aggregates. **Recommendation:** The aggregate should be calculated only over agents that have scored the article, and the modal should clearly show which agents have/haven't scored it.

### 7c. Prompt design for the Residential House Fire agent

The prompt needs to be very specific about what "likely to be approved" means. It should include:
- What the CPSC report is
- What criteria make an article approvable
- What a "residential house fire" article looks like for this context
- Examples of approved vs rejected articles (few-shot)
- Instructions for the scoring scale and response format (structured JSON output)

I can help you draft this prompt once the architecture is settled.

### 7d. EntityWhoCategorizedArticle records

The existing pattern requires each AI agent to have a matching `EntityWhoCategorizedArticle` record. Your plan mentions adding to `ArtificialIntelligences` but doesn't mention this linking table. **You'll need to create these records** either via migration or at runtime.

### 7e. Response format and parsing

The LLM needs to return structured data (score + reason). You should use structured output / JSON mode to avoid parsing failures. Define a clear response schema:
```json
{"score": 0.85, "reason": "Article describes a residential house fire with injury details..."}
```

### 7f. Article content availability

The `Articles` table has `title`, `description`, `url`, `urlToImage`, `publishedDate`. It does **not** appear to have a `content` or `body` field with the full article text. If the LLM needs to score based on full article content, where does that come from? The semantic scorer uses title+description, which may be sufficient, but the approval likelihood may need more context. **Verify what content is available for the LLM to analyze.**

---

## 8. Phasing Recommendations

### Phase 1 — MVP (build this first)
1. **DB:** Add `name` (nullable) and `description` (nullable) columns to `Prompts` table
2. **DB:** Create `ArticleApprovalScores` table (articleId, entityWhoCategorizesId, promptId, score FLOAT, reasoning TEXT, isHumanApproved BOOLEAN nullable, reasonHumanRejected TEXT nullable, timestamps)
3. **DB:** Create Sequelize model for new table
4. **DB:** Seed: new `ArtificialIntelligences` row for "Residential House Fire" agent, corresponding `EntityWhoCategorizedArticle` row, initial prompt in `Prompts`
5. **Worker-python:** Add LLM API client (OpenAI SDK or httpx)
6. **Worker-python:** New module `ai_approver/` with processor, repository, and residential fire strategy
7. **Worker-python:** New route `ai-article-approver/start-job` using existing queue pattern
8. **API:** New proxy endpoint under `/automations/ai-approver/start-job`
9. **Portal:** New `AiApproverSection` on automations page
10. **Portal:** New column in review table + `ModalAiApproverDetails` modal
11. **API:** New endpoint to fetch approval scores (for review table data)
12. **API:** New endpoint for human approve/reject on approval scores

### Phase 2 — Second agent + refinement
- Add "ATV Accident" agent strategy
- Implement aggregate scoring logic for the review table
- Refine filtering options based on Phase 1 learnings

### Phase 3 — Prompt management
- Prompt management UI page
- View/edit/create prompts
- Assign prompts to agents
- Navigation sidebar entry

---

## Summary of Key Recommendations

| Topic | Recommendation |
|-------|---------------|
| Table name | `ArticleApprovalScores` not `ArticlesApproved03` |
| Score storage | FLOAT 0.0-1.0 (display as %) for consistency |
| Agent ID pattern | Use `entityWhoCategorizesId` (existing pattern) |
| Module structure | Strategy pattern with shared orchestrator |
| Queue | Use existing queue/job pattern (not synchronous) |
| Prompts | Treat as immutable once used; create new versions |
| Review column | Single aggregate score; per-agent detail in modal |
| Prompt management UI | Defer to Phase 3 |
| Agent-article routing | Resolve whether all agents score all articles or agents are routed by category |
| LLM in worker-python | New capability; choose provider, add SDK, handle rate limits |
