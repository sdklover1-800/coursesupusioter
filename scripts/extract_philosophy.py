#!/usr/bin/env python3
"""
Извлечение лекций курса «Введение в философию» из .docx в JSON для импорта
(apps/backend/src/scripts/import-lectures.ts).

Форма результата — та же, что у scripts/extract_lectures.py (политология):
{course, sections[{lectures, titles}], lectures[{number, sectionIndex, titles, transcripts}]},
плюс необязательные поля, которые понимает import-lectures.ts:
  descriptions {ru, kk, en}      — описание языковой версии курса;
  lectures[].durations {lang: с} — длительность видео (Lecture.durationSec);
  lectures[].sources {lang: файл} — исходный .docx (для проверки человеком).

Материалы заказчика устроены иначе, чем у политологии: один .docx на лекцию и язык
(docs/phil). Дубли « (1)», « (2)» побайтно совпадают с файлом без суффикса — берём его.
Философия.docx — план курса от ИИ (не лекция), не читается.

Расшифровок L4 kk/en и L14 en пока нет — ждём автора, переводить НЕ нужно: в JSON у
лекции есть переведённое название и ПУСТАЯ расшифровка, импорт создаёт лекцию, а
публикация kk/en-версий остаётся заблокированной валидацией FR-2.9. Когда автор пришлёт
файлы — дописать их в LECTURE_FILES, перезапустить скрипт и import-lectures.ts --sync.

Нормализация — к виду расшифровок политологии после content/fix-transcripts.ts:
 - шапка: строка с названием курса и служебные строки «Хронометраж / Runtime / Ұзақтығы /
   Объём / Word count» удаляются (хронометраж → durations); строка названия лекции —
   «Лекция N. …» / «N-дәріс. …» / «Lecture N. …» (в части kk-файлов стоит русское
   «Лекция N.»); подзаголовок с темами остаётся;
 - разделы: таймкоды всех встречающихся видов — «[00:00–01:36] ВВЕДЕНИЕ», «[00:00 – 01:27] …»,
   «[00:00]  Введение» (в том числе в ячейке таблицы), «[00:00]» + заголовок строкой ниже,
   заголовок + «00:00 – 01:32» без скобок строкой ниже — приводятся к «[mm:ss–mm:ss] Заголовок».
   Конец раздела без диапазона — начало следующего, у последнего — хронометраж из шапки:
   разделы по диапазонам читают и плеер (frontend lib/transcript.ts — синхронизация с видео),
   и ИИ-генерация (backend generation/common.ts parseTranscript);
 - приложение: обёртка «Закрепление материала» / «Материалды бекіту» / «Reinforcement» и
   заголовок «Вопросы для самоконтроля» → варианты, которые узнаёт плеер (иначе строка
   повисает абзацем в конце заключения, а вопросы попадают в список литературы);
 - абзацы: в L13/L14 раздел — один абзац в 2–4,7 тыс. символов; режем по границам
   предложений на абзацы ~700 символов (текст не меняется — проверяется);
 - латинские буквы-двойники внутри кириллических слов («формaны», «жаhандық») → кириллица
   (ломают поиск по расшифровке); markdown-курсив «*…*» (en L15) → обычный текст;
 - kk: римские цифры веков, набранные кириллицей («ХІХ», «ХХ» — буквы Х и І), → латиница, как в
   названиях разделов, ru-версии и вопросах (то же правило — у content-скриптов: профиль курса
   latinRomanNumerals); одиночная «Х.» в списке литературы — инициал, не трогается.

Использование:
    python3 scripts/extract_philosophy.py [<папка_с_docx>] [<выходной.json>]
    по умолчанию: docs/phil → docs/media/philosophy15.json
"""
from __future__ import annotations

import json
import re
import sys
import zipfile
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from xml.etree import ElementTree as ET

# Общие помощники политологического экстрактора (определение языка абзаца).
sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract_lectures import classify  # noqa: E402

LANGS = ("ru", "kk", "en")
ROOT = Path(__file__).resolve().parent.parent

