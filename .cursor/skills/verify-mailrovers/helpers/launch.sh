#!/usr/bin/env bash
# Start MailRovers Storybook for verification. Writes PID under .run/.
# Double-forks via Python so the process survives the launching shell exiting (macOS has no setsid).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
RUN_DIR="$ROOT/.cursor/skills/verify-mailrovers/.run"
PID_FILE="$RUN_DIR/storybook.pid"
LOG_FILE="$RUN_DIR/storybook.log"
PORT=6006
READY_URL="http://127.0.0.1:${PORT}/iframe.html"

mkdir -p "$RUN_DIR"

if [[ -f "$PID_FILE" ]]; then
  old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${old_pid}" ]] && kill -0 "$old_pid" 2>/dev/null; then
    echo "Storybook already running (pid $old_pid). Refusing second launch."
    echo "Run helpers/doctor.sh or helpers/cleanup.sh first."
    exit 1
  fi
  rm -f "$PID_FILE"
fi

if curl -sf -o /dev/null --max-time 2 "$READY_URL" 2>/dev/null; then
  echo "Port ${PORT} already answers but no owned PID file. Refusing to steal the instance."
  echo "Stop the existing Storybook, or point doctor at it after creating a PID file manually."
  exit 1
fi

python3 - "$ROOT" "$PID_FILE" "$LOG_FILE" <<'PY'
import os, sys, time

root, pid_file, log_file = sys.argv[1], sys.argv[2], sys.argv[3]

# First fork
pid = os.fork()
if pid > 0:
    # Parent waits briefly for grandchild pid file, then exits.
    for _ in range(50):
        if os.path.exists(pid_file):
            break
        time.sleep(0.05)
    sys.exit(0)

os.setsid()
# Second fork — fully detach from session
pid = os.fork()
if pid > 0:
    sys.exit(0)

os.chdir(root)
os.umask(0)
# Redirect stdio to the log
log_fd = os.open(log_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
os.dup2(log_fd, 1)
os.dup2(log_fd, 2)
os.close(log_fd)
devnull = os.open(os.devnull, os.O_RDONLY)
os.dup2(devnull, 0)
os.close(devnull)

with open(pid_file, "w", encoding="utf-8") as f:
    f.write(str(os.getpid()))

os.execvp("pnpm", ["pnpm", "--filter", "@mailrovers/desktop", "storybook"])
PY

# Wait for pid file from daemon
deadline=$((SECONDS + 10))
while (( SECONDS < deadline )); do
  if [[ -f "$PID_FILE" ]]; then
    break
  fi
  sleep 0.1
done

if [[ ! -f "$PID_FILE" ]]; then
  echo "Daemon failed to write PID file."
  tail -n 40 "$LOG_FILE" || true
  exit 1
fi

pid="$(cat "$PID_FILE")"
echo "Started Storybook pid=$pid (log: $LOG_FILE)"

deadline=$((SECONDS + 90))
while (( SECONDS < deadline )); do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "Storybook process exited early. Tail of log:"
    tail -n 40 "$LOG_FILE" || true
    rm -f "$PID_FILE"
    exit 1
  fi
  if curl -sf -o /dev/null --max-time 2 "$READY_URL" 2>/dev/null; then
    echo "Ready: $READY_URL"
    echo "Example canvas: ${READY_URL}?id=flows-workspace--populated-inbox&viewMode=story"
    exit 0
  fi
  sleep 1
done

echo "Timed out waiting for Storybook on port ${PORT}. Tail of log:"
tail -n 60 "$LOG_FILE" || true
exit 1
