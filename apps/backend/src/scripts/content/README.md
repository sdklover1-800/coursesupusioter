# Контент-скрипты курса «Введение в политологию» (CONTENT-repair)

Ремонт и канонизация контента политологии (USER_DECISIONS §1, §4, §5): чистые расшифровки,
локализованные названия, канонический банк оцениваемых тестов 8×4 (ru → kk/en), канонический
практикум «Полисия» (`polisia-v1`), итоговый мини-квиз по 15 лекциям, обоснования вариантов,
краткие содержания, длительности, системные отметки на экспертную проверку.

**Главное правило прода: применяем ТОЛЬКО из закоммиченных файлов `apps/backend/content-data/politology/*.v1.json`.
На проде черновики (`--draft`) НЕ перегенерируются — LLM на проде не вызывается.**

## Общие правила

| Флаг | Что делает |
|---|---|
| (без флагов) | предпросмотр: сводка + дифф, JSON предпросмотра во временный каталог (или `--out <файл>`), БД не меняется |
| `--apply --i-have-a-backup` | запись; без `--i-have-a-backup` скрипт откажется |
| `--from <файл>` | фаза 2: применить проверенный артефакт (имя файла ищется в `--data`) |
| `--data <каталог>` | каталог артефактов, по умолчанию `content-data/politology` (относительно `apps/backend`) |
| `--lang ru,kk,en` | ограничить языками |
| `--force` | только где указано: перезаписать то, что после применения поменяли вручную (менеджер) |
| `--draft` | только фаза 2 и только локально: черновик через LLM → JSON-артефакт (БД не меняется) |

- Сопоставление — по содержанию: курс ищется по названию ru-версии «Введение в политологию», модули —
  по `orderIndex`, лекции — по (модуль, лекция), тесты — по виду и привязке, тексты — по точным якорям
  с проверкой числа попаданий. Артефакты не содержат локальных id: источник вопроса — позиция лекции.
- Идемпотентность: журнал `ContentMigration` (`content:v1:<скрипт>:<единица>`) + проверка текущего
  состояния. Повторный `--apply` меняет 0 строк.
- Одна транзакция на единицу работы (лекция, тест, задание), одна строка сводки на единицу:
  `unit · changed/skip/would-change/error · причина`. Код выхода 1 — есть ошибки единиц.
- Данные студентов не удаляются: попытки/сессии/прогресс не трогаются, старые вопросы оцениваемых
  тестов АРХИВИРУЮТСЯ (не удаляются), id лекций сохраняются, у старых сессий — снимок задания.
- Системные отметки на проверку — `ContentIssue` с `origin SYSTEM`, `context CONTENT_PIPELINE`,
  `dedupeKey review:v1:…` (EXPERT_REVIEW, NATIVE_PROOFREAD, FACT_CHECK) — видны в очереди жалоб менеджера.

## Резервная копия (обязательно)

Перед первым `--apply` и ещё раз перед фазой 2:

```bash
cd /root/coursesupusioter && umask 077
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U edu -Fc edu_platform > backups/edu-before-content-$(date +%Y%m%d-%H%M).dump
ls -la backups/   # размер > 0; проверка целостности:
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T postgres pg_restore -l < backups/<файл>.dump | head
```

Дамп содержит персональные данные — хранить как ежедневные бэкапы (deploy/README.md §8).

## Запуск

Локально (из `apps/backend`):

```bash
npx tsx --env-file-if-exists=../../.env src/scripts/content/<скрипт>.ts [флаги]
```

Прод (скрипты собраны в `dist`; артефакты смонтированы в контейнер):

```bash
cd /root/coursesupusioter
C="docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm -T \
   -v /root/coursesupusioter/apps/backend/content-data:/app/apps/backend/content-data:ro api"
$C node dist/scripts/content/audit-content.js --out /tmp/audit-0.json
```

(в образе `runtime` каталога `content-data` нет — поэтому монтирование `-v …:ro`.)

## Порядок на проде

Каждый шаг: сначала без `--apply` (прочитать сводку), затем с `--apply --i-have-a-backup`.