# Источники: номер лекции → язык → файл в папке-источнике. Языка нет — расшифровки
# пока нет (лекция импортируется с названием из MISSING_TITLES и пустой расшифровкой).
LECTURE_FILES: Dict[int, Dict[str, str]] = {
    1: {
        "ru": "Lecture_01_RU_Filosofiya_kak_forma_mirovozzreniya.docx",
        "kk": "Lecture_01_KZ_Filosofiya_kak_forma_mirovozzreniya.docx",
        "en": "Lecture_01_EN_Philosophy_as_a_Form_of_Worldview.docx",
    },
    2: {
        "ru": "Lecture_02_RU_Filosofiya_Drevnego_Vostoka.docx",
        "kk": "Lecture_02_KZ_Filosofiya_Drevnego_Vostoka.docx",
        "en": "Lecture_02_EN_Philosophy_of_the_Ancient_East.docx",
    },
    3: {
        "ru": "Lecture_03_RU_Antichnaya_filosofiya.docx",
        "kk": "Lecture_03_KZ_Antichnaya_filosofiya.docx",
        "en": "Lecture_03_EN_Ancient_Philosophy.docx",
    },
    # kk/en автор пока не прислал.
    4: {"ru": "Lecture_04_RU_Ellinisticheskaya_i_srednevekovaya_filosofiya.docx"},
    5: {
        "ru": "Философия_Лекция5_RU.docx",
        "kk": "Философия_Лекция5_KZ.docx",
        "en": "Философия_Лекция5_EN.docx",
    },
    6: {
        "ru": "Lecture6_Philosophy_Enlightenment_RU.docx",
        "kk": "Lecture6_Philosophy_Enlightenment_KK.docx",
        "en": "Lecture6_Philosophy_Enlightenment_EN.docx",
    },
    7: {
        "ru": "Философия_Лекция7_Неклассическая_философия_XIX_века_RU.docx",
        "kk": "Философия_Лекция7_ХІХ_ғасырдың_бейклассикалық_философиясы_KZ.docx",
        "en": "Philosophy_Lecture7_Non-Classical_Philosophy_XIX_Century_EN.docx",
    },
    8: {
        "ru": "Лекция_8_Философия_XX_века_RU.docx",
        "kk": "Лекция_8_Философия_XX_века_KZ.docx",
        "en": "Lecture_8_20th_Century_Philosophy_EN.docx",
    },
    # Онтология в двух лекциях: в файлах L9 и L10 одинаковые названия (см. PART_SUFFIX).
    9: {
        "ru": "Лекция_9_Онтология_RU.docx",
        "kk": "Лекция_9_Онтология_KZ.docx",
        "en": "Lecture_9_Ontology_EN.docx",
    },
    10: {
        "ru": "Lecture10_Ontology_RU.docx",
        "kk": "Lecture10_Ontology_KZ.docx",
        "en": "Lecture10_Ontology_EN.docx",
    },
    11: {
        "ru": "Lecture11_Epistemology_RU.docx",
        "kk": "Lecture11_Epistemology_KZ.docx",
        "en": "Lecture11_Epistemology_EN.docx",
    },
    12: {
        "ru": "Lecture12_Anthropology_RU.docx",
        "kk": "Lecture12_Anthropology_KZ.docx",
        "en": "Lecture12_Anthropology_EN.docx",
    },
    13: {"ru": "Lecture13_RU.docx", "kk": "Lecture13_KZ.docx", "en": "Lecture13_EN.docx"},
    # en автор пока не прислал.
    14: {"ru": "Lecture14_RU.docx", "kk": "Lecture14_KZ.docx"},
    15: {
        "ru": "Лекция_15_Философия_и_глобальные_проблемы_RU.docx",
        "kk": "Дәріс_15_Философия_KK.docx",
        "en": "Lecture_15_Philosophy_EN.docx",
    },
}

# Переведённые названия лекций, расшифровок которых ещё нет.
MISSING_TITLES: Dict[int, Dict[str, str]] = {
    4: {
        "kk": "Эллинистік және Рим философиясы. Ортағасырлық философия",
        "en": "Hellenistic and Roman Philosophy. Medieval Philosophy",
    },
    14: {"en": "Social Philosophy"},
}

