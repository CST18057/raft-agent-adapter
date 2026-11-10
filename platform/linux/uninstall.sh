#!/usr/bin/env bash
# Remove this checkout's `grok` trampoline from the user bin directory.
# Source files, agent sessions, and unrelated PATH entries are preserved.
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
BIN_DIR=${RAFT_ADAPTER_BIN_DIR:-"$HOME/.local/bin"}
LINK="$BIN_DIR/grok"

# Only delete a trampoline that points at this checkout; never touch a foreign
# grok or another checkout's install.
if [ -f "$LINK" ] && grep -qF "$ROOT/bin/grok" "$LINK" 2>/dev/null; then
  rm -f -- "$LINK"
  echo "Removed this checkout's grok entry. Files, agent sessions and unrelated PATH entries are preserved."
else
  echo "No grok entry for this checkout was found under $BIN_DIR; nothing removed."
fi
echo "Restart Raft Computer or rescan runtimes so the Grok Build slot updates."
