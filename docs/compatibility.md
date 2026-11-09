# Compatibility and validation

Version 0.2.0 is an experimental first public release. Protocol behavior depends on the installed Raft and Devin versions. Please include all three versions when reporting a regression.

## Verified scope

| Environment | Evidence |
| --- | --- |
| Windows, Raft Computer 1.0.63, Devin CLI 3000.12.32, Node 26.13.0 | Original local integration exercised real internal-agent startup, tool execution, DM round trips, role forwarding, idle and in-flight messages, and same-machine restart/resume |
| Generalized public checkout, same Windows / Devin / Node | Launcher build, native ACP model discovery, and SWE-2 Max / Default configuration checks; no inference prompt |
| Node 22/24, Windows and Linux | CI target for offline protocol tests; Windows also compiles the launcher. Check the actual workflow status for results |
| macOS/Linux real Raft integration | Not verified; no installer or native launcher provided |
| Cross-computer migration and export | Not verified |

The offline test peer is independently authored and never invokes a model or tool. It covers thinking translation, invalid selections, usage forwarding, host instructions, in-flight prompt completion, permission forwarding, session-load replay suppression, and capability rejection. It cannot prove end-to-end compatibility with future product versions.

## Known limitations

- The runtime selector remains **Grok Build**. A real Grok installation cannot directly share the local `grok.exe` slot.
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
| Grok Build missing from inventory | Run `Install.ps1`, verify the Computer process inherits the new PATH, then restart that Computer through its usual method |
| Old model list or no Max option | Run `Refresh-Models.ps1`, then refresh the model list in Raft; a workspace Scan is unrelated |
| Configuration / handshake failure | Run `Test-Adapter.ps1`; confirm official Devin login, configured executable, connectivity, and the supported CLI version |
| Invalid reasoning effort | Select one of the native choices; SWE-2 currently offers Medium, High, Max |
| Proxy connection failure | Ensure the configured local proxy is running and the Computer process has the intended configuration/environment |
| Build cannot overwrite launcher | Stop agents using this checkout before rebuilding |
| Node executable no longer exists | Reinstall/select Node 22+, run `Build.ps1`, and restart the agents |

Include sanitized errors and versions in an issue. Do not attach account files, raw transcripts, or full environment/PATH dumps.
