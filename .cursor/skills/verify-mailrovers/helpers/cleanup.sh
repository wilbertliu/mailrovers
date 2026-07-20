#!/usr/bin/env bash
# Tear down only the Storybook process this skill launched. Never deletes evidence/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
RUN_DIR="$ROOT/.cursor/skills/verify-mailrovers/.run"
PID_FILE="$RUN_DIR/storybook.pid"
EVIDENCE_DIR="$ROOT/.cursor/skills/verify-mailrovers/evidence"
PORT=6006

if [[ ! -f "$PID_FILE" ]]; then
  echo "No owned PID file at $PID_FILE — nothing to kill."
  echo "Evidence left at: $EVIDENCE_DIR"
  exit 0
fi

pid="$(cat "$PID_FILE" 2>/dev/null || true)"
if [[ -z "${pid}" ]]; then
  echo "Empty PID file; removing state only."
  rm -rf "$RUN_DIR"
  echo "Evidence left at: $EVIDENCE_DIR"
  exit 0
fi

stop_tree() {
  local target="$1"
  if ! kill -0 "$target" 2>/dev/null; then
    return 0
  fi
  # Session leader from setsid: kill the process group first.
  kill -TERM -- "-$target" 2>/dev/null || kill -TERM "$target" 2>/dev/null || true
  sleep 1
  if kill -0 "$target" 2>/dev/null; then
    kill -KILL -- "-$target" 2>/dev/null || kill -KILL "$target" 2>/dev/null || true
  fi
  pkill -P "$target" 2>/dev/null || true
}

if kill -0 "$pid" 2>/dev/null; then
  stop_tree "$pid"
  echo "Stopped Storybook pid=$pid"
else
  echo "PID $pid already gone"
fi

# If our launch left a listener orphan, stop only listeners whose cwd/cmdline match desktop storybook.
# Prefer not to kill arbitrary :6006 owners — only when we still own the PID file context.
if command -v lsof >/dev/null 2>&1; then
  orphan="$(lsof -nP -iTCP:${PORT} -sTCP:LISTEN -t 2>/dev/null || true)"
  if [[ -n "${orphan}" ]]; then
    for opid in $orphan; do
      cmd="$(ps -p "$opid" -o args= 2>/dev/null || true)"
      if echo "$cmd" | grep -qE 'storybook|@mailrovers/desktop'; then
        echo "Stopping leftover Storybook listener pid=$opid"
        kill -TERM "$opid" 2>/dev/null || true
        sleep 1
        kill -KILL "$opid" 2>/dev/null || true
      fi
    done
  fi
fi

rm -rf "$RUN_DIR"
echo "Removed $RUN_DIR"
echo "Evidence preserved at: $EVIDENCE_DIR"
