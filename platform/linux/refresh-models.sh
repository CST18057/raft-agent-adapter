#!/usr/bin/env bash
# Read native thinking options for each model from the installed Devin CLI
# and write the local catalog used at launch. No inference prompt is sent.
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
NODE_EXE=$(cat "$ROOT/.local/node-path.txt" 2>/dev/null || command -v node)
"$NODE_EXE" "$ROOT/scripts/refresh-models.mjs"