# Название из файла заменяется: en L10 в файле «Ontology: The Theory of Being», а L9 —
# «The Doctrine of Being» (в ru/kk обе лекции названы одинаково) — одно название на обе части.
TITLE_OVERRIDES: Dict[Tuple[int, str], str] = {
    (10, "en"): "Ontology: The Doctrine of Being",
}

# Две лекции «Онтология» различаются только номером части.
PART_SUFFIX: Dict[int, Dict[str, str]] = {
    9: {"ru": " (часть 1)", "kk": " (1-бөлім)", "en": " (Part 1)"},
    10: {"ru": " (часть 2)", "kk": " (2-бөлім)", "en": " (Part 2)"},
}

COURSE = {
    "ru": "Введение в философию",
    "kk": "Философияға кіріспе",
    "en": "Introduction to Philosophy",
}

DESCRIPTIONS = {
    "ru": (
        "Базовый курс философии: предмет философии, история философской мысли от Древнего Востока "
        "до XX века, онтология, гносеология, философская антропология, этика, социальная философия "
        "и глобальные проблемы современности."
    ),
    "kk": (
        "Философияның негізгі курсы: философияның пәні, Ежелгі Шығыстан XX ғасырға дейінгі "
        "философиялық ойдың тарихы, онтология, гносеология, философиялық антропология, этика, "
        "әлеуметтік философия және қазіргі заманның жаһандық мәселелері."
    ),
    "en": (
        "Foundational philosophy course: the subject of philosophy, the history of philosophical "
        "thought from the Ancient East to the 20th century, ontology, epistemology, philosophical "
        "anthropology, ethics, social philosophy and the global problems of our time."
    ),
}

# Модуль платформы = раздел курса (как у политологии): I–IV — тесты модулей,
# V — итоговое практическое по всему курсу (тип модуля выбирает import-lectures.ts).
SECTIONS = [
    {
        "lectures": [1, 2, 3],
        "titles": {
            "ru": "Раздел I. Предмет философии, Древний Восток и Античность",
            "kk": "I бөлім. Философияның пәні, Ежелгі Шығыс және Антика",
            "en": "Section I. The Subject of Philosophy, the Ancient East and Antiquity",
        },
    },
    {
        "lectures": [4, 5, 6],
        "titles": {
            "ru": "Раздел II. Эллинизм, Средние века, Возрождение и Просвещение",
            "kk": "II бөлім. Эллинизм, Орта ғасырлар, Қайта Өрлеу және Ағарту дәуірі",
            "en": "Section II. Hellenism, the Middle Ages, the Renaissance and the Enlightenment",
        },
    },
    {
        "lectures": [7, 8, 9],
        "titles": {
            "ru": "Раздел III. Философия XIX–XX веков. Онтология",
            "kk": "III бөлім. XIX–XX ғасырлар философиясы. Онтология",
            "en": "Section III. Philosophy of the 19th–20th Centuries. Ontology",
        },
    },
    {
        "lectures": [10, 11, 12],
        "titles": {
            "ru": "Раздел IV. Онтология, гносеология и философская антропология",
            "kk": "IV бөлім. Онтология, гносеология және философиялық антропология",
            "en": "Section IV. Ontology, Epistemology and Philosophical Anthropology",
        },
    },
    {
        "lectures": [13, 14, 15],
        "titles": {
            "ru": "Раздел V. Этика, социальная философия и глобальные проблемы",
            "kk": "V бөлім. Этика, әлеуметтік философия және жаһандық мәселелер",
            "en": "Section V. Ethics, Social Philosophy and Global Problems",
        },
    },
]


def section_index_for(lecture_number: int) -> Optional[int]:
    for i, sec in enumerate(SECTIONS):
        if lecture_number in sec["lectures"]:
            return i
    return None


def title_line(lang: str, number: int, title: str) -> str:
    """Строка названия в расшифровке (как у политологии: «Лекция 13. …», «2-дәріс. …»)."""
    if lang == "kk":
        return f"{number}-дәріс. {title}"
    return f"{'Лекция' if lang == 'ru' else 'Lecture'} {number}. {title}"


