#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly PRODUCTION_REPOSITORY="/home/limited_user/applications/NewsNexus12"
readonly SYSTEMD_DIRECTORY="/etc/systemd/system"
readonly LIBEXEC_PATH="/usr/local/libexec/newsnexus12-publish-weekly-alert"
readonly SUDOERS_PATH="/etc/sudoers.d/newsnexus12-publish-weekly-alert"
readonly ENVIRONMENT_PATH="/etc/newsnexus12/weekly-article-flow.env"
readonly LOCK_PATH="/var/lock/newsnexus12-weekly-article-flow.lock"

usage() {
  echo "usage:" >&2
  echo "  install.sh --check" >&2
  echo "  install.sh --mode development --install-helper" >&2
  echo "  install.sh --mode production --install-assets" >&2
  echo "  install.sh --mode production --enable-timer" >&2
}

check_sources() {
  local required_file
  for required_file in \
    "${SCRIPT_DIR}/systemd/newsnexus12-weekly-article-flow.service" \
    "${SCRIPT_DIR}/systemd/newsnexus12-weekly-article-flow.timer" \
    "${SCRIPT_DIR}/systemd/newsnexus12-publish-weekly-alert.service" \
    "${SCRIPT_DIR}/libexec/newsnexus12-publish-weekly-alert" \
    "${SCRIPT_DIR}/sudoers/newsnexus12-publish-weekly-alert"; do
    if [[ ! -f "${required_file}" || -L "${required_file}" ]]; then
      echo "required source asset is missing or unsafe: ${required_file}" >&2
      exit 66
    fi
  done

  /bin/bash -n "${SCRIPT_DIR}/bin/run-weekly-flow"
  /bin/bash -n "${SCRIPT_DIR}/bin/run-dev-canary"
  /bin/bash -n "${SCRIPT_DIR}/bin/run-dev-destructive-recovery"
  /bin/bash -n "${SCRIPT_DIR}/libexec/newsnexus12-publish-weekly-alert"
  /bin/bash -n "${SCRIPT_DIR}/install.sh"
  /bin/bash -n "${SCRIPT_DIR}/uninstall.sh"

}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "installation requires root" >&2
    exit 77
  fi
}

install_helper() {
  /usr/bin/install --owner=root --group=root --mode=0755 \
    "${SCRIPT_DIR}/libexec/newsnexus12-publish-weekly-alert" "${LIBEXEC_PATH}"
  /usr/bin/install --owner=root --group=root --mode=0644 \
    "${SCRIPT_DIR}/systemd/newsnexus12-publish-weekly-alert.service" \
    "${SYSTEMD_DIRECTORY}/newsnexus12-publish-weekly-alert.service"
  /usr/bin/install --owner=root --group=root --mode=0440 \
    "${SCRIPT_DIR}/sudoers/newsnexus12-publish-weekly-alert" "${SUDOERS_PATH}"
  /usr/sbin/visudo -c -f "${SUDOERS_PATH}"
  /usr/bin/systemctl daemon-reload
  /usr/bin/systemd-analyze verify \
    "${SYSTEMD_DIRECTORY}/newsnexus12-publish-weekly-alert.service"
}

install_production_assets() {
  if [[ "${SCRIPT_DIR}" != "${PRODUCTION_REPOSITORY}/ops/weekly-article-flow" ]]; then
    echo "production installation must run from ${PRODUCTION_REPOSITORY}" >&2
    exit 64
  fi
  if [[ ! -f "${ENVIRONMENT_PATH}" || -L "${ENVIRONMENT_PATH}" ]]; then
    echo "create the root-managed ${ENVIRONMENT_PATH} before production installation" >&2
    exit 78
  fi

  /usr/sbin/runuser --user limited_user -- /usr/bin/npm -C "${SCRIPT_DIR}" run build
  test -f "${SCRIPT_DIR}/dist/cli.js"
  install_helper
  /usr/bin/install --owner=root --group=root --mode=0644 \
    "${SCRIPT_DIR}/systemd/newsnexus12-weekly-article-flow.service" \
    "${SYSTEMD_DIRECTORY}/newsnexus12-weekly-article-flow.service"
  /usr/bin/install --owner=root --group=root --mode=0644 \
    "${SCRIPT_DIR}/systemd/newsnexus12-weekly-article-flow.timer" \
    "${SYSTEMD_DIRECTORY}/newsnexus12-weekly-article-flow.timer"
  /usr/bin/install --owner=limited_user --group=limited_user --mode=0640 /dev/null "${LOCK_PATH}"
  /usr/bin/systemctl daemon-reload
  /usr/bin/systemctl disable --now newsnexus12-weekly-article-flow.timer
  /usr/bin/systemd-analyze verify \
    "${SYSTEMD_DIRECTORY}/newsnexus12-weekly-article-flow.service" \
    "${SYSTEMD_DIRECTORY}/newsnexus12-weekly-article-flow.timer" \
    "${SYSTEMD_DIRECTORY}/newsnexus12-publish-weekly-alert.service"
}

if [[ "$#" -eq 1 && "$1" == "--check" ]]; then
  check_sources
  exit 0
fi

if [[ "$#" -ne 3 || "$1" != "--mode" ]]; then
  usage
  exit 64
fi

readonly MODE="$2"
readonly ACTION="$3"
check_sources
require_root

case "${MODE}:${ACTION}" in
  development:--install-helper)
    install_helper
    ;;
  production:--install-assets)
    install_production_assets
    ;;
  production:--enable-timer)
    if \
      [[ ! -f "${SYSTEMD_DIRECTORY}/newsnexus12-weekly-article-flow.service" ]] || \
      [[ ! -f "${SYSTEMD_DIRECTORY}/newsnexus12-weekly-article-flow.timer" ]] || \
      [[ ! -f "${SYSTEMD_DIRECTORY}/newsnexus12-publish-weekly-alert.service" ]] || \
      [[ ! -x "${LIBEXEC_PATH}" ]] || \
      [[ ! -f "${SUDOERS_PATH}" ]] || \
      [[ ! -f "${ENVIRONMENT_PATH}" ]]; then
      echo "install production assets before enabling the timer" >&2
      exit 69
    fi
    /usr/bin/systemd-analyze verify \
      "${SYSTEMD_DIRECTORY}/newsnexus12-weekly-article-flow.service" \
      "${SYSTEMD_DIRECTORY}/newsnexus12-weekly-article-flow.timer" \
      "${SYSTEMD_DIRECTORY}/newsnexus12-publish-weekly-alert.service"
    /usr/bin/systemctl enable --now newsnexus12-weekly-article-flow.timer
    ;;
  development:--install-assets|development:--enable-timer)
    echo "development mode refuses weekly service or timer installation" >&2
    exit 77
    ;;
  *)
    usage
    exit 64
    ;;
esac
