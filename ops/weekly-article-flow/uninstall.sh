#!/usr/bin/env bash
set -euo pipefail

readonly WEEKLY_SERVICE="newsnexus12-weekly-article-flow.service"
readonly WEEKLY_TIMER="newsnexus12-weekly-article-flow.timer"
readonly ALERT_SERVICE="newsnexus12-publish-weekly-alert.service"

if [[ "$#" -ne 1 || "$1" != "--confirm" ]]; then
  echo "usage: uninstall.sh --confirm" >&2
  exit 64
fi

if [[ "${EUID}" -ne 0 ]]; then
  echo "uninstallation requires root" >&2
  exit 77
fi

if /usr/bin/systemctl is-active --quiet "${WEEKLY_SERVICE}"; then
  echo "refusing to uninstall while ${WEEKLY_SERVICE} is active" >&2
  exit 75
fi

if /usr/bin/systemctl is-active --quiet "${ALERT_SERVICE}"; then
  echo "refusing to uninstall while ${ALERT_SERVICE} is active" >&2
  exit 75
fi

/usr/bin/systemctl disable --now "${WEEKLY_TIMER}" 2>/dev/null || true

/usr/bin/rm -- "/etc/systemd/system/${WEEKLY_SERVICE}" 2>/dev/null || true
/usr/bin/rm -- "/etc/systemd/system/${WEEKLY_TIMER}" 2>/dev/null || true
/usr/bin/rm -- "/etc/systemd/system/${ALERT_SERVICE}" 2>/dev/null || true
/usr/bin/rm -- "/usr/local/libexec/newsnexus12-publish-weekly-alert" 2>/dev/null || true
/usr/bin/rm -- "/etc/sudoers.d/newsnexus12-publish-weekly-alert" 2>/dev/null || true
/usr/bin/rm -- "/var/lock/newsnexus12-weekly-article-flow.lock" 2>/dev/null || true

/usr/bin/systemctl daemon-reload
/usr/bin/systemctl reset-failed "${WEEKLY_SERVICE}" "${ALERT_SERVICE}" 2>/dev/null || true

echo "weekly-flow units and helper assets removed"
echo "database records, JSONL, alerts, backups, environment configuration, and unrelated schedules were preserved"
