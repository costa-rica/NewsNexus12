---
created_at: 2026-08-08T21:43:25Z
updated_at: 2026-08-08T21:52:55Z
created_by: hermes (gpt-5.6-sol) nws-nn12prod
modified_by: hermes (gpt-5.6-sol) nws-nn12prod
---

# NewsNexus12 Weekly Cron Flow Assessment

Assessment time: 2026-08-08T21:43:25Z on `nws-nn12prod`.

## Current scheduling and execution status

- **One NewsNexus12 weekly cron job is active.** Hermes job `2c4cdcc53964`, **NewsNexus12 weekly Google RSS — Friday 5am Pacific**, is enabled and scheduled for `0 12,13 * * 5`; its timezone guard permits only Friday 05:xx `America/Los_Angeles`. Next run: 2026-08-14 at 05:00 Pacific.
- This job only submits `/request-google-rss/start-job`. It does not delete articles, wait for RSS completion, or trigger semantic scoring, state assignment, or AI Approver V02.
- The 2026-08-07 scheduled submission created worker-node job `0196`. Hermes reported `ok` because HTTP `202` was returned, but job `0196` ended internally with `endingReason=error`, zero articles added, and a missing Playwright Chromium executable. Manual recovery job `0199` later completed successfully and added 2,627 articles.
- The installed full-flow systemd timer `newsnexus12-worker-node-orchestrator-weekly.timer` is **disabled/inactive**, with no next or prior trigger recorded. Its associated service is inactive. Its legacy order also uses AI Approver V01, not V02.
- `newsnexus12-db-manager.timer` and service are **disabled/inactive**. The installed service does not pass `--delete_articles`.
- No NewsNexus12 entry was found in Nick's crontab or accessible `/etc/cron*` files. Root and `limited_user` private crontabs could not be inspected without sudo, so they cannot be conclusively excluded.
- Both worker queues are currently idle, and `/orchestrator/active-run` reports no active run.
- AI Approver V02 is currently documented as manual-only: “Do not place V02 in the weekly orchestrator.” Automating it requires an explicit release-policy decision and validated implementation.

## Last-week runtime evidence

Window reviewed: 2026-07-31 through 2026-08-08, UTC.

- **Deletion:** no run in the window. The latest earlier deletion, job `0174` on 2026-07-17, deleted 694 articles in 3.320 seconds.
- **Google RSS `0191`:** 2026-07-31 12:00:56 to 2026-08-01 03:00:40; **14h 59m 44s**; 6,955 articles added.
- **State assigner `0192`:** 2026-08-01 14:37:50 to 2026-08-02 02:30:41; **11h 52m 51s**; 7,000 selected, 6,999 successful, one failed.
- **Semantic scorer `0193`:** waited behind the state assigner, then ran 2026-08-02 02:30:41 to 02:54:16; **23m 34s**; 7,081 processed.
- **AI Approver V02 run 10 / job `0100`:** 2026-08-02 06:07:26 to 13:45:08; **7h 37m 42s**; 7,000 requested, only 5,120 eligible/attempted, 5,118 completed, two failed.
- **Google RSS `0199`:** 2026-08-07 15:40:00 to 22:15:01; **6h 35m 1s**; 2,627 articles added. No later semantic, state-assigner, or V02 job was found through this assessment.

## Coverage finding

The state assigner and semantic scorer had numerical capacity to cover the 6,955 articles from RSS job `0191`, but exact article-by-article overlap was not proven. V02 did **not** meet the requested numerical floor: 5,120 attempted is less than 6,955 added. The later 2,627 articles from job `0199` have no demonstrated downstream coverage. Therefore, the current process does not guarantee that state assignment and AI Approver V02 analyze at least as many articles as Google RSS adds.

## Recommendation — safe sequencing (200 words or less)

Use one durable, completion-driven orchestrator, not five independently timed cron entries. A weekly systemd timer should start a supervised oneshot script/service with `flock`, persisted run state, bounded retries, and alerts. Pause the existing standalone RSS cron only after the replacement passes an end-to-end canary.

Sequence: preflight services, queues, disk, database target, Codex authentication, and a verified backup; run `db-manager`'s `npm start -- --delete_articles` and require exit zero; submit Google RSS and poll its worker job until terminal success, requiring `endingReason=queries_exhausted`; run semantic scorer and verify completion; run state assigner; then run V02 only after state reconciliation succeeds.

Capture article-ID bounds and RSS `articlesAddedCount`. Set the state target to at least that count plus any backlog, then verify distinct successful state outputs within the frozen bounds are at least the RSS additions. At V02 execution time, create a fresh preview, prevent duplicates, and block with an alert if `plannedEligibleCount` is below the RSS additions; after completion, reconcile distinct predictions and retryable failures.

Use generous per-stage limits above observed runtimes (RSS >15h, state >12h, V02 >8h). Fixed spacing is unnecessary and unsafe because runtimes vary.

## Recommended implementation location (200 words or less)

Keep the implementation source-controlled and isolated at `/home/limited_user/applications/NewsNexus12/ops/weekly-flow/`. Treat it as a removable adapter around existing application commands and APIs; it must not contain business logic that belongs in workers.

Suggested layout:

- `bin/orchestrate.sh`: state machine and stage handoff.
- `lib/common.sh`: locking, HTTP polling, validation, retries, and logging.
- `stages/`: one script each for preflight, deletion, RSS, semantic scoring, state assignment, V02 preview/start, and reconciliation.
- `config/weekly-flow.env.example`: non-secret defaults; production secrets remain in existing protected service environments.
- `systemd/`: canonical timer and oneshot unit templates.
- `tests/`: mocked endpoint and resume/failure tests.
- `README.md`, `install.sh`, `uninstall.sh`, and `MANIFEST`: operation, installation, and complete removal instructions.

Use `/var/lib/newsnexus12-weekly-flow/` only for mutable checkpoints, run manifests, and locks; use journald for logs. The installer should copy/link exactly two namespaced units into `/etc/systemd/system/`. The uninstaller should disable and remove those units, delete runtime state only with an explicit purge option, and leave application data untouched. This creates one clearly bounded directory plus two units and one runtime directory, while each stage remains independently replaceable.

## Other ideas worth considering (100 words or less)

Extend the existing application orchestrator to reorder semantic scoring before state assignment and add V02 with frozen article bounds, resumability, and portal-visible status. This offers the best audit trail but requires code, tests, deployment, and a deliberate change to V02's manual-only release boundary.

A lighter alternative is chained Hermes watchdog jobs that poll predecessor IDs and trigger successors. It is faster to prototype, but fragmented state, the scheduler's short agent-run limit, and weaker transactional guarantees make it less suitable than systemd for a 30–40-hour flow. Event/webhook handoffs could later replace polling once workers emit durable completion events.

## Verification sources

- Hermes scheduler: `hermes cron list`, `hermes cron status`, job output, and trigger sentinel.
- Systemd unit/timer state from `systemctl show` and `systemctl list-timers`.
- Live worker queue and run APIs on `127.0.0.1:8003` and `127.0.0.1:8004`.
- Worker-node and worker-python journals for processed counts.
- `docs/ai-appover-v02/20260723_ai_approver_v02_operations.md` for the V02 release boundary.
