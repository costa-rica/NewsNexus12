---
created_at: 2026-09-04T15:08:38Z
updated_at: 2026-09-04T15:08:38Z
created_by: codex (gpt-5.6-sol) nws-nn12prod
modified_by: codex (gpt-5.6-sol) nws-nn12prod
---

# Weekly Article Flow Failure Report

## Overview

The production timer triggered as scheduled on September 4, 2026 at 5:00 AM PDT. The weekly service exited immediately with status 1 because both the development and production database allowlists contained `newsnexus_prod`. This activated the coordinator’s environment safety check before pipeline execution. No processing stages ran and no data mutations occurred. The timer remains enabled and active, with its next trigger scheduled for September 11, 2026 at 5:00 AM PDT.

## Remedy Recommendation

Securely update `/etc/newsnexus12/weekly-article-flow.env` so `WEEKLY_FLOW_DEV_DATABASES` and `WEEKLY_FLOW_PRODUCTION_DATABASES` contain distinct, accurate database names. Do not expose secrets or remove the overlap safeguard. Validate the corrected configuration as the `limited_user` service account before the next scheduled run. If appropriate, reset the service’s failed state, then confirm the timer remains enabled and scheduled for September 11 at 5:00 AM PDT.


## Operator Appendix: Observations and .env variables
We tested the flow in the developmenet server (nws-nn12dev) and that ran successfully. This was a test run using the docs/20260903_weekly_article_flow_dev_test_runbook.md. The production server failure used the docs/20260903_weekly_article_flow_production_activation_runbook.md.

The production server has a /etc/newsnexus12/weekly-article-flow.env file where the development server does not.
The developement server has a /home/limited_user/applications/NewsNexus12/ops/weekly-article-flow/.env file with the following varaibles related to this error:
```
WEEKLY_FLOW_DEV_HOSTS=nws-nn12dev
WEEKLY_FLOW_PRODUCTION_HOSTS=replace-with-production-host
WEEKLY_FLOW_DEV_DATABASES=newsnexus_prod
WEEKLY_FLOW_PRODUCTION_DATABASES=replace_with_production_database
```

The production server, which failed has a /home/limited_user/applications/NewsNexus12/ops/weekly-article-flow/.env  and a /etc/newsnexus12/weekly-article-flow.env  file with the following:
```
WEEKLY_FLOW_DEV_HOSTS=nws-nn12dev
WEEKLY_FLOW_PRODUCTION_HOSTS=nws-nn12prod
WEEKLY_FLOW_DEV_DATABASES=newsnexus_prod
WEEKLY_FLOW_PRODUCTION_DATABASES=newsnexus_prod
```