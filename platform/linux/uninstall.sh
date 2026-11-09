#!/usr/bin/env bash
# Remove this checkout's `grok` trampoline from the user bin directory.
# Source files, Devin sessions, and unrelated PATH entries are preserved.
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
BIN_DIR=${DEVIN_ADAPTER_BIN_DIR:-"$HOME/.local/bin"}
LINK="$BIN_DIR/grok"

removed=false
# Only delete a trampoline that points at this checkout; never touch a foreign
# grok or another checkout's install.
if [ -f "$LINK" ] && grep -qF "$ROOT/bin/grok" "$LINK" 2>/dev/null; then
  rm -f -- "$LINK"
  removed=true
fi
# Also honor the recorded install location if it differs (older BIN_DIR).
STATE="$ROOT/.local/installation-state.json"
if [ -f "$STATE" ]; then
  recorded=$(sed -n 's/.*"linkPath": *"\([^"]*\)".*/\1/p' "$STATE" | head -n 1)
  if [ -n "$recorded" ] && [ "$recorded" != "$LINK" ] && [ -f "$recorded" ] && grep -qF "$ROOT/bin/grok" "$recorded" 2>/dev/null; then
    rm -f -- "$recorded"
    removed=true
  fi
fi

if [ "$removed" = true ]; then
  echo "Removed this checkout's grok entry. Files, Devin sessions and unrelated PATH entries are preserved."
else
  echo "No grok entry for this checkout was found under $BIN_DIR; nothing removed."
fi
echo "Restart Raft Computer or rescan runtimes so the Grok Build slot updates."