# ── Чтение .docx ────────────────────────────────────────────────────────────

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def docx_lines(path: Path) -> List[str]:
    """
    Абзацы документа по порядку, включая ячейки таблиц (в L7–L15 таймкод стоит в таблице).
    В отличие от extract_lectures.paragraphs XML разбирается парсером: сущности (&apos; —
    сотни раз в en-файлах) декодируются, <w:tab/>/<w:br/> — пробел, пустые абзацы выпадают.
    """
    with zipfile.ZipFile(path) as z:
        xml = z.read("word/document.xml")
    # Выгрузка Word не содержит DTD; с ним — отказ (внешние сущности, «billion laughs»).
    if b"<!DOCTYPE" in xml or b"<!ENTITY" in xml:
        raise ExtractError("в word/document.xml есть DOCTYPE/ENTITY — не похоже на выгрузку Word")
    root = ET.fromstring(xml)
    out: List[str] = []
    for p in root.iter(W + "p"):
        parts: List[str] = []
        for el in p.iter():
            if el.tag == W + "t":
                parts.append(el.text or "")
            elif el.tag in (W + "tab", W + "br", W + "cr"):
                parts.append(" ")
        text = re.sub(r"\s+", " ", "".join(parts)).strip()
        if text:
            out.append(text)
    return out


# ── Шапка ───────────────────────────────────────────────────────────────────

# «Курс «Введение в философию»», «"Философияға кіріспе" курсы», «Course: "Introduction to
# Philosophy"», «ВВЕДЕНИЕ В ФИЛОСОФИЮ», просто «Introduction to Philosophy».
COURSE_LINE_RE = re.compile(
    r"^(?:(?:Курс|Course)\s*:?\s*)?[«\"“]?\s*(?:Введение в философию|Философияға кіріспе|Introduction to Philosophy)"
    r"\s*[»\"”]?(?:\s+курсы)?$",
    re.IGNORECASE,
)
META_LINE_RE = re.compile(
    r"^(?:Хронометраж|Runtime|Ұзақтығы|Duration|Объ[её]м|Word\s+count|Көлемі|Мәтін\s+көлемі|Length)\b",
    re.IGNORECASE,
)
RUNTIME_RE = re.compile(r"(?:Хронометраж|Runtime|Ұзақтығы|Duration)\s*:?\s*(.*)", re.IGNORECASE)
TITLE_LINE_RE = re.compile(
    r"^(?:(?:Лекция|Lecture|Дәріс)\s*(\d+)|(\d+)\s*-\s*дәріс)\s*[.:]\s*(.+)$", re.IGNORECASE
)


def parse_runtime(line: str) -> Optional[int]:
    """
    Хронометраж из шапки, сек: «21:04 (при темпе 140 слов/мин)», «≈ 21 мин 27 сек»,
    «~28 min», «≈ 21 минута», «≈ 19 минут / 19 мин.» — до следующего поля «|», «•», «·».
    """
    m = RUNTIME_RE.search(line)
    if not m:
        return None
    head = re.split(r"[|•·]", m.group(1))[0]
    clock = re.search(r"(\d{1,2}):(\d{2})(?!\d)", head)
    if clock:
        return int(clock.group(1)) * 60 + int(clock.group(2))
    mins = re.search(r"(\d{1,3})\s*(?:мин|min)\w*\.?(?:\s*(\d{1,2})\s*(?:сек|sec)\w*)?", head, re.IGNORECASE)
    if mins:
        return int(mins.group(1)) * 60 + int(mins.group(2) or 0)
    return None


# ── Разделы ─────────────────────────────────────────────────────────────────

TC = r"\d{1,2}\s*:\s*\d{2}"
BRACKET_TC_RE = re.compile(rf"^\[\s*({TC})\s*(?:[–—-]\s*({TC})\s*)?\]\s*(.*)$")
# «00:00 – 01:32» — таймкод без скобок отдельной строкой (L15), только весь абзац целиком.
BARE_TC_RE = re.compile(rf"^({TC})(?:\s*[–—-]\s*({TC}))?$")


