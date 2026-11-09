#!/usr/bin/env bash
# Check the built launcher's ACP handshake and model discovery.
#   ./test-adapter.sh          offline-capable launcher smoke check
#   ./test-adapter.sh --live   real Devin SWE-2 Max / Default configuration checks
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
LIVE=false
for arg in "$@"; do
  case $arg in --live|-Live) LIVE=true ;; *) echo "Unknown option: $arg" >&2; exit 2 ;; esac
done

NODE_EXE=$(cat "$ROOT/.local/node-path.txt" 2>/dev/null || command -v node)
"$ROOT/bin/grok" --version
if [ "$LIVE" = true ]; then
  "$NODE_EXE" "$ROOT/scripts/test-live.mjs" --launcher
else
  "$NODE_EXE" "$ROOT/scripts/smoke.mjs" --launcher
fi
