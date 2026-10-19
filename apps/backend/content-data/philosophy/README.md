# Проверенные артефакты контента курса «Введение в философию»

Источник правды для контент-скриптов (`apps/backend/src/scripts/content`, запуск — с
`--course "Введение в философию"`; без флага скрипты работают с политологией). На проде скрипты
применяют эти файлы `--from <файл>` без вызовов LLM. Каждый файл создан `--draft`
(gpt-5.4-mini через BE4 generation/drafts), прочитан и поправлен человеком; правки рецензента
перечислены в `meta.reviewEdits` / `meta.reviewNotes`.

| Файл | Скрипт | Содержание |
|---|---|---|
| `translations.v1.json` | translate-transcripts | расшифровки, которых автор не прислал (kk-04, en-04, en-14): перевод ru-текста той же лекции построчно (`lines`), таймкоды разделов — как в ru, sha256 ru-оригинала, длительность, пометки переводчика; при применении — отметка NATIVE_PROOFREAD |
| `graded-bank.v1.json` | graded-bank | оцениваемые тесты разделов I–IV: 8 × SINGLE_CHOICE на модуль, ru — канон, kk/en — перевод с теми же ключами и `canonicalKey` (`phil:M1:Q1` …); ключи A–D по 2 в каждом модуле, подсказок длиной нет (`meta.gates`); при применении — EXPERT_REVIEW (ru) и NATIVE_PROOFREAD (kk/en) на каждый вопрос |
| `canonical-practical.v1.json` | canonical-practical | итоговое практическое раздела V — канон «Логосия» (`logosia-v1`): сценарий, эталон, рубрика из 9 тезисов, критерий достижения ответа; ru — авторский текст рецензента (`meta.ruSource`), kk/en — перевод; EXPERT_REVIEW / NATIVE_PROOFREAD |
| `course-final.v1.json` | course-final | итоговый мини-квиз курса (тренировочный): по одному вопросу на каждую из 15 лекций, ru/kk/en |
| `lecture-minis.v1.json` | lecture-minis | мини-квизы 45 лекций (тренировочные): 2 SINGLE_CHOICE + 1 TRUE_FALSE строго по своей лекции; ru — рецензия черновика, kk/en — перевод проверенного ru; `transcriptSha256` — расшифровка своей версии |
| `summaries.v1.json` | summaries | краткие содержания 45 лекций (вкладка «Кратко», программа в каталоге), ≤ 400 символов |
| `llm-spend.json` | все `--draft` | журнал расхода LLM на черновики и переводы рецензента |

Порядок применения (прод — `deploy/load-content.md` §6): translate-transcripts → graded-bank →
set-quiz-policy → canonical-practical → set-practical-config → course-final → lecture-minis →
summaries → shuffle-options → fix-titles → audit-content → publish-course (только предпросмотр).

Правило для тренировочных вопросов (итоговый мини-квиз, мини-квизы лекций): они не проверяют
понятие оцениваемого теста и не раскрывают его ключ в дистракторах и обоснованиях (валидность
исследования); пересечения формулировок с банком проверяет аудит (`gradedPracticeOverlaps`).

Лекция адресуется позицией (`module`, `lectureOrder`; `lecture` — сквозной номер для чтения), а не
id — файлы переносимы между стендами.
