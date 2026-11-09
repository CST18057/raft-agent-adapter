# Development and verification image for raft-devin-adapter on Linux.
#
#   docker build -f docker/Dockerfile -t raft-devin-adapter .
#   docker build -f docker/Dockerfile --build-arg INSTALL_RAFT=1 -t raft-devin-adapter .
#   docker run --rm raft-devin-adapter                      # re-run the verification suite
#   docker run --rm -e DEVIN_API_KEY=apk_... raft-devin-adapter   # authenticate first
#   docker run -it raft-devin-adapter bash                  # interactive shell
#
# The build itself runs docker/verify.sh, so a successful build already proves
# the offline protocol tests, the generated launcher, PATH installation, and
# the end-to-end bridge chain.

FROM node:22-bookworm-slim

ARG INSTALL_DEVIN=1
ARG INSTALL_RAFT=0

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git \
 && rm -rf /var/lib/apt/lists/*

# Standalone Devin CLI via the official installer. `devin setup` is skipped
# implicitly: without a TTY it reports "Login canceled" after installing the
# binary, so the run tolerates that step and verifies the binary directly.
RUN if [ "$INSTALL_DEVIN" = "1" ]; then \
      curl -fsSL https://cli.devin.ai/install.sh -o /tmp/devin-install.sh \
      && (bash /tmp/devin-install.sh || true) \
      && rm /tmp/devin-install.sh \
      && test -x /root/.local/bin/devin \
      && /root/.local/bin/devin --version; \
    fi

# Optional Raft Computer service (musl static build). Connecting it to a
# server is an interactive device-approval flow: `raft-computer setup /<slug>`.
RUN if [ "$INSTALL_RAFT" = "1" ]; then \
      curl -fsSL https://cdn.raft.build/computer/install.sh | sh \
      && /root/.local/bin/raft-computer --version; \
    fi

ENV PATH=/root/.local/bin:$PATH
WORKDIR /opt/raft-devin-adapter

COPY package.json adapter.config.example.json ./
COPY src ./src
COPY scripts ./scripts
COPY test ./test
COPY platform ./platform
COPY docker ./docker

RUN sh docker/verify.sh

CMD ["sh", "docker/verify.sh"]
