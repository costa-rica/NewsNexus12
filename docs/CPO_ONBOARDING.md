---
date: 2026-05-02
origin: Hermes Agent on nws-nn12dev
sources:
  - /home/nick/CPSC_Project/CPSC___News_Clip_Collection_Project_.pdf
  - /home/nick/NickVault/Notes/NewsNexus/20260427_NEWS_NEXUS_12_CTO_ONBOARDING.md
  - /home/nick/NickVault/Projects/AgentSkills/CPO_ONBOARDING_PROMPT.md
  - /home/nick/NickVault/Projects/NewsNexus/202605-NewsNexusQuestions.md
---

# CPO Onboarding — NewsNexus12

## 1. One-paragraph summary

NewsNexus12 is the product platform Nick built to help Kinetic Metrics deliver consumer-product-related news clip collection, tracking, review, and reporting services for the Consumer Product Safety Commission's Division of Hazard & Injury Data Systems (from Nick's context; from the SoW). It finds news articles about injuries, deaths, and hazardous incidents involving consumer products across the United States; stores and enriches them; helps humans decide what is in scope; and supports CPSC-facing clip/report delivery (from the SoW; CTO_ONBOARDING.md §1, §4). The bet is that a purpose-built database and workflow system can make a contractually constrained clipping operation more complete, auditable, and scalable than ad hoc search, spreadsheets, email, and manual PDF handling (inferred from the SoW and CTO doc).

## 2. The problem

CPSC must collect, investigate, analyze, and disseminate injury data related to deaths, injuries, and illnesses associated with consumer products (from the SoW). Timely news clips support emerging hazard identification, remedial strategy analysis, regulatory development, public inquiries, compliance, and hazard reduction (from the SoW).

The task is operationally hard: relevant incidents appear across daily, Sunday, and weekly newspapers in all 50 states plus D.C.; the incident state may differ from the publication state; duplicates appear across sources; and many similar stories are outside CPSC jurisdiction (from the SoW). Deliverables must be weekly, electronic, in PDF and Excel formats; each qualifying clip must identify consumer product, hazard pattern, state, date, injury severity, place, and person; incidents must generally be 180 days old or newer; and rejected clips return with feedback (from the SoW). Without a dedicated product, the team risks missed coverage, out-of-scope submissions, duplicates, late delivery, weak auditability, and end-of-year catch-up behavior the SoW rejects.

## 3. The customer or user

