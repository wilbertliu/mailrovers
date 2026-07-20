#!/usr/bin/env bash
# Create and print a fresh evidence directory path (UTC timestamp).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
stamp="$(date -u +"%Y-%m-%dT%H-%M-%SZ")"
dir="$ROOT/.cursor/skills/verify-mailrovers/evidence/${stamp}"
mkdir -p "$dir"
echo "$dir"
