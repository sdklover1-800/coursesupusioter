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
| `--overwrite-reviewed` | только с `--draft`: перезаписать проверенный артефакт (есть `meta.reviewEdits`/`reviewNotes`/`textFixes`); без флага черновик пишется рядом, в `<имя>.draft-<время>.json` |

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
| 1a | `fix-transcripts.js` | реплики чата, дубли, ru-02/kk-02, en-09 §2, таймкоды kk-01, метаданные шапки, хвосты, абзацы; заголовок «6-ЛЕКЦИЯ»/«10-ЛЕКЦИЯ» kk-06/kk-10 → «№N ДӘРІС» (своя единица `heading:<код>`) |
| 1b | `fix-attribution.js` | «Бинтроу» → «Пай» (ru/kk-13 и вопросы) + FACT_CHECK |
| 1c | `fix-titles.js` | названия лекций/тестов/практикума (localizedTitle, семинар L12) |
| 1d | `fix-kk-text.js` | лексикон kk-опечаток + NATIVE_PROOFREAD |
| 1e | `set-quiz-policy.js` | 2 попытки, BEST, пауза из env, FULL_AFTER_FINAL |
| 1f | `set-practical-config.js` | бюджеты 160k/190k/120k, 24 реплики, 2 попытки, 25 мин, план беседы |
| 1g | `backfill-durations.js` | `durationSec` из шапки (журнал 1a) или конца таймкодов |
| 1h | `archive-demo.js --force` | архив демо-курса «Основы критического мышления» (с `--force`, если есть попытки) |
| 1i | `shuffle-options.js` | перемешать варианты тренировочных вопросов (seed = id вопроса) |
| 2a | `kk-transcripts.js --from kk-transcripts.v1.json` | kk-01 (корректура), kk-07 §3 (вставка) + NATIVE_PROOFREAD |
| 2b | `graded-bank.js --from graded-bank.v1.json` | канонический банк 8×4 (ARCHIVE_REPLACE) + EXPERT_REVIEW / NATIVE_PROOFREAD; отказ без `--force`, если у студента незавершённая серия попыток на старом банке; правки рецензента `meta.textFixes` |
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

## Правки рецензента после применения (`meta.textFixes`)

Если проверенный артефакт поправили ПОСЛЕ того, как он применён (опечатка, термин, кириллица в
en, переписанные обоснования), правка вносится и в сам вопрос артефакта (для стендов, где он ещё не
применён), и в `meta.textFixes` — «было → стало» по точному якорю (человекочитаемо — в
`meta.reviewEdits`). Повторный `--from … --apply` скриптов 2b (`graded-bank`), 2d (`overlaps`) и 2f
(`rationales`) переносит их на уже применённый стенд (`lib.applyTextFixes`, `revisions.ts`):

- вопрос — по `canonicalKey` (оцениваемый банк) или по позиции + снимку формулировки (мини-квизы;
  другая формулировка — «иной стенд», пропуск); текст — `from` ровно одно вхождение (`match: whole` —
  значение поля целиком); уже стоит `to` — «уже исправлено»; нет ни `from`, ни `to` — ошибка, ничего
  не пишется;
- порядок вариантов и ключ НЕ меняются (правка допустима и для вопросов с попытками); одна
  транзакция на правку, журнал `content:v1:<скрипт>:fix:<id>`, отметка на проверку из `review`
  (dedupeKey `review:v1:<reason>:<id вопроса>:<id правки>`);
- правка по смыслу (`substantive: true`, переформулировка оцениваемого вопроса) откладывается без
  `--force`, пока у студента идёт попытка или незавершённая серия попыток, в которой вопрос уже
  показывался;
- повторная правка того же места — НОВАЯ запись (`from` = прежнее «стало»), а у всех записей этого
  места `to` = итоговый текст (и в самом вопросе артефакта — он же): тогда любой стенд — без правок,
  с первой редакцией или с исправленным артефактом — сходится к итогу без ошибок.

Ревизия 2026-09-26: en M4:Q5 «кадровые», kk M1:Q5 «із ізі әсері», подсказки длиной kk M1/M4,
термины kk M3:Q2 / M4:Q6, «созвучие» M1:Q8 / M2:Q7 / M3:Q4 (ru/kk/en) и en M2:Q5, обоснования
45 вопросов TRUE_FALSE мини-квизов. Аудит проверяет язык текстов (`questionLanguage`: кириллица в
en, русские «верно/неверно» в kk) и вырожденные обоснования (`rationalesShort`, < 25 символов).

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

Каждый черновик затем читается человеком (правки — прямо в JSON, записываются в `meta.reviewEdits`;
проверенный артефакт повторный `--draft` не затирает — см. `--overwrite-reviewed`),
и только потом применяется `--from`. Расход LLM копится в `content-data/politology/llm-spend.json`.

## Курс «Введение в философию»: недостающие расшифровки (translate-transcripts)

