FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app
COPY package.json ./
COPY server ./server

ENV NODE_ENV=production
ENV HOST=0.0.0.0

CMD ["node", "server/index.js"]
