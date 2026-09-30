# Weekly Combined Flow

## Background and task
I think we've gone too far down a path with the ops/weekly-article-flow feature in a way that I don't understand and cannot help to fix the implementation on the dev and prod servers.

I want us to go back to the main branch of NewsNexus12 prior to where we've implementated any of hte docs/20260829_weekly_article_processing_cron_prd_v03.md features. 

Before we revert I want us to document some of this work. I want to keep the docs/weekly-article-flow-v01 folder. This has a few docs that report on our past flow. I want to have `20260930_lessons_learned_from_v01_flow_{machine}.md` files from the  dev (nws-nn12dev) and prod (nws-nn12prod) agents.

Basically, I want to revert and then create a new flow called weekly combined flow, which will be like the version 02 of the ops/weekly-article-flow but I htink weekly cominbed flow is a better name. It will be generally the same (see ## Overview for Weekly Combined Flow (new)) except the operator will be more hands on in creating the new flow.

These lessons learned will be documents will contain information about what caused problems and things that a new flow will need to account for.
dev) and prod (nws-nn12prod) agents to create the `20260930_lessons_learned_from_v01_flow_nws-nn12dev.md` and `20260930_lessons_learned_from_v01_flow_nws-nn12prod.md` files.

### persistence of docs/weekly-article-flow-v01
After the server agents have created their respective `20260930_lessons_learned_from_v01_flow_nws-nn12dev.md` and `20260930_lessons_learned_from_v01_flow_nws-nn12prod.md` files, They will commit and push all changes. The operator will copy this folder from the mac workstation and keep separate from the NewsNexus12 repo. Then the operator and mac agent will determine the revert commit. Revert. Create a new branch dev_33_weekly_combined_flow_01 and copy this folder. Then create a prd with the new v02 combined flow. The `dev_33_weekly_combined_flow_01` branch name has an 01 at the end becuase it will have many branches for this flow to keep track of progress, the "01" does not refer to a version, simply to separate multiple of these.

## Mac Agent Tasks
1) determine and list all the files currently in docs/weekly-article-flow-v01/ should be kept.
2) create docs/weekly-article-flow-v01/AGENTS.md  will index the remianig files and instruct the dev (nws-nn12dev) and prod (nws-nn12prod) agents to create the `20260930_lessons_learned_from_v01_flow_nws-nn12dev.md` and `20260930_lessons_learned_from_v01_flow_nws-nn12prod.md` files.
3) Determine which commit takes the NewsNexus12 to before docs/20260829_weekly_article_processing_cron_prd_v03.md and ops/weekly-article-flow were implemented but not undoing features beyond the weekly article flow.

## Overview for Weekly Combined Flow (new)

1. Clear all rows from `ArticleDuplicateAnalyses` while preserving the table and schema.
2. Back up the database with db-manager:

   ```bash
   cd /home/limited_user/applications/NewsNexus12/db-manager
   npm start -- --create_backup
   ```

3. Delete old articles with the db-manager default command:

   ```bash
   cd /home/limited_user/applications/NewsNexus12/db-manager
   npm start -- --delete_articles
   ```

4. Run worker-node Google News RSS collection.
5. Run worker-node semantic scoring for the articles collected in step 4.
6. Run worker-node AI state assignment for at least the number of articles collected in step 4.
7. Run worker-python AI Approver V02 for all eligible articles collected in step 4.

AI Approver V02 must allow description fallback and scanning past the approved boundary. Each stage starts only after its predecessor reaches an accepted terminal state.

The recommended scheduler is a systemd timer whose service starts the source-controlled NewsNexus12 orchestrator. This is the production cron flow even though systemd, rather than a crontab entry, supplies the weekly trigger.
