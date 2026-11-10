# Changelog

## 0.3.0 — Unreleased

- Multi-backend support: `backend` selects Devin CLI or DeepSeek Harness (`dsh acp`) behind the same `grok` slot. Backend differences live in `src/backends.mjs`.
- DeepSeek Harness: `session/load` maps to `session/resume` (unknown sessions are reported as missing, so Raft starts a fresh one); `session/delete` maps to `session/close`; grouped model options are flattened; `reasoning_effort` maps to Raft's reasoning effort.
- Interjections sent during an active dsh turn are queued and sent as the next prompt after that turn completes.
- The dsh primed catalog session ID is kept in `.local/backend-state.json` and resumed, so repeated Raft probes do not leave new dead sessions.
- Model IDs from the other backend are rejected with an explicit refresh-or-switch message, because Raft cannot see a backend swap.
- Configuration: `RAFT_ADAPTER_BACKEND`, `RAFT_ADAPTER_CONFIG`, `RAFT_ADAPTER_PROXY`, `RAFT_ADAPTER_LOCAL`, and `DSH_EXE`; `devinExe`/`devinArgs` and `dshExe`/`dshArgs` in `adapter.config.json`.
- Linux support: POSIX launcher (`bin/grok`), `platform/linux/` install, uninstall, model refresh and test scripts, the `~/.local/bin/grok` trampoline, and standalone Devin discovery at `~/.local/bin/devin`.
- Repository restructure: OS entry points grouped under `platform/{windows,linux}/`.
- Forward ACP `authenticate` to Devin and drop the unauthenticated primed session; clearer hint when `session/new` is rejected as unauthenticated.
- `docker/` sandbox; CI builds both launchers and smoke-tests both fake peers.
- Renamed from `raft-devin-adapter` to `raft-agent-adapter`.

## 0.2.0 — First public release

- Connect Devin CLI to Raft's internal-agent Grok Build ACP entry point.
- Translate model choices and independently configurable thinking levels, including SWE-2 Max.
- Forward initial host instructions, mid-turn messages, permission requests, streaming updates, and usage.
- Support same-machine native session resume with history replay suppression.
- Add a source-built Windows stdio launcher, configuration discovery, process-specific proxy settings, and install/uninstall scripts.
- Add independently authored offline protocol tests, Windows/Linux CI, English/Chinese documentation, and MIT licensing.

Experimental Windows-first release. See [compatibility](docs/compatibility.md) for tested versions and limitations. Earlier versions were local experiments and were not published as repository releases.
