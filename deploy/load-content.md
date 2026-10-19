# Загрузка контента курса на прод

Скрипты собираются в образ (`dist/scripts/*.js`) и запускаются одноразовым
контейнером. Все они **идемпотентны**: повторный запуск ничего не дублирует,
существующие материалы, видео и прогресс студентов не трогаются.

Большинство скриптов по умолчанию работает в режиме **предпросмотра** — пишет,
что изменится, и ничего не меняет. Запись включает флаг `--apply`.

Репозиторий на сервере — `/root/coursesupusioter` (оттуда запущен compose).
Команды ниже выполняются в этом каталоге; для краткости:

```bash
cd /root/coursesupusioter
C="docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm -T -v /root/eduopen-content:/content:ro api"
```

## 0. Файлы с контентом

На сервер нужны два файла (в git их нет — это материалы вуза):

| Файл | Что это |
|---|---|
| `docs/media/lectures15.json` | расшифровки 15 лекций × 3 языка (результат `scripts/extract_lectures.py`) |
| `docs/media/lecture-videos.csv` | YouTube-ссылки: `lecture,language,url` |

```bash
# с рабочей машины
ssh root@89.35.124.197 'mkdir -p /root/eduopen-content'
scp docs/media/lectures15.json docs/media/lecture-videos.csv root@89.35.124.197:/root/eduopen-content/
# контейнер работает не от root — каталог должен читаться всеми
ssh root@89.35.124.197 'chmod 755 /root/eduopen-content && chmod 644 /root/eduopen-content/*'
```

## 1. Курс и лекции

**Пустая база** (первая загрузка) — создаёт курс сразу со всеми 15 лекциями
в 5 разделах; итоговое практическое — в последнем разделе:

```bash
$C node dist/scripts/import-lectures.js /content/lectures15.json
```

**Курс уже есть с лекциями 1–10** — добавляет разделы IV–V, не пересоздавая курс,
затем переносит итоговое практическое в последний модуль (id задания сохраняется,
сессии студентов не рвутся; освободившийся модуль становится QUIZ):

```bash
$C node dist/scripts/add-lectures.js /content/lectures15.json --from 11          # предпросмотр, затем --apply
$C node dist/scripts/move-final-practical.js                                     # предпросмотр, затем --apply
```

## 2. YouTube-ссылки

```bash
$C node dist/scripts/set-lecture-videos.js /content/lecture-videos.csv --apply
```

Проверка: в конце печатает «Лекций всё ещё с заглушкой: 0».

## 3. Чистка артефактов .docx

Убирает из расшифровок мусор исходников («Show more», служебные инструкции,
иноязычные «хвосты»). По умолчанию — курс «Введение в политологию»; другой курс —
`--course "…"`, все курсы — `--all`.

```bash
$C node dist/scripts/clean-transcripts.js            # предпросмотр
$C node dist/scripts/clean-transcripts.js --apply
```

## 4. Генерация материалов (тесты, мини-квизы, практическое)

Одной командой — ставит задачи по всем языковым версиям и ждёт результата
(~5 минут на весь курс). Требует рабочий ключ провайдера LLM в `.env.prod`
(`OPENAI_API_KEY` при `LLM_PROVIDER=openai`) и поднятый сервис `worker`.
Сначала проверьте ключ:

```bash
$C node dist/scripts/llm-ping.js
$C node dist/scripts/generate-materials.js --regen-practical
```

Стратегия `KEEP`: догенерируется только недостающее, готовые материалы и ручные
правки менеджера не затрагиваются (FR-7.5) — команду можно повторять.
Флаг `--regen-practical` генерирует итоговое практическое (`OVERWRITE`) — при первой
загрузке он обязателен, иначе практического не будет. `--lang ru` ограничивает
одной языковой версией — чтобы повторить упавшую задачу.

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
а у каждого модуля — готовое оценивание (валидация FR-2.9, та же, что в API).

```bash
$C node dist/scripts/publish-course.js            # что готово и что мешает
$C node dist/scripts/publish-course.js --apply
```

Через API (нужен пароль менеджера): `POST /api/language-versions/<id>/publish`.

## 6. Курс «Введение в философию»

Те же скрипты с `--course "Введение в философию"` (без него — политология). Источник —
`.docx` автора в `docs/phil` (по файлу на лекцию и язык, в git их нет); JSON собирается
на рабочей машине:

```bash
python3 scripts/extract_philosophy.py      # docs/phil → docs/media/philosophy15.json
scp docs/media/philosophy15.json docs/media/philosophy-videos.csv root@89.35.124.197:/root/eduopen-content/
ssh root@89.35.124.197 'chmod 644 /root/eduopen-content/*'
```

На сервере — сначала резервная копия (`apps/backend/src/scripts/content/README.md`), затем:

```bash
$C node dist/scripts/import-lectures.js /content/philosophy15.json   # DRAFT: 5 разделов × 3 лекции, ru/kk/en; л.4 kk/en и л.14 en — с пустой расшифровкой
$C node dist/scripts/set-lecture-videos.js /content/philosophy-videos.csv --course "Введение в философию"   # предпросмотр (обновлений 45), затем --apply
$C node dist/scripts/clean-transcripts.js --course "Введение в философию"   # ожидается 0 изменений
```

Расшифровок лекций 4 (kk, en) и 14 (en) автор не прислал — по решению от 19.10 их перевели с ru
(`translate-transcripts.js --draft` через LLM на рабочей машине, затем вычитка редактором).
Проверенный перевод закоммичен — `apps/backend/content-data/philosophy/translations.v1.json` — и
применяется без LLM контент-скриптом (каталог `content-data` монтируется в контейнер):

