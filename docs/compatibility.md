# Compatibility and validation

Version 0.3.0 is an experimental release adding Linux support. Protocol behavior depends on the installed Raft and Devin versions. Please include all three versions when reporting a regression.

## Verified scope

| Environment | Evidence |
| --- | --- |
| Windows, Raft Computer 1.0.63, Devin CLI 3000.12.32, Node 26.13.0 | Original local integration exercised real internal-agent startup, tool execution, DM round trips, role forwarding, idle and in-flight messages, and same-machine restart/resume |
| Linux container, Devin CLI 3000.12.32 (standalone install), Node 22 | `docker build` verification: launcher generation, PATH install at `~/.local/bin/grok`, the daemon's exact launch args (`agent --no-leader --always-approve stdio`), `initialize`/`session/new`/`session/load`/`session/delete` against the **real** `devin acp` binary, plus uninstall/reinstall cycle — all without inference |
| Linux container, fake ACP peer | Full chain through PATH `grok`: model catalog, `session/set_model` with `reasoningEffort=max`, session resume |
| Raft Computer 1.0.67 for Linux | Installs via the official script in the same image; wire behavior confirmed by extracting the daemon's embedded Grok driver (discovery, launch args, `_meta` fields, effort vocabulary, `-32000` → not-authenticated mapping) |
| **Live Linux Raft integration** (real server, Raft Computer 1.0.67, Devin CLI 3000.12.32 standalone, Node 24) | Full chain verified end-to-end in a container: `raft-computer attach` → `Detected runtimes: grok (raft-devin-adapter 0.3.0…)` → `runtime_models:detect` populated the UI model picker → internal agent created on **Grok Build** with `devin:swe-2-flash-medium` → `agent:start` spawned the adapter → a DM to the agent produced a real inference reply (`OK`, `Devin · SWE-2 Flash Medium`) |
| Node 22/24, Windows and Linux | CI: offline protocol tests; both launchers are built and smoke-tested against the fake peer; the Docker image builds without external downloads |
| Real inference on Windows | Not exercised in this revision; the Linux chain above covers the same adapter code path |
| Authenticated model discovery | Verified: after `devin auth login`, `session/new` returned the account's real models through the adapter (free tier: `swe-2-flash-medium`, `swe-1-6-slow`); real `session/prompt` returned `stopReason: end_turn` with usage accounting |
| macOS | The POSIX launcher/discovery code paths apply, but nothing is verified |
| Cross-computer migration and export | Not verified |

The offline test peer is independently authored and never invokes a model or tool. It covers thinking translation, invalid selections, usage forwarding, host instructions, in-flight prompt completion, permission forwarding, session-load replay suppression, and capability rejection. It cannot prove end-to-end compatibility with future product versions.

## Known limitations

- The runtime selector remains **Grok Build**. A real Grok installation cannot directly share the local `grok` slot.
- **Authentication model.** The standalone Devin CLI uses its local `devin setup` login inside `devin acp`; sign in before relying on the model list. A Devin Desktop-bundled binary instead requires the ACP host to call `authenticate` — the adapter forwards such calls, but Raft's Grok slot never sends them, so prefer the standalone install. Without login, `session/new` works but the model list is empty.
- Raft's Grok account/usage widget may show **needs attention**. Grok-specific account reporting is not implemented; use the official Devin CLI to check login and account status.
- Raft's Grok login/update actions are not Devin management commands. Manage Devin through its official CLI.
- Standing instructions are forwarded as a marked first-prompt block, not a native system-prompt replacement. They are sent again after a resume.
- Raft's Grok transcript locator does not find Devin's native transcripts. A handoff may contain identity only; complete transcript export/migration is not provided.
- Same-machine session loading was tested. Cross-computer transfer is not established by that test.
- Model lists and thinking options come from Devin. Refresh the local catalog after an update. Raft's supported vocabulary may omit native values such as `none`.
- Future changes to Raft's discovery, Grok extensions, or Devin ACP may require an adapter update.
- Native permission prompts are forwarded; this adapter does not provide an execution sandbox or change Devin's tool permissions.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Grok Build missing from inventory | Install the adapter (`platform/linux/install.sh` or `platform\windows\Install.ps1`), confirm `grok --version` runs, verify `~/.local/bin/grok` (POSIX fallback) or the user PATH entry, then rescan runtimes or restart the Computer |
| `runtime_not_authenticated` in Raft | Devin ACP rejected the launch: run `devin setup` on the standalone CLI install, or use an ACP host that calls `authenticate` |
| Old model list or no Max option | Re-run `models:refresh` (`platform/linux/refresh-models.sh`, `platform\windows\Refresh-Models.ps1`), then refresh the model list in Raft; a workspace Scan is unrelated |
| Configuration / handshake failure | Run `platform/linux/test-adapter.sh` or `platform\windows\Test-Adapter.ps1`; confirm official Devin login, configured executable, connectivity, and the supported CLI version |
| Invalid reasoning effort | Select one of the native choices; SWE-2 currently offers Medium, High, Max |
| Proxy connection failure | Ensure the configured local proxy is running and the Computer process has the intended configuration/environment |
| Build cannot overwrite launcher | Stop agents using this checkout before rebuilding |
| Node executable no longer exists | Reinstall/select Node 22+, rebuild (`build.sh` / `Build.ps1`), and restart the agents |
| `grok` on PATH resolves elsewhere | Another `grok` earlier in PATH shadows `~/.local/bin/grok`; move it or use `--replace-adapter` if it is an older adapter install |

Include sanitized errors and versions in an issue. Do not attach account files, raw transcripts, or full environment/PATH dumps.
