#!/usr/bin/env bash
# Thin wrapper for the isolated idle RSS series.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT/apps/desktop"
exec env ELECTRON_RUN_AS_NODE=1 ../../node_modules/.bin/electron \
  ../../node_modules/tsx/dist/cli.mjs perf/run-isolated-idle-series.ts "$@"
