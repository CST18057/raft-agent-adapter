# Docker development sandbox

A self-contained Linux image for developing and verifying the adapter. Building the image already runs the whole verification suite, so a green `docker build` is itself the proof.

```sh
docker build -f docker/Dockerfile -t raft-devin-adapter .
```

## What the image contains

- **Node.js 22** on Debian bookworm-slim, with git and curl.
- **Devin CLI** installed through the official `cli.devin.ai` installer at `~/.local/bin/devin` (`INSTALL_DEVIN=0` skips it).
- **Raft Computer** optionally (`--build-arg INSTALL_RAFT=1`) at `~/.local/bin/raft-computer` — connecting it to a server requires the interactive `raft-computer setup /<serverSlug>` device-approval flow.
- This checkout copied to `/opt/raft-devin-adapter`.

## Verification suite

`docker/verify.sh` runs at image build and via the default CMD:

1. `platform/linux/build.sh` — generates `bin/grok`.
2. `npm run check` + `npm test` — syntax and offline protocol tests.
3. Launcher smoke through `bin/grok` against the deterministic fake ACP peer.
4. `platform/linux/install.sh` — `grok` lands on PATH at `~/.local/bin/grok`.
5. `docker/probe.mjs --via-path` — spawns PATH `grok` with Raft's real launch arguments (`agent --no-leader --always-approve stdio`) and drives `initialize → session/new → session/set_model → session/load → session/delete`.
6. Uninstall/reinstall cycle check.
7. If Devin CLI is installed: the same probe against the real `devin acp` binary (no inference; unauthenticated sessions have an empty model list).

```sh
docker run --rm raft-devin-adapter           # re-run the suite
docker run -it raft-devin-adapter bash       # interactive shell in the env
```

## Authenticated testing

Export a Devin API key to have the probe call `authenticate` before opening a session — mirroring what an auth-aware ACP host does:

```sh
docker run --rm -e DEVIN_API_KEY=apk_... raft-devin-adapter
```

Or open a shell and log in the normal way (uses local credentials in `devin acp`):

```sh
docker run -it raft-devin-adapter bash
devin setup                     # device/browser login
npm run models:refresh          # real model + thinking catalog
platform/linux/test-adapter.sh --live
```

Normal agent work consumes your Devin account credits; the checks above only perform handshake and configuration calls.

## Raft Computer inside the container

```sh
docker build -f docker/Dockerfile --build-arg INSTALL_RAFT=1 -t raft-devin-adapter .
docker run -it raft-devin-adapter bash
raft-computer setup /<your-server-slug>   # browser/device approval, interactive
raft-computer start /<your-server-slug>
raft-computer status                      # service + attachment state
raft-computer doctor                      # connection health
```

Once the service is attached and running, Raft's runtime detection resolves `grok` via `which` and the `~/.local/bin` fallback — both are satisfied by `platform/linux/install.sh`. This exact path was exercised end-to-end: `attach` → runtime detection → `runtime_models:detect` → internal agent on Grok Build → `agent:start` → real inference reply in a DM. Note the container is ephemeral, so Devin sessions live only as long as the filesystem.

## Files

| File | Purpose |
| --- | --- |
| `docker/Dockerfile` | Image definition; build args `INSTALL_DEVIN`, `INSTALL_RAFT` |
| `docker/verify.sh` | Ordered verification suite (POSIX sh, runs on any Linux checkout too) |
| `docker/probe.mjs` | ACP client mirroring the Raft daemon's Grok call sequence |
