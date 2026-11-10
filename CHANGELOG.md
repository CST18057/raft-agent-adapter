# Changelog

## Unreleased

- CodeBuddy Code backend (`backend: "codebuddy"`, `codebuddy --acp`): sign-in is required before a session starts; the CLI has no `session/close` or `session/delete`, so closed sessions are forgotten locally; the primed catalog session is persisted and resumed like DeepSeek Harness; `authenticate` is refused because CodeBuddy's sign-in is interactive; `codebuddyExe`, `codebuddyArgs` and `CODEBUDDY_EXE` configure the executable.
- CodeBuddy per-request `usage_update` counts are summed into the prompt result's `_meta.usage` (ACP usage shape); verified live against a signed-in account.
- CodeBuddy sessions open with permission mode `fullAccess`, applied through `session/set_config_option` on every session open — a true full pass matching the `approvalPolicy: "never"` + `danger-full-access` posture Raft gives Codex.
- Devin sessions likewise open with permission mode `bypass` (auto-approve all tool calls unless organization policy requires approval), re-applied on every session open and resume through the same `session/set_config_option` mechanism.
- CodeBuddy `session/load` for session IDs the adapter did not create answers `session not found`, so Raft starts a fresh session; created sessions are recorded under `.local/codebuddy-sessions/`.
- CodeBuddy deferred interjections run as follow-up prompts inside the Raft turn that was interrupted, because CodeBuddy acknowledges a queued prompt before it executes.

## 0.3.0

- Multi-backend support: `backend` selects Devin CLI or DeepSeek Harness (`dsh acp`) behind the same `grok` slot. Backend differences live in `src/backends.mjs`.
- DeepSeek Harness: `session/load` maps to `session/resume` (unknown sessions are reported as missing, so Raft starts a fresh one); `session/delete` maps to `session/close`; grouped model options are flattened; `reasoning_effort` maps to Raft's reasoning effort.
- Interjections sent during an active dsh turn are queued and sent as the next prompt after that turn completes.
- The dsh primed catalog session ID is kept in `.local/backend-state.json` and resumed, so repeated Raft probes do not leave new dead sessions.
- Model IDs from the other backend are rejected with an explicit refresh-or-switch message, because Raft cannot see a backend swap.
- Configuration: `RAFT_ADAPTER_BACKEND`, `RAFT_ADAPTER_CONFIG`, `RAFT_ADAPTER_PROXY`, `RAFT_ADAPTER_LOCAL`, `RAFT_ADAPTER_BIN_DIR`, and `DSH_EXE`; `devinExe`/`devinArgs` and `dshExe`/`dshArgs` in `adapter.config.json`.
- Linux support: POSIX launcher (`bin/grok`), `platform/linux/` install, uninstall, model refresh and test scripts, the `~/.local/bin/grok` trampoline, and standalone Devin discovery at `~/.local/bin/devin`.
- Repository restructure: OS entry points grouped under `platform/{windows,linux}/`.
- Forward ACP `authenticate` to Devin and drop the unauthenticated primed session; clearer hint when `session/new` is rejected as unauthenticated.
- `docker/` sandbox; CI builds both launchers and smoke-tests both fake peers.
