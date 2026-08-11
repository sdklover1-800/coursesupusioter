# syntax=docker/dockerfile:1.7
#
# Образ веб-слоя: собранный SPA внутри Caddy. Контекст сборки — КОРЕНЬ монорепозитория:
#   docker build -f apps/frontend/Dockerfile .
#
# Фронтенд ходит в API по относительному пути /api (VITE_*-переменных нет),
# поэтому статику и API обязан отдавать один origin — это делает Caddy.
ARG NODE_IMAGE=node:20-bookworm-slim

# ═══════════════════════════════════════════════════════════════════
# build — vite build
# ═══════════════════════════════════════════════════════════════════
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false NPM_CONFIG_UPDATE_NOTIFIER=false

COPY package.json package-lock.json ./
COPY packages/shared/package.json  packages/shared/
COPY apps/backend/package.json     apps/backend/
COPY apps/frontend/package.json    apps/frontend/

# Бэкенд не ставим — argon2/prisma для сборки SPA не нужны.
RUN npm ci --include-workspace-root -w @edu/shared -w @edu/frontend

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/frontend   ./apps/frontend

# @edu/shared резолвится через workspace-симлинк на dist — собираем его первым.
RUN npm run build --workspace @edu/shared \
 && npm run build --workspace @edu/frontend

# ═══════════════════════════════════════════════════════════════════
# runtime — Caddy со статикой
# ═══════════════════════════════════════════════════════════════════
FROM caddy:2-alpine AS runtime
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/frontend/dist /srv

EXPOSE 80 443
