#!/bin/sh
# Offline + optional real-CLI verification for the adapter on Linux.
# Runs inside the dev image (WORKDIR = checkout copy) or any Linux checkout.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
cd "$ROOT"

# A login shell would have this; the raw node image does not.
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) PATH="$HOME/.local/bin:$PATH"; export PATH ;; esac

step() { printf '\n=== %s ===\n' "$*"; }

step "Build Linux launcher"
platform/linux/build.sh

step "Syntax check + offline protocol tests"
npm run check
npm test

step "Launcher end-to-end against the deterministic fake ACP peer"
node scripts/fake-peer-config.mjs /tmp/raft-adapter-fake.json
export DEVIN_ADAPTER_CONFIG=/tmp/raft-adapter-fake.json
export MOCK_STATE_FILE=/tmp/raft-adapter-fake-sessions.json
node scripts/smoke.mjs --launcher

step "Install grok onto PATH and verify discovery"
platform/linux/install.sh >/dev/null
command -v grok
grok --version

step "Full chain through PATH grok (same launch args Raft uses)"
node docker/probe.mjs --via-path --expect-models

step "Uninstall / reinstall cycle"
platform/linux/uninstall.sh >/dev/null
hash -r 2>/dev/null || true   # dash caches PATH lookups; drop the stale entry
if [ -e "$HOME/.local/bin/grok" ] || command -v grok >/dev/null 2>&1; then echo "uninstall left grok on PATH" >&2; exit 1; fi
platform/linux/install.sh >/dev/null
command -v grok >/dev/null

if command -v devin >/dev/null 2>&1; then
  step "Real Devin CLI handshake through the adapter (no inference)"
  DEVIN_ADAPTER_CONFIG=/tmp/does-not-exist.json node docker/probe.mjs --via-path
fi

if command -v raft-computer >/dev/null 2>&1; then
  step "Raft Computer"
  raft-computer --version
fi

step "Verification complete"
