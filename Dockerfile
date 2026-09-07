# Fighters Guild DJ bot — needs glibc (the @livekit/rtc-node native addon is
# not built for musl), plus ffmpeg and yt-dlp on PATH.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    YTDLP_PATH=/usr/local/bin/yt-dlp \
    FFMPEG_PATH=/usr/bin/ffmpeg

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates curl \
 && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
 && chmod 0755 /usr/local/bin/yt-dlp \
 && chown node:node /usr/local/bin/yt-dlp \
 && apt-get purge -y curl \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src
RUN chown -R node:node /app
USER node

# Refresh yt-dlp on boot (extractors rot fast), then run.
CMD ["sh", "-c", "yt-dlp -U --quiet 2>/dev/null || true; exec node src/index.js"]
