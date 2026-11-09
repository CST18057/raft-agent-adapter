# Contributing / 贡献说明

Bug reports, compatibility checks, focused fixes, and documentation improvements are welcome. English and Chinese issues are both welcome.

欢迎提交问题、兼容性验证、聚焦的修复和文档改进，可以使用中文或英文交流。

Before a change, read the [architecture](docs/architecture.md) and [known limits](docs/compatibility.md). Keep protocol work independent of proprietary source or binaries. Please avoid committing local account data, generated catalogs, compiled launchers, or agent transcripts.

```sh
npm ci
npm run check
npm test
```

Platform entry points live under `platform/windows/` (PowerShell + `Launcher.cs`) and `platform/linux/` (POSIX shell). Rebuild the launcher with `platform/linux/build.sh` or `platform\windows\Build.ps1` when changing launch or install logic. A Docker development/verification image lives in `docker/` — `docker build -f docker/Dockerfile .` runs the full offline suite plus a real-CLI handshake; see [docs/docker.md](docs/docker.md).

Tests should check observable protocol behavior, using the local fake peer. `scripts/fake-peer-config.mjs` writes a config that makes any launcher-level check run without an account. Real model calls are optional, consume the contributor's account credits, and must never become required CI steps. Native configuration-only checks are available through `platform/linux/test-adapter.sh --live` or `platform\windows\Test-Adapter.ps1 -Live` after installation and model refresh.

A useful pull request explains the user-visible problem, resulting behavior, relevant versions, and checks performed. Update both READMEs for user-facing changes. Report security concerns using [SECURITY.md](SECURITY.md).

By contributing, you agree that your contribution can be distributed under this repository's MIT license. Please submit only work you are entitled to contribute.
