# Mutterings in a container: Node plus the two binaries the pipeline shells out
# to. Railway builds this file; AGENTS.md carries the deploy path.
FROM node:22-bookworm-slim

# yt-dlp comes from its own releases rather than a distro package. YouTube moves
# faster than a distro's package cycle, and a months-old yt-dlp starts answering
# 403. The URL is the current release, so a rebuild picks up whatever is newest.
# The checksum is checked because this downloads a binary over the network.
RUN apt-get update \
 && apt-get install --no-install-recommends -y ca-certificates curl ffmpeg \
 && curl -fsSL -o /tmp/yt-dlp_linux \
      https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
 && curl -fsSL -o /tmp/SHA2-256SUMS \
      https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS \
 && cd /tmp \
 && grep " yt-dlp_linux$" SHA2-256SUMS | sha256sum -c - \
 && install -m 0755 /tmp/yt-dlp_linux /usr/local/bin/yt-dlp \
 && rm -f /tmp/yt-dlp_linux /tmp/SHA2-256SUMS \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY server ./server

# Railway routes to the container, not to its loopback, so the server binds every
# interface here and keeps 127.0.0.1 for a local run. Railway sets PORT; the
# default is the one a local run uses.
ENV HOST=0.0.0.0
ENV PORT=5179

USER node
CMD ["npm", "start"]