Расшифровок kk-04, en-04 и en-14 автор не прислал — по решению пользователя от 19.10 их переводим с
ru сами. Артефакт — `content-data/philosophy/translations.v1.json` (каталог по профилю курса):

```bash
npx tsx --env-file-if-exists=../../.env src/scripts/content/translate-transcripts.ts --course "Введение в философию" --draft [--only kk-04]
npx tsx --env-file-if-exists=../../.env src/scripts/content/translate-transcripts.ts --course "Введение в философию" --from translations.v1.json [--apply --i-have-a-backup] [--force]
```

- Черновик переводит ru-текст той же лекции по разделам (BE4 `translateTranscript`, effort medium,
  глоссарий из параллельных лекций курса). Таймкоды — байт-в-байт как в ru; шапка «N-дәріс. …» /
  «Lecture N. …», метки разделов («БӨЛІМ 1.» / «SECTION 1.»), регистр заголовков и заголовки
  приложения («Негізгі ұғымдар», «Key Concepts», …) — детерминированно. Текст хранится построчно
  (`lines`), правки рецензента — в `meta.reviewEdits`.
- Применение пишет расшифровку только в пустую — или в записанную ранее этим скриптом и не правленную
  после (так переносится исправленный артефакт); текст автора или правку менеджера — только с
  `--force`. Длительность — конец последнего таймкода, если не задана вручную. На каждую лекцию —
  отметка NATIVE_PROOFREAD (вычитка носителем). Журнал — `content:v1:philosophy:translate-transcripts:<код>`.

## Курс «Введение в философию»: материалы (банк, практикум, мини-квизы, краткие содержания)

Профиль курса — `lib.COURSE_PROFILES`: `--course "Введение в философию"` → артефакты
`content-data/philosophy`, журнал `content:v1:philosophy:<скрипт>:<единица>`, ключи банка
`phil:M<n>:Q<n>`, канон практикума «Логосия» (`logosia-v1`; ru-канон вписан в сам артефакт —
`canonicalSource: 'artifact'`), паритет таймкодов — по числу разделов (у видео каждого языка свой
хронометраж). Без `--course` — политология, поведение прежнее: предпросмотры всех общих скриптов
на политологии совпадают с версией до курса философии.

У нового курса тестов и задания ещё нет — их создают сами скрипты фазы 2: `graded-bank` (тесты
модулей I–IV, сразу с политикой попыток set-quiz-policy), `canonical-practical` (задание раздела V,
сразу с конфигом set-practical-config), `course-final` (итоговый мини-квиз), `lecture-minis`
(мини-квизы лекций, `LECTURE_MINI`, тренировочные). Поэтому set-quiz-policy, set-practical-config,
shuffle-options и fix-titles после них дают 0 изменений — это проверка, а не шаг записи.

Черновики (локально, LLM; расход — `content-data/philosophy/llm-spend.json`):

```bash
npx tsx --env-file-if-exists=../../.env src/scripts/content/graded-bank.ts --course "Введение в философию" --draft [--only M1]
npx tsx --env-file-if-exists=../../.env src/scripts/content/canonical-practical.ts --course "Введение в философию" --draft   # ru-канон уже в артефакте (meta.ruSource)
npx tsx --env-file-if-exists=../../.env src/scripts/content/course-final.ts --course "Введение в философию" --draft
npx tsx --env-file-if-exists=../../.env src/scripts/content/lecture-minis.ts --course "Введение в философию" --draft [--only ru-04]
npx tsx --env-file-if-exists=../../.env src/scripts/content/summaries.ts --course "Введение в философию" --draft
```

Рецензия (`meta.reviewEdits` / `meta.reviewNotes` каждого файла):

- ru — канон: фактическая точность по расшифровке своей лекции, один верный ответ, правдоподобные
  дистракторы, без подсказок длиной/позицией, ключи A–D поровну;
- kk/en банка и тренировочных вопросов — перевод проверенного ru (`translateQuestions` с глоссарием
  курса: названия лекций, заголовки разделов, «Ключевые понятия»; порядок вариантов и ключ — как в
  ru, таймкод — тот же раздел своей лекции) с вычиткой терминов по kk/en-расшифровкам: отдельные
  kk/en-черновики повторяли понятия оцениваемого банка;
- тренировочный вопрос (итоговый мини-квиз, мини-квизы лекций) не проверяет понятие оцениваемого
  теста и не раскрывает его ключ в дистракторах и обоснованиях; аудит проверяет пересечения
  формулировок (`gradedPracticeOverlaps`), остальное — рецензент.

Порядок на проде — `deploy/load-content.md` §6 (резервная копия, затем каждый шаг: предпросмотр →
`--apply --i-have-a-backup`): graded-bank → set-quiz-policy → canonical-practical →
set-practical-config → course-final → lecture-minis → summaries → shuffle-options → fix-titles →
audit-content (все «Критерии выхода» ✔) → publish-course (только предпросмотр). Повторный запуск
любого шага — 0 изменений (журнал).
