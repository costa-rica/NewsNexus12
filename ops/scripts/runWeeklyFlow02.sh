#!/bin/sh

set -eu

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ops_directory=$(dirname -- "$script_directory")
runtime_directory="$ops_directory/.runtime"
lock_path="$runtime_directory/weekly-flow-02.lock"

umask 077
mkdir -p "$runtime_directory"

if ! command -v flock >/dev/null 2>&1; then
  printf '%s [ERROR] Weekly pipeline guard unavailable: flock command was not found\n' \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >&2
  exit 69
fi

exec 9>"$lock_path"

set +e
flock --nonblock --conflict-exit-code 75 9
lock_status=$?
set -e

if [ "$lock_status" -eq 75 ]; then
  printf '%s [INFO] Weekly pipeline not started: another coordinator holds the lock\n' \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >&2
  exit 75
fi

if [ "$lock_status" -ne 0 ]; then
  printf '%s [ERROR] Weekly pipeline guard failed while acquiring the lock\n' \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >&2
  exit "$lock_status"
fi

printf '%s [INFO] Weekly pipeline lock acquired pid=%s\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$$" >&2

exec node "$ops_directory/dist/weekly-flow-02/index.js" "$@"
