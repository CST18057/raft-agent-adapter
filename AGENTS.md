# AGENTS.md

Guidance for coding agents working in this repository.

## Layout

- `src/`: the ACP adapter (`adapter.mjs`, `backends.mjs`, `model-config.mjs`, `config.mjs`, `rpc.mjs`).
- `test/`: offline protocol tests against deterministic fake peers.
- `scripts/`: model catalog refresh, live smoke test, and fake-peer configuration.
- `platform/`: Windows and Linux launchers, install, uninstall, and test scripts.
- `docker/`: Linux verification image and ACP probe.
- `docs/`: architecture, compatibility, and release notes.
- `me_raft-agent-adapter/`: maintains internal design documents and other tools.

## Verification

- `npm test`: offline suite. It needs no Devin login and sends no inference prompts.
- `npm run check`: syntax check of the adapter modules.
- `npm run models:refresh`: rebuilds the local model catalog from a logged-in Devin CLI. It sends no inference prompts.
- `npm run test:live`: live checks against a logged-in Devin CLI. Run these manually.

## Diagnostics

Read-only diagnostics cover the Devin ACP session surface:

- Model and configuration probes: model lists, thinking levels, and speed options for each model.
- Catalog consistency: comparing the local model catalog with live ACP responses.
- Mapping checks: confirming that a reasoning or speed choice applies and reads back on a session.

They open sessions and change session configuration only. They never send prompts.

## Conventions

- Use Conventional Commits (`feat`, `fix`, `docs`, `ci`, `chore`, and so on).
- Do not commit generated or account-specific files: `.local/`, `bin/`, `adapter.config.json`, `model-catalog.json`, or captured account data.
- Keep public documentation consistent with the Devin CLI version used for verification.
