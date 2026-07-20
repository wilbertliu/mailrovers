#!/usr/bin/env bash
# Read-only: is this Storybook instance worth driving?
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
RUN_DIR="$ROOT/.cursor/skills/verify-mailrovers/.run"
PID_FILE="$RUN_DIR/storybook.pid"
PORT=6006
PROBE_URL="http://127.0.0.1:${PORT}/iframe.html?id=flows-workspace--populated-inbox&viewMode=story"

ok=0
fail=0

pass() { echo "PASS: $*"; ok=$((ok + 1)); }
fail_msg() { echo "FAIL: $*"; fail=$((fail + 1)); }

if [[ -f "$PID_FILE" ]]; then
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${pid}" ]] && kill -0 "$pid" 2>/dev/null; then
    pass "owned Storybook process alive (pid $pid)"
  else
    fail_msg "PID file present but process not alive (pid=${pid:-empty})"
  fi
else
  echo "WARN: no .run/storybook.pid (instance may be external)"
fi

if curl -sf -o /dev/null --max-time 5 "$PROBE_URL"; then
  pass "iframe probe returns HTTP 200 ($PROBE_URL)"
else
  fail_msg "iframe probe failed ($PROBE_URL)"
fi

body="$(curl -sf --max-time 5 "$PROBE_URL" 2>/dev/null || true)"
if echo "$body" | grep -qiE 'storybook|root|preview'; then
  pass "iframe HTML looks like a Storybook preview document"
else
  fail_msg "iframe HTML did not look like Storybook (empty or unexpected)"
fi

# Port ownership hint (best-effort; lsof may be unavailable in some sandboxes)
if command -v lsof >/dev/null 2>&1; then
  listeners="$(lsof -nP -iTCP:${PORT} -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$listeners" ]]; then
    pass "something is LISTEN on :${PORT}"
    echo "$listeners" | sed 's/^/  /'
  else
    fail_msg "nothing LISTEN on :${PORT}"
  fi
fi

echo "---"
echo "doctor: ${ok} passed, ${fail} failed"
if (( fail > 0 )); then
  exit 1
fi
exit 0