| # | Скрипт | Что делает |
|---|---|---|
| 0 | `audit-content.js --out /tmp/audit-0.json` | аудит «до» (только чтение) |
| A | `snapshot-sessions.js` | **до любых записей**: снимок задания у старых сессий, `presentation` у старых попыток; отказ, если пересчёт балла не совпал |
| 1a | `fix-transcripts.js` | реплики чата, дубли, ru-02/kk-02, en-09 §2, таймкоды kk-01, метаданные шапки, хвосты, абзацы |
| 1b | `fix-attribution.js` | «Бинтроу» → «Пай» (ru/kk-13 и вопросы) + FACT_CHECK |
| 1c | `fix-titles.js` | названия лекций/тестов/практикума (localizedTitle, семинар L12) |
| 1d | `fix-kk-text.js` | лексикон kk-опечаток + NATIVE_PROOFREAD |
| 1e | `set-quiz-policy.js` | 2 попытки, BEST, пауза из env, FULL_AFTER_FINAL |
| 1f | `set-practical-config.js` | бюджеты 160k/190k/120k, 24 реплики, 2 попытки, 25 мин, план беседы |
| 1g | `backfill-durations.js` | `durationSec` из шапки (журнал 1a) или конца таймкодов |
| 1h | `archive-demo.js --force` | архив демо-курса «Основы критического мышления» (с `--force`, если есть попытки) |
| 1i | `shuffle-options.js` | перемешать варианты тренировочных вопросов (seed = id вопроса) |
| 2a | `kk-transcripts.js --from kk-transcripts.v1.json` | kk-01 (корректура), kk-07 §3 (вставка) + NATIVE_PROOFREAD |
| 2b | `graded-bank.js --from graded-bank.v1.json` | канонический банк 8×4 (ARCHIVE_REPLACE) + EXPERT_REVIEW / NATIVE_PROOFREAD |
| 2c | `canonical-practical.js --from canonical-practical.v1.json` | «Полисия» `polisia-v1` на ru/kk/en |
| 2d | `overlaps.js --from overlaps.v1.json` | мини-квизы kk L1, kk L7, ru L2 целиком (+ замены пересечений, если есть) |
| 2e | `course-final.js --from course-final.v1.json` | итоговый мини-квиз: 15 вопросов, по одному на лекцию |
| 2f | `rationales.js --from rationales.v1.json` | обоснования вариантов (сверка формулировки/вариантов/ключа) |
| 2g | `summaries.js --from summaries.v1.json` | краткие содержания 45 лекций |
| — | `audit-content.js --out /tmp/audit-1.json --baseline /tmp/audit-0.json` | аудит «после» + дифф; все «Критерии выхода» — ✔ |
| — | `publish-course.js` | только предпросмотр (ничего не публикует) |
| (позже) | `descriptions.js --from descriptions.v1.json --apply …` | описания курса — ТОЛЬКО после согласования (`meta.approved: true`) |

После 2c — харнесс калибровки судьи (BE3) против канонического задания (платные вызовы LLM, по
решению лида): `node dist/scripts/eval-judge.js --task-bound --lang ru,kk,en --budget-usd 1.5`.

### Что может отличаться на проде

- Расшифровки на проде загружены из того же `lectures15.json` → адресные ремонты 1a/1b ожидают те же
  якоря; если якорь не найден, единица пропускается с ошибкой (ничего не пишется) — разобрать вручную.
- Тренировочные вопросы прода генерировались отдельно, поэтому 2f (обоснования) и замены
  пересечений 2d применяются только к вопросам, совпадающим с артефактом по формулировке, вариантам
  и ключу; остальные пропускаются с причиной «иной стенд». Для них после 2b/2e запустите аудит:
  пересечения с новым банком (`gradedPracticeOverlaps`) и `rationalesCoverage` покажут остаток.
- kk-01 (2a) применяется, только если текст после фазы 1 совпал с черновиком (sha256); иначе нужен `--force`.

## Черновики (локально, LLM; бюджет < $3)

```bash
npx tsx --env-file-if-exists=../../.env src/scripts/content/kk-transcripts.ts --draft
npx tsx --env-file-if-exists=../../.env src/scripts/content/graded-bank.ts --draft [--only M2,M4]
npx tsx --env-file-if-exists=../../.env src/scripts/content/canonical-practical.ts --draft
npx tsx --env-file-if-exists=../../.env src/scripts/content/overlaps.ts --draft
npx tsx --env-file-if-exists=../../.env src/scripts/content/course-final.ts --draft
npx tsx --env-file-if-exists=../../.env src/scripts/content/rationales.ts --draft
npx tsx --env-file-if-exists=../../.env src/scripts/content/summaries.ts --draft
npx tsx --env-file-if-exists=../../.env src/scripts/content/descriptions.ts --draft
```

Каждый черновик затем читается человеком (правки — прямо в JSON, записываются в `meta.reviewEdits`),
и только потом применяется `--from`. Расход LLM копится в `content-data/politology/llm-spend.json`.
