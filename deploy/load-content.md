# Загрузка контента курса на прод

Скрипты собираются в образ (`dist/scripts/*.js`) и запускаются одноразовым
контейнером. Все они **идемпотентны**: повторный запуск ничего не дублирует,
существующие материалы, видео и прогресс студентов не трогаются.

Каждый скрипт по умолчанию работает в режиме **предпросмотра** — пишет, что
изменится, и ничего не меняет. Запись включает флаг `--apply`.

## 0. Файлы с контентом

На сервер нужны два файла (в git их нет — это материалы вуза):

| Файл | Что это |
|---|---|
| `docs/media/lectures15.json` | расшифровки 15 лекций × 3 языка (результат `scripts/extract_lectures.py`) |
| `docs/media/lecture-videos.csv` | YouTube-ссылки: `lecture,language,url` |

```bash
# с рабочей машины
scp docs/media/lectures15.json docs/media/lecture-videos.csv root@89.35.124.197:/opt/eduopen/content/
```

## 1. Лекции 11–15 (разделы IV–V)

Добавляет модули и лекции в существующий курс, не пересоздавая его.

```bash
cd /opt/eduopen
docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm \
  -v /opt/eduopen/content:/content:ro api \
  node dist/scripts/add-lectures.js /content/lectures15.json --from 11          # предпросмотр
# затем то же с --apply
```

## 2. YouTube-ссылки

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm \
  -v /opt/eduopen/content:/content:ro api \
  node dist/scripts/set-lecture-videos.js /content/lecture-videos.csv --apply
```

Проверка: в конце печатает «Лекций всё ещё с заглушкой: 0».

## 3. Чистка артефактов .docx (необязательно)

Убирает из расшифровок мусор исходников («Show more», служебные инструкции,
иноязычные «хвосты»).

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm api \
  node dist/scripts/clean-transcripts.js --apply
```

## 4. Генерация материалов (тесты и мини-квизы)

Запускается через API менеджером курса — фоновые задачи (FR-7.1).
Требует рабочий `ANTHROPIC_API_KEY` в `.env.prod`.

```bash
TOKEN=$(curl -s https://eduopen.kz/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"<менеджер>","password":"<пароль>"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["accessToken"])')

# id языковых версий курса
curl -s https://eduopen.kz/api/courses -H "Authorization: Bearer $TOKEN"

# для каждой версии: тесты модулей, затем мини-квизы
for V in <id_ru> <id_kk> <id_en>; do
  for T in QUIZ MINI; do
    curl -s -X POST https://eduopen.kz/api/language-versions/$V/generate \
      -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
      -d "{\"type\":\"$T\",\"regenStrategy\":\"KEEP\"}"
  done
done
```

Статус: `GET /api/generation-jobs/<jobId>`. Стратегия `KEEP` не перезаписывает
уже готовые материалы и ручные правки менеджера (FR-7.5).

## 5. Публикация

Публиковать можно только версию, где у каждой лекции есть видео и расшифровка,
а у каждого модуля — готовое оценивание (валидация FR-2.9).

```bash
curl -s -X POST https://eduopen.kz/api/language-versions/<id>/publish \
  -H "Authorization: Bearer $TOKEN"
```
