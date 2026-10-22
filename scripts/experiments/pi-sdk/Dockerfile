ARG NOVEL_IMAGE=localhost/ts-novel-spider:pi-validation-base
FROM ${NOVEL_IMAGE}
WORKDIR /app/pi-validation
COPY scripts/experiments/pi-sdk/package.json scripts/experiments/pi-sdk/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY scripts/experiments/pi-sdk/smoke.mjs ./
RUN npm run smoke
WORKDIR /app