def tc_match(line: str) -> Optional[Tuple[int, Optional[int], str]]:
    m = BRACKET_TC_RE.match(line) or BARE_TC_RE.match(line)
    if not m:
        return None
    heading = m.group(3).strip() if m.re is BRACKET_TC_RE else ""
    return to_sec(m.group(1)), (to_sec(m.group(2)) if m.group(2) else None), heading


def to_sec(tc: str) -> int:
    mm, ss = re.sub(r"\s+", "", tc).split(":")
    return int(mm) * 60 + int(ss)


def fmt(sec: int) -> str:
    return f"{sec // 60:02d}:{sec % 60:02d}"


def heading_like(line: Optional[str]) -> bool:
    """Строка-заголовок раздела: короткая, без знака конца/продолжения фразы (кроме «?»)."""
    return bool(line) and len(line) <= 140 and not re.search(r"[.,;:…]$", line) and tc_match(line) is None


# ── Приложение и текст ──────────────────────────────────────────────────────

# Заголовки приложения, которых не знает плеер (frontend lib/transcript.ts MATERIALS_RE /
# APPENDIX_HEADS) → принятые варианты.
APPENDIX_RENAMES: Dict[str, List[Tuple[re.Pattern, str]]] = {
    "ru": [
        (re.compile(r"^Закрепление материала$", re.IGNORECASE), "Материалы для закрепления"),
        (re.compile(r"^Вопросы для самоконтроля$", re.IGNORECASE), "Вопросы для самопроверки"),
    ],
    "kk": [(re.compile(r"^Материалды бекіту$", re.IGNORECASE), "Бекітуге арналған материалдар")],
    "en": [(re.compile(r"^Reinforcement$", re.IGNORECASE), "Materials for Reinforcement")],
}

CYR = re.compile(r"[А-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі]")
LAT = re.compile(r"[A-Za-z]")
# Латинские буквы-двойники кириллицы; i/h — по языку: kk «нейрожелiде» → і, «жаhандық» → һ;
# ru «анимi» (транслитерация лат. animi) → и.
HOMOGLYPHS = dict(zip("aceopxyABCEHKMOPTX", "асеорхуАВСЕНКМОРТХ"))
HOMOGLYPHS_BY_LANG = {"kk": {"i": "і", "I": "І", "h": "һ"}, "ru": {"i": "и"}, "en": {}}


def fix_homoglyphs(text: str, lang: str, log: List[str]) -> str:
    table = {**HOMOGLYPHS, **HOMOGLYPHS_BY_LANG[lang]}

    def repl(m: re.Match) -> str:
        word = m.group(0)
        if not (CYR.search(word) and LAT.search(word)):
            return word
        fixed = "".join(table.get(ch, ch) for ch in word)
        if LAT.search(fixed):
            log.append(f"смешанное написание оставлено как есть: «{word}»")
            return word
        log.append(f"«{word}» → «{fixed}»")
        return fixed

    return re.sub(r"[^\W\d_]+", repl, text)


# Римские цифры с кириллическими Х (U+0425) / І (U+0406), не короче двух букв (одиночная «Х.» —
# инициал: «Гадамер Х.-Г.», «Йонас Х.»). Как revisions.CYRILLIC_ROMAN_RE у content-скриптов.
CYRILLIC_ROMAN_RE = re.compile(r"(?<![^\W_])(?=[XIVLCMХІ]*[ХІ])[XIVLCMХІ]{2,}(?![^\W_])")


def fix_roman_numerals(text: str, lang: str, log: List[str]) -> str:
    if lang != "kk":
        return text
    hits: List[str] = []

    def repl(m: re.Match) -> str:
        hits.append(m.group(0))
        return m.group(0).replace("Х", "X").replace("І", "I")

    out = CYRILLIC_ROMAN_RE.sub(repl, text)
    if hits:
        log.append(f"римские цифры кириллицей → латиница: {len(hits)} ({', '.join(sorted(set(hits)))})")
    return out


def strip_md_italics(text: str, log: List[str]) -> str:
    out, n = re.subn(r"\*([^*\n]+?)\*", r"\1", text)
    if n:
        log.append(f"markdown-курсив «*…*» снят: {n}")
    return out


