FROM node:22-bookworm-slim AS build-base

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM build-base AS web-builder

COPY tsconfig.json tsconfig.server.json ./
COPY src ./src

RUN npm run build:web

FROM build-base AS server-builder

COPY tsconfig.json tsconfig.server.json ./
COPY src ./src

RUN npm run build:server

FROM build-base AS production-deps

RUN npm prune --omit=dev \
  && npm cache clean --force

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app

COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=server-builder /app/dist/server ./dist/server
COPY --from=web-builder /app/dist/web ./dist/web

RUN mkdir -p /app/.data /app/data/exports /app/data/offline-assets

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT ?? 3000}/api/health`).then((response) => { if (!response.ok) { process.exit(1); } }).catch(() => process.exit(1))"]

CMD ["node", "dist/server/index.js"]
