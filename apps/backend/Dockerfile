# syntax=docker/dockerfile:1.7
#
# Образ бэкенда. Контекст сборки — КОРЕНЬ монорепозитория:
#   docker build -f apps/backend/Dockerfile .
#
# Три цели:
#   runtime   — api и worker (только production-зависимости)
#   migrator  — одноразовый контейнер `prisma migrate deploy` (нужен Prisma CLI из devDependencies)
#
# Базовый образ — Debian slim, а не Alpine: argon2 собирается нативно, а Prisma
# под musl требует отдельного binaryTarget. glibc снимает оба вопроса.
ARG NODE_IMAGE=node:20-bookworm-slim

# ═══════════════════════════════════════════════════════════════════
# deps — установка всех зависимостей (включая dev: tsc, prisma CLI)
# ═══════════════════════════════════════════════════════════════════
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false NPM_CONFIG_UPDATE_NOTIFIER=false

# python3/make/g++ — на случай, если под платформу нет готового prebuild для argon2
# и prebuild-install откатится на сборку из исходников.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/*

# Манифесты отдельным слоем — переустановка только при изменении зависимостей.
# package.json всех воркспейсов обязателен: npm ci сверяет их с lock-файлом.
COPY package.json package-lock.json ./
COPY packages/shared/package.json  packages/shared/
COPY apps/backend/package.json     apps/backend/
COPY apps/frontend/package.json    apps/frontend/

# Фронтенд не ставим: -w выбирает только нужные воркспейсы.
RUN npm ci --include-workspace-root -w @edu/shared -w @edu/backend

# ═══════════════════════════════════════════════════════════════════
# build — сборка @edu/shared, генерация Prisma Client, компиляция бэкенда
# ═══════════════════════════════════════════════════════════════════
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/backend    ./apps/backend

RUN npm run build      --workspace @edu/shared \
 && npm run db:generate --workspace @edu/backend \
 && npm run build      --workspace @edu/backend

# ═══════════════════════════════════════════════════════════════════
# prod-deps — чистая установка только production-зависимостей
# ═══════════════════════════════════════════════════════════════════
# Отдельный слой вместо `npm prune`: prune может задеть сгенерированный
# Prisma Client в node_modules/.prisma. Здесь дерево детерминировано,
# а клиент кладём следующим шагом из build.
FROM deps AS prod-deps
RUN npm ci --omit=dev --include-workspace-root -w @edu/shared -w @edu/backend

# ═══════════════════════════════════════════════════════════════════
# runtime — образ для api и worker
# ═══════════════════════════════════════════════════════════════════
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app

# openssl — обязателен для Prisma Query Engine на slim-образах
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=prod-deps /app/node_modules                ./node_modules
# Сгенерированный Prisma Client (его нет в чистой prod-установке)
COPY --from=build     /app/node_modules/.prisma        ./node_modules/.prisma

COPY --from=build /app/package.json                    ./package.json
COPY --from=build /app/packages/shared/package.json    ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist            ./packages/shared/dist
COPY --from=build /app/apps/backend/package.json       ./apps/backend/package.json
COPY --from=build /app/apps/backend/dist               ./apps/backend/dist
# DejaVuSans.ttf для PDF-сертификатов: certificate.service.ts резолвит его
# как ../../../assets/fonts относительно своего файла в dist/ (см. FONT_PATH).
COPY --from=build /app/apps/backend/assets             ./apps/backend/assets
COPY deploy/healthcheck.mjs                            ./deploy/healthcheck.mjs

USER node
WORKDIR /app/apps/backend
EXPOSE 4000

# Обработку SIGTERM (graceful shutdown) делает сам Node — см. server.ts/worker.ts.
# PID 1 отдаём docker-init (`init: true` в compose).
CMD ["node", "dist/server.js"]

# ═══════════════════════════════════════════════════════════════════
# migrator — одноразовый контейнер миграций
# ═══════════════════════════════════════════════════════════════════
# Отдельная цель, потому что `prisma migrate deploy` требует Prisma CLI,
# а это devDependency: в runtime её быть не должно.
FROM build AS migrator
# Разовые операции обслуживания (создание первого администратора)
COPY deploy/create-admin.mjs /app/deploy/create-admin.mjs
WORKDIR /app/apps/backend
USER node
CMD ["npx", "--no-install", "prisma", "migrate", "deploy"]