# Абзацы. В L13/L14 каждый раздел — ОДИН абзац в 2–4,7 тыс. символов (в остальных лекциях
# медиана 550–1100): такие лекции режем по границам предложений на абзацы ~PARAGRAPH_TARGET —
# как content/fix-transcripts.ts склеивал «предложение на строку» у политологии. Текст не
# меняется (проверяется число непробельных символов).
SINGLE_PARAGRAPH_MEDIAN = 2000
PARAGRAPH_TARGET = 700
# Конец предложения: знак, закрывающие кавычки/скобки, пробел, заглавная (или открывающая кавычка).
SENTENCE_END_RE = re.compile(r"([.!?…])([»\"”’)\]]*)\s+(?=[«\"“„(\[]?[A-ZА-ЯЁӘҒҚҢӨҰҮҺІ])")
# Сокращения с точкой, после которых предложение не кончается («нем. Sein», «Дж. Ролз»).
ABBREVIATIONS = {"нем", "англ", "лат", "греч", "франц", "фр", "др", "гг", "вв", "см", "ср", "напр", "проф", "дж", "prof", "dr", "mr", "mrs", "st", "vs", "cf", "ed", "eds", "vol", "pp", "ch", "ibid"}


def nonws(s: str) -> str:
    return re.sub(r"\s+", "", s)


def split_paragraph(p: str) -> List[str]:
    if len(p) <= PARAGRAPH_TARGET * 1.5:
        return [p]
    cuts: List[int] = []
    for m in SENTENCE_END_RE.finditer(p):
        if m.group(1) == ".":
            word = re.search(r"([^\s(«\"“„\[]*)$", p[: m.start()])
            letters = re.sub(r"\W", "", word.group(1) if word else "")
            if len(letters) <= 2 or letters.lower() in ABBREVIATIONS:
                continue  # инициал («И. Кант», «J. S. Mill»), «в.», «нем.» …
        cuts.append(m.end())
    out: List[str] = []
    start = 0
    for c in cuts:
        if c - start >= PARAGRAPH_TARGET and len(p) - c >= PARAGRAPH_TARGET // 2:
            out.append(p[start:c].strip())
            start = c
    out.append(p[start:].strip())
    return out


