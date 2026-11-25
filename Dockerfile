# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS base
WORKDIR /app

FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_BUILD_CPUS=1
COPY package.json package-lock.json ./
# Native SQLite is only used by the legacy local runner.
RUN --mount=type=cache,target=/root/.npm npm ci --include=dev --ignore-scripts --no-audit --no-fund
COPY next.config.ts tsconfig*.json ./
COPY src ./src
COPY public ./public
COPY server ./server
RUN --mount=type=cache,target=/root/.npm npm run build \
    && node -e "require('node:fs').rmSync('.next/cache', {recursive: true, force: true})" \
    && npm ci --omit=dev --prefer-offline --ignore-scripts --no-audit --no-fund

FROM base AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080
COPY --from=build /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/public ./public
COPY --from=build /app/package.json /app/next.config.ts /app/tsconfig*.json ./
COPY migrations ./migrations
COPY scripts/start-production.mjs ./scripts/
USER node
EXPOSE 8080
HEALTHCHECK --start-period=60s --interval=15s --timeout=5s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health', {signal: AbortSignal.timeout(4000)}).then(async r => { if (r.status !== 200 || (await r.json()).status !== 'ok') process.exitCode = 1 }).catch(() => { process.exitCode = 1 })"]
CMD ["node", "scripts/start-production.mjs"]
