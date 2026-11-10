#!/usr/bin/env bash
# Install the adapter's launcher onto the user's PATH as `grok` (Linux).
#
#   ./install.sh [--devin-exe PATH] [--proxy-url URL] [--replace-adapter]
#
# Creates <bin-dir>/grok (default ~/.local/bin/grok), a small trampoline that
# execs this checkout's generated bin/grok. ~/.local/bin is the standard
# user-bin directory and is also Raft's POSIX fallback discovery location.
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
BIN_DIR=${DEVIN_ADAPTER_BIN_DIR:-"$HOME/.local/bin"}
TARGET="$ROOT/bin/grok"
LINK="$BIN_DIR/grok"
DEVIN_EXE=""
PROXY_URL=""
REPLACE_ADAPTER=false

while [ $# -gt 0 ]; do
  case $1 in
    --devin-exe) DEVIN_EXE=${2:?--devin-exe needs a path}; shift 2 ;;
    --proxy-url) PROXY_URL=${2:?--proxy-url needs a URL}; shift 2 ;;
    --replace-adapter) REPLACE_ADAPTER=true; shift ;;
    -h|--help) sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

"$ROOT/platform/linux/build.sh" >/dev/null

is_adapter() {
  [ -x "$1" ] || return 1
  timeout 10 "$1" --version 2>/dev/null | head -n 1 | grep -q '^raft-agent-adapter '
}

# Check every PATH entry plus the link target, mirroring the Windows
# installer's collision check: a real Grok installation cannot share `grok`.
previous=()
scan_dirs=()
IFS=':' read -r -a scan_dirs <<< "${PATH:-}"
scan_dirs+=("$BIN_DIR")
for dir in "${scan_dirs[@]:-}"; do
  [ -n "$dir" ] || continue
  candidate=$dir/grok
  [ -e "$candidate" ] || [ -L "$candidate" ] || continue
  resolved=$(realpath -m -- "$candidate" 2>/dev/null || echo "$candidate")
  [ "$resolved" = "$TARGET" ] && continue
  # A trampoline created by an earlier install of THIS checkout points at
  # $TARGET inside its body, not via symlink resolution.
  [ -f "$candidate" ] && grep -qF "$ROOT/bin/grok" "$candidate" 2>/dev/null && continue
  if [ "$REPLACE_ADAPTER" != true ]; then
    if is_adapter "$candidate"; then
      echo "Another adapter checkout owns $candidate. Re-run with --replace-adapter to migrate it." >&2
    else
      echo "Another grok exists at $candidate. A real Grok installation cannot share this slot." >&2
    fi
    exit 1
  fi
  if ! is_adapter "$candidate"; then
    echo "Refusing to replace $candidate: it does not identify as raft-agent-adapter." >&2
    exit 1
  fi
  previous+=("$candidate")
done

mkdir -p "$BIN_DIR" "$ROOT/.local"

if [ -n "$DEVIN_EXE" ] || [ -n "$PROXY_URL" ]; then
  [ -z "$DEVIN_EXE" ] || { [ -f "$DEVIN_EXE" ] && [ -x "$DEVIN_EXE" ]; } \
    || { echo "--devin-exe is not an executable file: $DEVIN_EXE" >&2; exit 1; }
  NODE_EXE=$(cat "$ROOT/.local/node-path.txt")
  "$NODE_EXE" -e '
    const fs = require("node:fs");
    const [file, devinExe, proxyUrl] = process.argv.slice(1);
    let config = {};
    try { config = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
    if (devinExe) config.devinExe = fs.realpathSync(devinExe);
    if (proxyUrl) config.proxyUrl = proxyUrl;
    fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
  ' "$ROOT/adapter.config.json" "$DEVIN_EXE" "$PROXY_URL"
fi

for stale in ${previous[@]+"${previous[@]}"}; do
  [ -f "$stale" ] && rm -f -- "$stale"
done

cat > "$LINK" <<EOF
#!/bin/sh
# Installed by raft-agent-adapter - points at $ROOT
exec "$TARGET" "\$@"
EOF
chmod +x "$LINK"

NODE_EXE=$(cat "$ROOT/.local/node-path.txt")
PREV_LINKS=$(printf '%s\n' ${previous[@]+"${previous[@]}"}) \
"$NODE_EXE" -e '
  const fs = require("node:fs");
  const [file, linkPath, binDir] = process.argv.slice(1);
  let state = {};
  try { state = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  if (!state.installedAt) {
    state = {
      installedAt: new Date().toISOString(), linkPath, binDir,
      previousLinks: (process.env.PREV_LINKS || "").split("\n").filter(Boolean)
    };
    fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n");
  }
' "$ROOT/.local/installation-state.json" "$LINK" "$BIN_DIR"

echo "Installed the adapter as $LINK."
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "Note: $BIN_DIR is not on this shell's PATH. Raft's POSIX discovery also checks ~/.local/bin directly, but prefer adding $BIN_DIR to PATH." >&2 ;;
esac
echo "Run: npm run models:refresh   (discovers model thinking options from your Devin CLI)"
echo "Then use Raft's Rescan Runtimes / model refresh so Grok Build picks up this slot."