def split_single_paragraph_sections(lines: List[str], log: List[str]) -> List[str]:
    """Лекция «раздел = один абзац» → абзацы ~PARAGRAPH_TARGET; остальные — как есть."""
    prose = sorted(len(l) for l in lines if tc_match(l) is None and len(l) > 200)
    if not prose or prose[len(prose) // 2] <= SINGLE_PARAGRAPH_MEDIAN:
        return lines
    out: List[str] = []
    for line in lines:
        parts = [line] if tc_match(line) else split_paragraph(line)
        if nonws("".join(parts)) != nonws(line):
            raise ExtractError("разбивка на абзацы изменила текст")
        out.extend(parts)
    log.append(f"раздел = один абзац (медиана {prose[len(prose) // 2]} симв.): абзацев {len(lines)} → {len(out)} строк")
    return out


# ── Лекция ──────────────────────────────────────────────────────────────────


class ExtractError(Exception):
    pass


def normalize(lines: List[str], lang: str, number: int, title: str, log: List[str]) -> Tuple[str, int, str]:
    """
    Расшифровка в виде политологии после fix-transcripts → (текст, длительность, исходное название).
    Длительность = конец последнего раздела (диапазон из файла, иначе хронометраж шапки).
    """
    first_tc = next((i for i, l in enumerate(lines) if tc_match(l)), None)
    if first_tc is None:
        raise ExtractError("нет ни одного таймкода")

    # Шапка: курс, название, подзаголовок, служебные строки. Остальное до первого таймкода —
    # уже тело (L15: заголовок «Введение» стоит НАД таймкодом «00:00 – 01:32»).
    header: List[str] = []
    body: List[str] = []
    runtime: Optional[int] = None
    source_title: Optional[str] = None
    course_seen = subtitle_seen = False
    for line in lines[:first_tc]:
        if COURSE_LINE_RE.match(line) and source_title is None:
            course_seen = True
            continue
        if META_LINE_RE.match(line):
            runtime = runtime or parse_runtime(line)
            continue
        m = TITLE_LINE_RE.match(line)
        if m and source_title is None:
            if int(m.group(1) or m.group(2)) != number:
                raise ExtractError(f"номер в строке названия «{line}» ≠ {number}")
            source_title = m.group(3).strip()
            header.append(title_line(lang, number, title))
            continue
        if source_title is not None and not subtitle_seen:
            if not re.search(r"[;·,]", line):
                raise ExtractError(f"после названия ожидался подзаголовок со списком тем, а не «{line}»")
            header.append(line)
            subtitle_seen = True
            continue
        body.append(line)
    if not course_seen:
        raise ExtractError("нет строки с названием курса")
    if source_title is None:
        raise ExtractError("нет строки названия лекции")
    if runtime is None:
        raise ExtractError("нет хронометража в шапке")
    lead = len(body)  # строки тела до первого таймкода (заголовок над ним) — не абзацы
    body.extend(lines[first_tc:])

    # «Голый» таймкод: заголовок строкой выше или ниже — одним способом на весь файл.
    votes = set()
    for i, line in enumerate(body):
        tc = tc_match(line)
        if not tc or tc[2]:
            continue
        before = i > 0 and heading_like(body[i - 1]) and not tc_match(body[i - 1])
        after = i + 1 < len(body) and heading_like(body[i + 1])
        if before != after:
            votes.add("before" if before else "after")
    if len(votes) > 1:
        raise ExtractError("заголовки «голых» таймкодов то выше, то ниже — разберите вручную")
    mode = votes.pop() if votes else None

    out: List[object] = []  # строки тела и разделы [start, end, heading]
    sections: List[list] = []
    i = 0
    while i < len(body):
        line = body[i]
        tc = tc_match(line)
        if not tc:
            if i < lead and not (i + 1 < len(body) and tc_match(body[i + 1]) and mode == "before"):
                raise ExtractError(f"лишняя строка до первого таймкода: «{line[:60]}»")
            out.append(line)
            i += 1
            continue
        start, end, heading = tc
        if not heading:
            if mode == "before" and out and isinstance(out[-1], str) and heading_like(out[-1]):
                heading = out.pop()  # type: ignore[assignment]
            elif mode == "after" and i + 1 < len(body) and heading_like(body[i + 1]):
                heading = body[i + 1]
                i += 1
            else:
                raise ExtractError(f"таймкод [{fmt(start)}] без заголовка")
        sec = [start, end, heading.strip()]
        sections.append(sec)
        out.append(sec)
        i += 1

    # Концы разделов: диапазон из файла, иначе начало следующего; у последнего — хронометраж.
    for k, sec in enumerate(sections):
        nxt = sections[k + 1][0] if k + 1 < len(sections) else None
        if k == 0 and sec[0] != 0:
            raise ExtractError(f"первый раздел начинается не с 00:00, а с {fmt(sec[0])}")
        if nxt is not None and nxt <= sec[0]:
            raise ExtractError(f"таймкоды не возрастают: {fmt(sec[0])} → {fmt(nxt)}")
        if sec[1] is None:
            sec[1] = nxt if nxt is not None else runtime
        elif nxt is not None and sec[1] != nxt:
            log.append(f"конец раздела {fmt(sec[0])}–{fmt(sec[1])} ≠ начало следующего {fmt(nxt)}")
        if sec[1] <= sec[0]:
            raise ExtractError(f"раздел [{fmt(sec[0])}–{fmt(sec[1])}] нулевой длины")
    duration = sections[-1][1]
    if abs(duration - runtime) > 60:
        log.append(f"конец таймкодов {fmt(duration)} расходится с хронометражем шапки {fmt(runtime)}")

    renames = APPENDIX_RENAMES[lang]
    body_lines: List[str] = []
    after_last = False
    for item in out:
        if isinstance(item, list):
            body_lines.append(f"[{fmt(item[0])}–{fmt(item[1])}] {item[2]}")
            after_last = item is sections[-1]
            continue
        line = str(item)
        if after_last:
            for rx, to in renames:
                if rx.match(line):
                    log.append(f"«{line}» → «{to}»")
                    line = to
        body_lines.append(line)

    text = "\n".join(header + split_single_paragraph_sections(body_lines, log))
    text = strip_md_italics(text, log)
    text = fix_homoglyphs(text, lang, log)
    text = fix_roman_numerals(text, lang, log)

    # Проверка языка: связный текст должен быть на языке версии.
    own = other = 0
    for line in text.split("\n"):
        if len(line) < 40:
            continue
        got = classify(line)
        if got == lang:
            own += 1
        elif got:
            other += 1
    if own < 20 or other > own * 0.15:
        raise ExtractError(f"текст не похож на {lang}: своих строк {own}, чужих {other}")
    return text, duration, source_title


def main() -> int:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "docs" / "phil"
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "docs" / "media" / "philosophy15.json"

    lectures = []
    errors = 0
    for number in sorted(LECTURE_FILES):
        files = LECTURE_FILES[number]
        entry: Dict[str, object] = {
            "number": number,
            "sectionIndex": section_index_for(number),
            "titles": {},
            "transcripts": {},
            "durations": {},
            "sources": {},
        }
        for lang in LANGS:
            fname = files.get(lang)
            if not fname:
                missing = MISSING_TITLES.get(number, {}).get(lang)
                if not missing:
                    print(f"❌ лекция {number} [{lang}]: нет ни файла в LECTURE_FILES, ни названия в MISSING_TITLES", file=sys.stderr)
                    errors += 1
                    continue
                title = missing + PART_SUFFIX.get(number, {}).get(lang, "")
                entry["titles"][lang] = title  # type: ignore[index]
                entry["transcripts"][lang] = ""  # type: ignore[index]
                print(f"ℹ️  лекция {number} [{lang}]: расшифровки нет — пустая (ждём автора)", file=sys.stderr)
                continue
            path = src / fname
            if not path.exists():
                print(f"❌ лекция {number} [{lang}]: нет файла {fname}", file=sys.stderr)
                errors += 1
                continue
            log: List[str] = []
            try:
                lines = docx_lines(path)
                # Название: из строки названия файла (+ замена и номер части); строка в расшифровке — по нему же.
                m = next((TITLE_LINE_RE.match(l) for l in lines[:6] if TITLE_LINE_RE.match(l)), None)
                if not m:
                    raise ExtractError("нет строки названия лекции")
                base = TITLE_OVERRIDES.get((number, lang), m.group(3).strip().rstrip("."))
                title = fix_roman_numerals(fix_homoglyphs(base, lang, []), lang, []) + PART_SUFFIX.get(number, {}).get(lang, "")
                text, duration, source_title = normalize(lines, lang, number, title, log)
            except ExtractError as e:
                print(f"❌ лекция {number} [{lang}] {fname}: {e}", file=sys.stderr)
                errors += 1
                continue
            if title != source_title:
                log.append(f"название «{source_title}» → «{title}»")
            for note in log:
                print(f"   л.{number} [{lang}]: {note}", file=sys.stderr)
            entry["titles"][lang] = title  # type: ignore[index]
            entry["transcripts"][lang] = text  # type: ignore[index]
            entry["durations"][lang] = duration  # type: ignore[index]
            entry["sources"][lang] = fname  # type: ignore[index]
        lectures.append(entry)

    if errors:
        print(f"❌ ошибок: {errors} — JSON не записан", file=sys.stderr)
        return 1

    payload = {
        "course": COURSE,
        "descriptions": DESCRIPTIONS,
        "sections": SECTIONS,
        "lectures": lectures,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf8")
    print(f"✅ {out} — лекций: {len(lectures)}")
    for l in lectures:
        tr: Dict[str, str] = l["transcripts"]  # type: ignore[assignment]
        du: Dict[str, int] = l["durations"]  # type: ignore[assignment]
        sizes = ", ".join(
            f"{k}:{len(tr[k]) // 1000}k/{du[k] // 60}:{du[k] % 60:02d}" if tr[k] else f"{k}:—" for k in LANGS
        )
        print(f"   {l['number']:>2}. [{sizes}] {l['titles']['ru'][:60]}")  # type: ignore[index]
    return 0


if __name__ == "__main__":
    sys.exit(main())