- **Ultimate client: CPSC Division of Hazard & Injury Data Systems.** Needs timely, comprehensive, jurisdictionally valid clip data for internal databases and downstream analysis. Cares about coverage, timeliness, accuracy, clarity, consistency with requirements, and usability for possible FOIA-related public disclosure (from the SoW).
- **Contract holder / delivery partner: Kinetic Metrics.** Run by Emily and Mark; hired Nick to build the website/database used to store and track news articles (from Nick's context). Needs a reliable system that protects contract performance and relationship health.
- **Primary operator / builder: Nick.** Built News Nexus and manages development on nn12dev before changes move to nn12prod (from Nick's context). Needs operational leverage, fewer hidden failures, and confidence that automations produce usable contract outputs.
- **Reviewers / analysts.** Exact roles are not documented. Based on the SoW and CTO doc, likely users review relevance, approve articles, manage reports, and inspect AI-derived classifications (inferred).

## 4. Value proposition

Today, the clipping operation requires national monitoring, jurisdiction filtering, state coverage tracking, duplicate review, quality control, and weekly delivery under contract pressure. NewsNexus gives the team one system of record and automation layer for ingesting candidate articles, storing them in Postgres, scraping article content, deduplicating, assigning state, scoring relevance/location/AI approval, and organizing articles for review and reporting (CTO_ONBOARDING.md §1, §4, §5). The value is not simply finding more articles; it is making the clip lifecycle measurable, repeatable, reviewable, and aligned with the SoW's acceptance criteria (inferred from the SoW and CTO doc).

## 5. Strategic bets and assumptions

- **Automation can improve coverage without overwhelming reviewers.** The platform ingests from Google News RSS, NewsAPI, NewsData.io, GNews, and publisher sites (CTO_ONBOARDING.md §6).
- **AI is useful as review support.** OpenAI state assignment, semantic scoring, location scoring, dedupe, and AI approver scores can add leverage, but should remain reviewable unless Nick and CPSC accept automated final decisions (CTO_ONBOARDING.md §1, §6; inferred).
- **SoW requirements can become product workflows.** State goals, monthly clip bands, 180-day recency, jurisdiction exclusions, duplicate rules, and rejection feedback need explicit product surfaces or reporting logic (from the SoW).
- **The tool must fit the contract output.** The SoW requires electronic deliverables and review/acceptance; it does not require CPSC to use NewsNexus directly (from the SoW).
- **Reviewer capacity is a key unknown.** Recent production questions suggest large runs can add many articles while downstream AI assignments/scores may lag or fail silently (from Nick's 2026-05-02 project questions).

## 6. Success criteria

Near term, NewsNexus works if it helps produce weekly PDF/Excel clip deliverables, keep monthly volume within the SoW's 400-700 clip band, avoid end-of-year surges, and show each state's progress toward mid-year and annual goals (from the SoW). It should expose failures in ingestion, scraping, dedupe, state assignment, and AI scoring before they affect delivery (inferred from CTO_ONBOARDING.md §4 and Nick's questions).

Medium term, it should become the trusted system of record: every candidate article has source, incident state, product/hazard classification, relevance/approval status, duplicate status, report membership, and delivery disposition (inferred from the SoW and CTO doc). Long term, it should protect contract durability across the base year and option years (from the SoW). The single best candidate metric is **accepted, in-scope, non-duplicate clips delivered on time versus state/month goals** (inferred; not yet formally defined by Nick).

## 7. Business model

The business context is a firm fixed price government contract with one base year and four one-year option periods (from the SoW). Kinetic Metrics appears to be paid for accepted, in-scope news clips and not paid for out-of-scope clips; duplicates are excluded from payment (from the SoW). NewsNexus itself appears to be an internal operating product supporting delivery of that contract rather than a standalone SaaS product (from Nick's context; inferred). If the contractor fails mid-year or annual goals, the Government may decline remaining option years (from the SoW), so product investment should be judged by reduced rejection risk, predictable delivery, and protected option-year value.

## 8. Stakeholders and partners

- **CPSC COR / Contracting Officer Representative:** inspects and accepts deliverables; can reject deficient work; reviews within defined windows (from the SoW).
- **CPSC analysts and Data Intake Branch:** downstream consumers of clips and synopses (from the SoW).
- **Kinetic Metrics / Emily and Mark:** responsible for contract delivery and relationship health (from Nick's context).
- **Nick:** builder/operator responsible for NewsNexus product and technical evolution (from Nick's context).
- **News publishers and data providers:** upstream article sources via RSS/API/direct scraping (CTO_ONBOARDING.md §6).
- **AI/API providers:** OpenAI and local embedding models support classification/scoring workflows (CTO_ONBOARDING.md §6).

## 9. Competitive landscape

The documents do not name direct competitors. Adjacent alternatives include manual news monitoring, generic media-monitoring vendors, spreadsheet-driven workflows, and government/internal database tooling (inferred from the SoW). Generic tools may be good at broad search and clipping, but are unlikely to encode CPSC-specific jurisdiction rules, state-level coverage goals, duplicate-payment rules, and delivery/acceptance workflows. NewsNexus is positioned as a vertical workflow system for this contract rather than a general media monitoring product (inferred). The risk is that a generic tool plus disciplined manual QA may be sufficient if NewsNexus automations are unreliable or reviewer burden remains high.

## 10. Status and roadmap

NewsNexus12 is a working monorepo with an Express API, Next.js portal, Postgres-backed shared model package, Node worker, Python worker, and db-manager CLI (CTO_ONBOARDING.md §1-§3). Recent technical work focused on SQLite-to-Postgres migration, CI stabilization, db-manager hardening, stale doc cleanup, and article-content unification (CTO_ONBOARDING.md §10). Product attention is now on orchestration automation: deleting/replenishing articles, scraping candidates, assigning states, running AI approver scores, and creating abbreviated test runs that expose failures without taking hours (from Nick's 2026-05-01/2026-05-02 questions).

A likely next product milestone is an operations dashboard/runbook that shows what ran, what failed, how many articles moved through each stage, which state/month goals changed, and whether the run produced contract-usable clips. This is inferred, not stated.

## 11. Open risks and unknowns

- **Workflow observability:** worker jobs may complete partially or fail downstream unless stage-level status is visible (inferred from CTO_ONBOARDING.md §4 and Nick's questions).
- **AI reliability:** state assignment and AI approver scoring depend on model/API behavior, prompts, config, and orchestration (CTO_ONBOARDING.md §6).
- **Coverage:** the SoW requires state-by-state goals and mid-year thresholds, not just total article counts (from the SoW).
- **Quality/payment:** out-of-scope and duplicate clips are unpaid; product metrics must separate candidate volume from accepted payable clips (from the SoW).
- **Compliance/public disclosure:** clips are retained indefinitely and derived data may be FOIA-disclosable, so audit trail matters (from the SoW).
- **Technical maturity:** no formal deploy pipeline, uneven tests, no portal tests, and Postgres migration cleanup may slow iteration (CTO_ONBOARDING.md §8-§10).
- **Role clarity:** documents do not define exact user personas, permissions, review queues, or daily operating procedures.

## 12. Open questions for the project owner

- What is the canonical product metric: candidates found, approved clips, delivered clips, accepted/payable clips, state coverage, or a composite?
- Who uses the portal day to day besides Nick, and what decision does each role make?
- What is the intended CPSC handoff: generated PDFs/Excel only, email support, report packages, or direct access someday?
- How are CPSC rejections captured today, and should rejection feedback train future filtering/scoring?
- Which SoW requirements are already supported in-product, and which are still manual?
- What should the product do when monthly clip volume risks going below 400 or above 700?
- Does NewsNexus need a state-goal dashboard tied to Attachment A's mid-year and annual thresholds?
- Are AI state assignment and AI approver scores advisory, required before delivery, or optional enrichment?
- After Postgres stabilization, is the roadmap ingestion, review UX, reporting/export, observability, or quality-control workflows?
- Should NewsNexus remain CPSC-specific, or could it support other regulated news-monitoring contracts?