```bash
CC="docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm -T \
   -v /root/coursesupusioter/apps/backend/content-data:/app/apps/backend/content-data:ro api"
$CC node dist/scripts/content/translate-transcripts.js --course "Введение в философию" --from translations.v1.json   # предпросмотр: would-change 3
$CC node dist/scripts/content/translate-transcripts.js --course "Введение в философию" --from translations.v1.json --apply --i-have-a-backup
$C node dist/scripts/publish-course.js --course "Введение в философию"      # только предпросмотр
```

Скрипт пишет только пустые расшифровки и длительность по их таймкодам (таймкоды — как в ru) и
ставит на каждую из трёх лекций отметку NATIVE_PROOFREAD (очередь менеджера — вычитка носителем);
повторный запуск — 0 изменений. После этого видео и расшифровки есть у всех 45 лекций; публикацию
блокируют только тесты модулей I–IV и практикум раздела V, пока их не создадут.

Если автор позже пришлёт свои тексты этих лекций, `import-lectures.js --sync` их не запишет
(расшифровка уже не пустая) — перевод заменяется текстом автора в редакторе менеджера. Другие
пустые расшифровки (если появятся) дозаполняются из JSON: файлы — в `LECTURE_FILES`
(`scripts/extract_philosophy.py`), пересобрать JSON, скопировать на сервер и

```bash
$C node dist/scripts/import-lectures.js /content/philosophy15.json --sync           # предпросмотр
$C node dist/scripts/import-lectures.js /content/philosophy15.json --sync --apply
```

(пишутся только пустые расшифровки и незаданная длительность; названия, видео, тесты и прогресс
студентов не трогаются).

### Материалы: тесты, практикум, мини-квизы, краткие содержания (без LLM)

Все материалы курса сгенерированы черновиками на рабочей машине, проверены рецензентом и
закоммичены в `apps/backend/content-data/philosophy/*.v1.json` (что в каком файле —
`content-data/philosophy/README.md`). На проде их только применяют контент-скрипты, LLM не
вызывается. Нужны выкаченный коммит с этими файлами (образ `api` пересобран — в нём
`dist/scripts/content/lecture-minis.js`) и свежая резервная копия:

```bash
cd /root/coursesupusioter && umask 077
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U edu -Fc edu_platform > backups/edu-before-phil-materials-$(date +%Y%m%d-%H%M).dump
CC="docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm -T \
   -v /root/coursesupusioter/apps/backend/content-data:/app/apps/backend/content-data:ro api"
```

Каждая строка, кроме двух последних, — сначала как есть (предпросмотр, прочитать сводку), затем
та же команда с `--apply --i-have-a-backup`; повторный запуск — 0 изменений. `audit-content` только
читает, `publish-course` здесь — только предпросмотр. В комментариях — ожидаемый предпросмотр на
курсе без материалов (так прошла репетиция на копии базы до материалов).

```bash
$CC node dist/scripts/content/snapshot-sessions.js                         # фаза A (общая для стенда): у всех сессий и попыток снимок есть — запись не нужна
$CC node dist/scripts/content/graded-bank.js --course "Введение в философию" --from graded-bank.v1.json                 # would-change 12: тесты разделов I–IV, 8 вопросов × 3 языка
$CC node dist/scripts/content/set-quiz-policy.js --course "Введение в философию"                                       # skip 12: политика уже задана (проверка)
$CC node dist/scripts/content/canonical-practical.js --course "Введение в философию" --from canonical-practical.v1.json # would-change 3: «Логосия» (logosia-v1)
$CC node dist/scripts/content/set-practical-config.js --course "Введение в философию"                                  # skip 3 (проверка)
$CC node dist/scripts/content/course-final.js --course "Введение в философию" --from course-final.v1.json               # would-change 3: итоговый мини-квиз, 15 вопросов
$CC node dist/scripts/content/lecture-minis.js --course "Введение в философию" --from lecture-minis.v1.json             # would-change 45: мини-квизы лекций по 3 вопроса
$CC node dist/scripts/content/summaries.js --course "Введение в философию" --from summaries.v1.json                     # would-change 45
$CC node dist/scripts/content/shuffle-options.js --course "Введение в философию"                                       # 0 изменений (варианты перемешаны при генерации)
$CC node dist/scripts/content/fix-titles.js --course "Введение в философию"                                            # 0 изменений (skip 108)
$CC node dist/scripts/content/audit-content.js --course "Введение в философию" --out /tmp/audit-phil.json             # все «Критерии выхода» — ✔
$C node dist/scripts/publish-course.js --course "Введение в философию"                                                # только предпросмотр: ru/kk/en «готова»
```

`graded-bank` и `canonical-practical` при записи требуют выполненную фазу A (снимки старых сессий
и попыток, общий шаг ремонта политологии); если её нет или появились сессии без снимка — отказ без
записи, тогда `snapshot-sessions.js --apply --i-have-a-backup` и повтор. Тесты разделов создаются
сразу с политикой (2 попытки, лучшая, пауза из env, полный разбор после последней), задание — с
конфигом практикума (бюджеты 160k/190k/120k, 24 реплики, 2 попытки, 25 мин, план беседы),
тренировочные вопросы — с уже перемешанными вариантами, поэтому set-quiz-policy,
set-practical-config, shuffle-options и fix-titles — только проверка. На вопросы банка и практикум
ставятся отметки EXPERT_REVIEW (ru, философ) и NATIVE_PROOFREAD (kk/en) — очередь проверки у
менеджера (вместе с тремя переведёнными лекциями — 102 отметки). Публикация — отдельно, после
решения лида.
