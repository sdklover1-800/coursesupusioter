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

## 3.5. Перенос итогового практического в последний модуль

Нужен один раз после добавления разделов IV–V: практическое «на весь курс»
осталось в разделе III с тех пор, когда модулей было три. Скрипт переносит его
в последний модуль, сохраняя id задания (сессии студентов не рвутся), а
освободившийся модуль переводит в тип QUIZ.

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm api \
  node dist/scripts/move-final-practical.js            # предпросмотр
# затем то же с --apply
```

## 4. Генерация материалов (тесты и мини-квизы)

Одной командой — ставит задачи по всем языковым версиям и ждёт результата.
Требует рабочий ключ провайдера LLM в `.env.prod` (`OPENAI_API_KEY` при `LLM_PROVIDER=openai`;
проверка — `node dist/scripts/llm-ping.js`) и поднятый сервис `worker`.

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm api \
  node dist/scripts/generate-materials.js --regen-practical
```

Стратегия `KEEP`: догенерируется только недостающее, готовые материалы и ручные
правки менеджера не затрагиваются (FR-7.5) — команду можно повторять.
Флаг `--regen-practical` перегенерирует итоговое практическое (`OVERWRITE`),
чтобы эталон охватывал все 15 лекций, а не только те, что были при первой генерации.

<details>
<summary>То же вручную через API</summary>

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

Статус: `GET /api/generation-jobs/<jobId>`.

</details>

## 5. Публикация

Публиковать можно только версию, где у каждой лекции есть видео и расшифровка,
а у каждого модуля — готовое оценивание (валидация FR-2.9).

```bash
curl -s -X POST https://eduopen.kz/api/language-versions/<id>/publish \
  -H "Authorization: Bearer $TOKEN"
```
