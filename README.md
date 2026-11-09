# raft-devin-adapter

[English](README.md) · [简体中文](README.zh-CN.md)

[![CI](https://github.com/sealpp/raft-devin-adapter/actions/workflows/ci.yml/badge.svg)](https://github.com/sealpp/raft-devin-adapter/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Status: Experimental](https://img.shields.io/badge/status-experimental-yellow.svg)](docs/compatibility.md)

**Put Devin inside [Raft](https://raft.build) — on Windows and Linux.** Raft's internal agents each bind to a runtime — and **Grok Build** is one of those slots. This adapter makes your installed Devin CLI answer that slot instead, so a Raft agent is driven by Devin — with native session resume, mid-turn message injection, and model thinking controls.

```mermaid
flowchart LR
    A[Raft internal agent] --> B[Grok Build ACP slot]
    B --> C[raft-devin-adapter]
    C --> D[Devin CLI ACP]
```

It translates the two ACP dialects and forwards everything between them: prompts, mid-turn messages, permission requests, streamed updates, usage. Nothing inside Raft is patched — the adapter only adds a `grok` executable to your PATH that launches the real Devin CLI.

This is an **experimental community project**, independently maintained and unaffiliated with Raft, Cognition, or xAI. The runtime selector still says **Grok Build** — the adapter occupies that local executable slot. See [compatibility and limits](docs/compatibility.md) before installing.

If this brings Devin into your Raft workflow, **[give the project a Star](https://github.com/sealpp/raft-devin-adapter)** — reports with CLI versions and reproducible cases are especially useful.

## What works

- Devin appears in Raft's model list with `Devin · …` names.
- Model selection and thinking strength use the native options offered by Devin.
- Raft standing instructions are forwarded as a marked instruction block on the first prompt of each launch or resume.
- Active-turn messages are delivered through Devin's mid-turn prompt capability.
- Host permission requests, streaming updates, and usage data are forwarded.
- Existing Devin session IDs can resume on the same computer, without replaying history into Raft.

Verified **live end-to-end** on Linux — a real Raft server drove an agent through Raft Computer 1.0.67 → this adapter → a logged-in Devin CLI 3000.12.32, and a DM returned a real inference reply. The integration was originally exercised on Windows with Raft Computer 1.0.63. Full evidence breakdown: [validation matrix](docs/compatibility.md).

## Quick start on Linux

Prerequisites: **Node.js 22+**, Git, a working Raft Computer for Linux, and an installed and authenticated [Devin CLI](https://docs.devin.ai/). Install Devin with the official script and log in once:

```sh
curl -fsSL https://cli.devin.ai/install.sh | bash   # installs ~/.local/bin/devin
devin setup                                          # sign in (required for models)
```

Then install the adapter:

```sh
git clone https://github.com/sealpp/raft-devin-adapter.git
cd raft-devin-adapter
platform/linux/install.sh
npm run models:refresh
platform/linux/test-adapter.sh
```

`install.sh` builds the launcher and places a `grok` trampoline in `~/.local/bin` — the directory Raft checks on POSIX after `which grok`. `models:refresh` reads native thinking choices; `test-adapter.sh` checks the launcher's ACP handshake and model discovery. None of them submits an inference prompt.

In Raft, add an **internal agent**, choose **Grok Build**, refresh the model list, then select a `Devin · …` model. If Grok Build is absent from the Computer's runtime inventory, rescan runtimes or restart the Computer so it re-checks `~/.local/bin/grok`. The UI's workspace **Scan** action does not rescan installed runtimes.

## Quick start on Windows

Prerequisites: **Node.js 22+**, Git, a working Raft Computer installation, and an installed and authenticated [Devin CLI](https://docs.devin.ai/). The launcher builds with the .NET Framework 4.x C# compiler included on supported Windows installations. Use the official Devin CLI for login, account configuration, and updates.

Run these commands in PowerShell:

```powershell
git clone https://github.com/sealpp/raft-devin-adapter.git
cd raft-devin-adapter
.\platform\windows\Install.ps1
.\platform\windows\Refresh-Models.ps1
.\platform\windows\Test-Adapter.ps1
```

If your local PowerShell policy blocks a script you have reviewed, you can run that script with `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\platform\windows\Install.ps1`. No npm packages are required to run the adapter.

`Refresh-Models.ps1` discovers thinking choices for each native model. `Test-Adapter.ps1` checks the compiled launcher's ACP handshake and model discovery. Both contact your installed Devin CLI; neither submits an inference prompt. If configuration checks fail, verify official Devin login and connectivity first.

If another `grok.exe` exists, installation stops. A real Grok installation cannot directly share this slot. To migrate an **older checkout of this adapter**, stop its agents and run `Install.ps1 -ReplaceAdapter`; the installer verifies the old executable's adapter identity before replacing its PATH entry. It preserves the previous user PATH in ignored local installation state. On Linux the equivalent is `install.sh --replace-adapter`.

## Select SWE-2 Max

In Raft, choose the **Devin SWE-2 model** and set **Reasoning effort → Max**. Keep Devin's model identifier as `swe-2-high`: Devin exposes its thinking level separately.

| Raft choice | Native Devin configuration |
| --- | --- |
| Model: Devin SWE-2 | `model = swe-2-high` |
| Reasoning: Medium / High / Max | `thought_level = medium / high / max` |
| Reasoning: Default | The selected model's native preset; SWE-2 currently uses High |

There is no fabricated `swe-2-max` model ID. The adapter validates the offered options and confirms the value returned by Devin. Unsupported strengths fail explicitly. For models whose native preset is `none`, Raft's **Default** retains that preset, because Raft's Grok parser does not accept `none` as an explicit strength.

After a Devin CLI update, refresh the catalog (`platform/linux/refresh-models.sh`, `platform\windows\Refresh-Models.ps1`, or `npm run models:refresh`) and refresh Raft's model list. A changed binary or model list invalidates the cached catalog. The currently selected model also exposes its live thinking options.

## Configuration and proxy

Defaults discover Devin at the standard standalone install location — `%LOCALAPPDATA%\devin\cli\bin\devin.exe` on Windows, `~/.local/bin/devin` (plus its `_versions/current` target) on macOS/Linux — then PATH. Optional configuration is local to this checkout and ignored by Git:

```sh
platform/linux/install.sh --devin-exe /opt/devin/devin --proxy-url http://127.0.0.1:7890
```

```powershell
.\platform\windows\Install.ps1 -DevinExe 'C:\tools\devin\devin.exe' -ProxyUrl 'http://127.0.0.1:7890'
```

Or copy `adapter.config.example.json` to `adapter.config.json` and edit it. Use an empty proxy value to inherit the launch environment.

| Setting | Priority / behavior |
| --- | --- |
| Devin executable | `DEVIN_EXE` → local `devinExe` → standard install path → PATH |
| Proxy | `DEVIN_ADAPTER_PROXY` → local `proxyUrl` → inherited environment |
| Configuration file | `DEVIN_ADAPTER_CONFIG` → checkout's `adapter.config.json` |
| `defaultModel` | Fallback display ID if Devin omits its current model; native session settings take precedence |

An explicit proxy sets `HTTP_PROXY`, `HTTPS_PROXY`, and `ALL_PROXY` **for the Devin child process**. It does not start a proxy server, change the system proxy, or require a specific proxy application. Your proxy service must already be running. Without an explicit value, the child inherits the environment of the Raft Computer process; environment inheritance alone does not guarantee system-proxy routing. SOCKS support ultimately depends on the installed Devin CLI.

Local configuration persists across Raft updates because it lives outside Raft. This is separate from any global setting made by a proxy application. Do not commit proxy credentials or Devin account files.

## Update or uninstall

Stop agents using this checkout before rebuilding its launcher. Pull a reviewed update, rebuild (`platform/linux/build.sh` or `platform\windows\Build.ps1`), refresh models, then start the agents again. If you move the checkout or change Node installations, rebuild and reinstall from the new location.

Raft upgrades do not overwrite this directory, but changes in Raft's Grok integration or Devin's ACP protocol may require adapter updates. Test compatibility after upgrading either product. Use official Devin commands for Devin updates; Raft's Grok login/update controls target the Grok runtime.

```sh
platform/linux/uninstall.sh        # Linux
```

```powershell
.\platform\windows\Uninstall.ps1   # Windows
```

Uninstall removes this checkout's entry from PATH (the `~/.local/bin/grok` trampoline on Linux; the user PATH entry on Windows). It preserves source files, Devin sessions, and unrelated PATH entries. Restart the Computer or rescan runtimes to inherit the change, and stop or reconfigure agents using this slot. A previously migrated adapter entry is not automatically restored.

## Development and checks

```sh
npm ci
npm run check
npm test
platform/linux/build.sh          # or platform\windows\Build.ps1
platform/linux/test-adapter.sh --live   # or Test-Adapter.ps1 -Live
```

`npm test` uses a deterministic local ACP peer, with no account, network, model, or external tools. CI runs these protocol checks on Node 22/24 on Windows and Linux, builds both launchers, and smoke-tests the full chain through the built launcher against the fake peer. A separate job builds the Docker verification image without external downloads.

`--live` explicitly checks the real Devin SWE-2 Max, invalid-strength rejection, and Default/High behavior, without a model prompt. It needs a refreshed model catalog. Normal agent work uses your Devin account and credits.

### Docker development sandbox

A self-contained Linux environment (Node 22 + Devin CLI, optional Raft Computer) is provided for development and verification:

```sh
docker build -f docker/Dockerfile -t raft-devin-adapter .   # build verifies the whole chain
docker run --rm raft-devin-adapter                          # re-run the verification suite
docker run -it raft-devin-adapter bash                      # interactive shell
docker build -f docker/Dockerfile --build-arg INSTALL_RAFT=1 -t raft-devin-adapter .   # + raft-computer
```

The build runs offline protocol tests, builds the launcher, installs `grok` on PATH, and drives the same ACP sequence Raft uses — including a real `devin acp` handshake without inference. See [docs/docker.md](docs/docker.md) for authenticated testing (`DEVIN_API_KEY`) and connecting Raft Computer.

See [architecture](docs/architecture.md), [contributing](CONTRIBUTING.md), [docker](docs/docker.md), and [security reporting](SECURITY.md).

## License

[MIT](LICENSE). Raft, Devin, and Grok names belong to their respective owners. No vendor binaries, credentials, or copied Raft implementation files are distributed. Compatibility does not imply vendor endorsement.
