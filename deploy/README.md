# Развёртывание прода

Стенд поднимается одним `docker compose` на одном сервере: Postgres, Redis, API,
воркер BullMQ, Caddy с автоматическим TLS и сервис резервного копирования.

```
                    ┌─────────── сеть edge ───────────┐
   Интернет ──443──▶│  web (Caddy)  ──▶  api (Fastify) │
                    └──────────────────────┬───────────┘
                    ┌────────── сеть core ─┴───────────┐
                    │  postgres   redis   worker       │
                    │  migrate (одноразовый)  backup   │
                    └──────────────────────────────────┘
```

Postgres и Redis не публикуют портов и не подключены к сети `edge`.

---

## 1. Требования к серверу

| Что | Минимум | Почему |
|---|---|---|
| CPU / RAM | 2 vCPU / 4 ГБ | api и worker по 1 ГБ лимита + Postgres |
| Диск | 40 ГБ SSD | БД, транскрипты диалогов, 14 дней дампов |
| Порты | 80, 443 (TCP+UDP) | ACME-проверка и HTTP/3 |
| Домен | A/AAAA на этот сервер **до** первого запуска | Caddy выпускает сертификат при старте |
| Юрисдикция | площадка в РК | DP-2 §13, см. [COMPLIANCE.md](../COMPLIANCE.md) |

Нужны Docker Engine 24+ и Docker Compose v2.24+.

## 2. Конфигурация

```bash
cp .env.prod.example .env.prod
chmod 600 .env.prod
```

Заполнить обязательное: `SITE_ADDRESS`, `ACME_EMAIL`, `FRONTEND_ORIGIN`,
`POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
`COOKIE_SECRET`, `ANTHROPIC_API_KEY`.

```bash
# Секреты (каждый — отдельным вызовом)
openssl rand -base64 48
```

`LLM_PROVIDER=mock` на проде недопустим — студенты получат заглушки вместо диалога.

## 3. Запуск

Флаг `--env-file` обязателен: без него compose подставит переменные из dev'ового
`.env` в корне репозитория.

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

Порядок гарантирован зависимостями: `postgres`/`redis` → healthy → `migrate`
(`prisma migrate deploy`) → completed → `api` и `worker` → api healthy → `web`.

Чтобы не писать флаги каждый раз:

```bash
export COMPOSE_ENV_FILES=.env.prod
export COMPOSE_FILE=docker-compose.prod.yml
```

## 4. Первый администратор

`prisma/seed.ts` — dev-сид: он заводит демо-аккаунты с публично известными
паролями (`Admin123!` и т.п.). **На проде его запускать нельзя.**
Первый администратор создаётся отдельной командой:

```bash
read -rs ADMIN_PASSWORD   # ввод не отображается и не попадает в history
docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm \
  -e ADMIN_EMAIL=admin@esil.edu.kz \
  -e ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  migrate node /app/deploy/create-admin.mjs
unset ADMIN_PASSWORD
```

Дальше пользователи заводятся через интерфейс (`POST /api/admin/users`) или
импортом CSV/Excel. Повторный запуск команды сбрасывает пароль администратора.

## 5. Обновление версии

```bash
git pull
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

`migrate` отрабатывает до перезапуска api и worker. Откат — на предыдущий тег
образа (`APP_VERSION` в `.env.prod`); учтите, что применённые миграции
Prisma назад не откатываются автоматически.

Сборка идёт под архитектуру сервера. Если собираете образы на Mac с Apple
Silicon для сервера x86, добавьте `--platform linux/amd64` или собирайте на
самом сервере.

## 6. Эксплуатация

```bash
# Статус и здоровье
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
curl -s https://$SITE_ADDRESS/health | jq

# Логи
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f api worker

# psql
docker compose --env-file .env.prod -f docker-compose.prod.yml exec postgres \
  psql -U edu -d edu_platform

# Метрики Prometheus (наружу закрыты Caddy'ем — только изнутри сети)
docker compose --env-file .env.prod -f docker-compose.prod.yml exec api \
  node -e "fetch('http://127.0.0.1:4000/metrics').then(r=>r.text()).then(console.log)"
```

## 7. Резервные копии

Сервис `backup` раз в сутки делает `pg_dump | gzip` в `./backups` и удаляет
дампы старше 14 дней (`BACKUP_INTERVAL_SECONDS`, `BACKUP_KEEP_DAYS`).

**Дампы содержат персональные данные студентов и транскрипты диалогов.**
Каталог должен быть `chmod 700`, а при выносе за пределы сервера — зашифрован:

```bash
age -r <ключ> backups/edu_20260811T030000Z.sql.gz > /вне/сервера/edu.sql.gz.age
```

Восстановление:

```bash
gunzip -c backups/edu_20260811T030000Z.sql.gz | \
  docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T postgres \
  psql -U edu -d edu_platform
```

Проверяйте восстановление на копии стенда хотя бы раз в семестр — непроверенный
бэкап не является бэкапом.

## 8. Что осознанно не сделано

- **Единственный сервер.** Горизонтального масштабирования нет; api stateless,
  так что при росте нагрузки добавляются реплики api за тем же Caddy, а Postgres
  и Redis выносятся на отдельные машины.
- **Дампы не шифруются автоматически.** Ключ шифрования на том же сервере, что и
  данные, защищает только от утечки резервной копии, но требует управления
  ключами — выбор оставлен эксплуатации.
- **Секреты в файле, а не в менеджере секретов.** Для одного сервера `.env.prod`
  с правами 600 — адекватный уровень; при переезде в кластер заменяется на
  Docker/Vault secrets.
