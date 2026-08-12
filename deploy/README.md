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
| Домен | A-запись на этот сервер **до** первого запуска | Caddy выпускает сертификат при старте |
| Юрисдикция | площадка в РК | DP-2 §13, см. [COMPLIANCE.md](../COMPLIANCE.md) |

Нужны Docker Engine 24+ и Docker Compose v2.24+.

### Целевой сервер

`89.35.124.197` — `country: KZ`, `HOSTERKZ-NETWORK`, Караганда. Требование
DP-2 §13 о размещении данных в РК выполняется. Порты 80/443 свободны.

### Переключение DNS eduopen.kz

Записи ведёт hoster.kz (`ns1–ns3.hoster.kz`), TTL 3600 — после правки ждать до
часа. CAA-записи нет, Let's Encrypt не заблокирован.

**На домене работает почта.** Менять можно только три записи:

| Имя | Тип | Значение | Действие |
|---|---|---|---|
| `@` | A | `89.35.124.197` | изменить (было `185.98.5.127`) |
| `www` | A | `89.35.124.197` | изменить (было `185.98.5.127`) |
| `webmail` | CNAME → `eduopen.kz` | заменить на **A** `185.98.5.127` | иначе уедет вместе с apex и сломается |
| `mail` | A | `185.98.5.127` | **не трогать** |
| `@` | MX | `10 mail.eduopen.kz` | **не трогать** |
| `@` | TXT | `v=spf1 include:_spf.hoster.kz ~all` | **не трогать** |

Почтовый сервер на `185.98.5.127` живой (открыты 25/143/465/587/993). Если при
редактировании панель предложит пересоздать зону — не соглашаться вслепую:
пересоздание сносит MX и SPF, и почта перестанет ходить в обе стороны.

Проверка после правки:

```bash
dig +short eduopen.kz A        # 89.35.124.197
dig +short mail.eduopen.kz A   # 185.98.5.127 — должно остаться
dig +short eduopen.kz MX       # 10 mail.eduopen.kz. — должно остаться
```

Запускать стенд только после того, как `dig` покажет новый адрес: Caddy
проходит ACME-проверку при старте.

## 2. Доставка кода на сервер

Репозиторий приватный, поэтому серверу нужен ключ на чтение (deploy key).
Он привязан к одному репозиторию и не даёт доступа к остальному аккаунту.

```bash
ssh root@89.35.124.197

ssh-keygen -t ed25519 -f /root/.ssh/id_ed25519_deploy -N "" -C "eduopen-deploy"
cat /root/.ssh/id_ed25519_deploy.pub
```

Вывод добавить в GitHub: репозиторий → **Settings → Deploy keys → Add deploy
key**. Title — `eduopen-prod`, «Allow write access» **не включать**: серверу
нужно только читать.

```bash
cat >> /root/.ssh/config <<'EOF'
Host github.com
  User git
  IdentityFile /root/.ssh/id_ed25519_deploy
  IdentitiesOnly yes
EOF
chmod 600 /root/.ssh/config

ssh -T git@github.com   # должно поздороваться названием репозитория
git clone git@github.com:sdklover1-800/coursesupusioter.git /opt/edu-platform
cd /opt/edu-platform
```

## 3. Конфигурация

```bash
cp .env.prod.example .env.prod
chmod 600 .env.prod
```

Домен уже проставлен (`SITE_ADDRESS=eduopen.kz`, `WWW_ADDRESS=www.eduopen.kz`,
`FRONTEND_ORIGIN=https://eduopen.kz`). Заполнить нужно секреты и почту:
`ACME_EMAIL`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET`, `COOKIE_SECRET`, `ANTHROPIC_API_KEY`.

```bash
# Секреты (каждый — отдельным вызовом)
openssl rand -base64 48
```

`LLM_PROVIDER=mock` на проде недопустим — студенты получат заглушки вместо диалога.

## 4. Запуск

Флаг `--env-file` обязателен: без него compose подставит переменные из dev'ового
`.env` в корне репозитория.

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

Порядок гарантирован зависимостями: `postgres`/`redis` → healthy → `migrate`
(`prisma migrate deploy`) → completed → `api` и `worker` → api healthy → `web`.

### Если стенд придётся ставить за чужим прокси

Выбран отдельный сервер со свободными портами, поэтому Caddy терминирует TLS
сам. Если когда-нибудь платформа переедет за внешний nginx/Plesk/балансировщик,
нужны три правки: `SITE_ADDRESS=:80`, публикация порта `web` как
`"127.0.0.1:8080:80"`, и удаление **обеих** строк `header_up X-Forwarded-For
{remote_host}` из `deploy/Caddyfile` — иначе IP клиента, присланный внешним
прокси, затрётся, и rate-limit станет общим на весь сервер вместо «на клиента».

Чтобы не писать флаги каждый раз:

```bash
export COMPOSE_ENV_FILES=.env.prod
export COMPOSE_FILE=docker-compose.prod.yml
```

## 5. Первый администратор

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

## 6. Обновление версии

```bash
# с рабочей машины
git push

# на сервере
cd /opt/edu-platform
git pull
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

`.env.prod` в репозитории нет (закрыт `.gitignore`) — он живёт только на
сервере и `git pull` его не трогает.

`migrate` отрабатывает до перезапуска api и worker. Откат — на предыдущий тег
образа (`APP_VERSION` в `.env.prod`); учтите, что применённые миграции
Prisma назад не откатываются автоматически.

Сборка идёт под архитектуру сервера. Если собираете образы на Mac с Apple
Silicon для сервера x86, добавьте `--platform linux/amd64` или собирайте на
самом сервере.

## 7. Эксплуатация

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

## 8. Резервные копии

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

## 9. Что осознанно не сделано

- **Единственный сервер.** Горизонтального масштабирования нет; api stateless,
  так что при росте нагрузки добавляются реплики api за тем же Caddy, а Postgres
  и Redis выносятся на отдельные машины.
- **Дампы не шифруются автоматически.** Ключ шифрования на том же сервере, что и
  данные, защищает только от утечки резервной копии, но требует управления
  ключами — выбор оставлен эксплуатации.
- **Секреты в файле, а не в менеджере секретов.** Для одного сервера `.env.prod`
  с правами 600 — адекватный уровень; при переезде в кластер заменяется на
  Docker/Vault secrets.
