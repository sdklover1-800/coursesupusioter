#!/usr/bin/env python3
"""
Извлечение трёхъязычных лекций из .docx в JSON для импорта в платформу.

Файлы заказчика устроены неоднородно: порядок языковых блоков различается
(RU→KK→EN, RU→EN→KK), внутри блоков встречаются вкрапления другого языка
(заголовки, термины). Поэтому язык определяется по самому тексту абзаца
и сглаживается скользящим окном — маркеры-заголовки ненадёжны.

Использование:
    python3 scripts/extract_lectures.py <папка_с_docx> <выходной.json>
"""
from __future__ import annotations

import json
import re
import sys
import zipfile
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# Источники лекций. Два формата, встречающиеся в материалах заказчика:
#  - "all": один файл содержит несколько языков (разбираем split_by_language);
#  - "ru"/"kk"/"en": отдельный файл на язык (весь текст — этот язык).
# Пути относительны папки-источника (--src, по умолчанию ./docs).
LECTURE_SOURCES = {
    1: {"all": "Политология -  1 лекция.docx", "extra": "перевод англ + каз.docx"},
    2: {"all": "2 - Политология -2 лекция рус-каз-англ.docx"},
    3: {"all": "Политология_-_3_лекция.docx"},
    4: {"all": "Политология_-_4_лекция.docx"},
    5: {"all": "Политология_-_5_лекция.docx"},
    6: {"all": "Политология_-_6_лекция.docx"},
    7: {"all": "Политология_-_7_лекция.docx"},
    8: {"all": "Политология - 8 лекция.docx"},
    9: {"all": "политология - 9 лекция.docx"},
    10: {"all": "политология -- 10 лекция.docx"},
    11: {"all": "Политология_11 лекция.docx"},
    # У лекции 12 английской версии заказчик не предоставил — импортируем ru/kk.
    12: {"all": "Политология _Лекция_12_Политическое_лидерство_и_элиты.docx"},
    13: {
        "ru": "Лекция 13_RU_Политические конфликты и кризисы.docx",
        "kk": "Лекция_13_KZ_Саяси_қақтығыстар_мен_дағдарыстар.docx",
        "en": "Лекция_13_EN_Political_Conflicts_and_Crises.docx",
    },
    14: {
        "ru": "Лекция_14_RU_Политический_анализ_и_прогнозирование.docx",
        "kk": "Лекция_14_KZ_Саяси_талдау_және_болжау.docx",
        "en": "Лекция_14_EN_Political_Analysis_and_Forecasting.docx",
    },
    15: {
        "ru": "Лекция 15. Мировая политика и МО (RU).docx",
        "kk": "Лекция 15. Әлемдік саясат және ХҚ (KZ).docx",
        "en": "Lecture_15_World_Politics_and_IR_EN.docx",
    },
}

KK_LETTERS = set("әғқңөұүһі")


def paragraphs(path: Path) -> list[str]:
    with zipfile.ZipFile(path) as z:
        xml = z.read("word/document.xml").decode("utf8", "ignore")
    xml = re.sub(r"</w:p>", "\n", xml)
    xml = re.sub(r"<[^>]+>", "", xml)
    # мягкая нормализация html-сущностей
    xml = xml.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"')
    return [ln.strip() for ln in xml.split("\n") if ln.strip()]


def classify(s: str) -> str | None:
    low = s.lower()
    kk = sum(c in KK_LETTERS for c in low)
    ru = len(re.findall(r"[а-яё]", low))
    en = len(re.findall(r"[a-z]", low))
    if en > (ru + kk) * 1.2 and en > 8:
        return "en"
    if kk >= 2:
        return "kk"
    if ru > 4:
        return "ru"
    return None  # цифры/таймкоды/пунктуация — наследуют соседний блок


def smooth(labels: list[str | None], window: int = 9) -> list[str]:
    """Скользящее большинство: гасит одиночные вкрапления внутри блока."""
    known = [l for l in labels if l]
    fallback = max(set(known), key=known.count) if known else "ru"
    filled: list[str] = []
    last = None
    for l in labels:
        if l:
            last = l
        filled.append(l or last or fallback)
    out: list[str] = []
    for i in range(len(filled)):
        lo, hi = max(0, i - window // 2), min(len(filled), i + window // 2 + 1)
        win = filled[lo:hi]
        out.append(max(set(win), key=win.count))
    return out


def split_by_language(ps: List[str]) -> Dict[str, str]:
    """
    Возвращает {lang: text}. Берём ВСЕ абзацы каждого языка (после сглаживания),
    в порядке документа: в части файлов языковые блоки чередуются, и выбор только
    самого крупного региона терял бы содержимое (особенно казахское).
    """
    labels = smooth([classify(p) for p in ps])
    buckets: Dict[str, List[str]] = {}
    for para, lang in zip(ps, labels):
        buckets.setdefault(lang, []).append(para)
    return {lang: "\n".join(v).strip() for lang, v in buckets.items()}


def strip_course_plan(text: str) -> str:
    """Лекция 1 (ru) начинается с плана всего курса — отрезаем до «ЛЕКЦИЯ № 1»."""
    m = re.search(r"ЛЕКЦИЯ\s*№\s*1\b", text)
    return text[m.start():].strip() if m else text


def title_from(text: str, fallback: str) -> str:
    """
    Заголовок «Лекция 8. Название …» встречается не в начале строки: в части
    файлов он склеен со строкой раздела («Раздел III. … Лекция 8. …»),
    поэтому ищем шаблон в любом месте строки.
    """
    # Два порядка написания: «Лекция 8. …» / «Lecture 8. …» и казахский «2-дәріс. …»
    pattern = re.compile(
        r"(?:(?:Лекция|Дәріс|Lecture)\s*0?\d+|0?\d+\s*-\s*(?:дәріс|лекция|lecture))\s*[.:]\s*(.+)$",
        re.IGNORECASE,
    )
    lines = [ln.strip() for ln in text.split("\n")[:12]]
    for i, line in enumerate(lines):
        m = pattern.search(line)
        if m:
            title = re.split(
                r"\s+(?:Курс|Course|Пән|Хронометраж|Формат|Бейненің)\s*[:\s]", m.group(1)
            )[0]
            return title.strip(" .")[:200]
        # Вариант «Лекция 11» отдельной строкой — заголовок на следующей строке.
        if BARE_NUMBER_RE.match(line):
            for nxt in lines[i + 1 : i + 3]:
                if nxt and not BARE_NUMBER_RE.match(nxt):
                    return nxt.strip(" .")[:200]
    return fallback


# «Лекция 11», «11-дәріс (практикалық сабақ)», «Lecture 12 (Seminar)» — номер без названия
BARE_NUMBER_RE = re.compile(
    r"^(?:(?:Лекция|Дәріс|Lecture)\s*0?\d+|0?\d+\s*-\s*(?:дәріс|лекция|lecture))\s*(?:\([^)]*\))?\s*$",
    re.IGNORECASE,
)


def split_trailing_lecture(text: str, next_number: int):
    """
    В файле лекции 11 английский блок содержит ЕЩЁ И лекцию 12 (её отдельного
    английского файла заказчик не прислал). Отрезаем «хвост» по заголовку
    следующей лекции и возвращаем (свой_текст, текст_следующей | None).
    """
    marker = re.compile(
        rf"^(?:(?:Лекция|Дәріс|Lecture)\s*0?{next_number}\b|0?{next_number}\s*-\s*(?:дәріс|лекция))",
        re.IGNORECASE,
    )
    lines = text.split("\n")
    for i, line in enumerate(lines):
        if i > 5 and marker.match(line.strip()):
            head = "\n".join(lines[:i]).strip()
            # заголовок курса непосредственно перед номером относится к следующей лекции
            tail_start = i - 1 if i > 0 and len(lines[i - 1].strip()) < 60 else i
            tail = "\n".join(lines[tail_start:]).strip()
            return head, tail
    return text, None


"""
Разделы курса заданы планом из лекции 1 (он есть только там, в остальных
файлах строка раздела встречается не всегда). Модуль платформы = раздел.
"""
SECTIONS = [
    {
        "lectures": [1, 2, 3],
        "titles": {
            "ru": "Раздел I. Теоретико-методологические основы политологии",
            "kk": "I бөлім. Саясаттанудың теориялық-әдіснамалық негіздері",
            "en": "Section I. Theoretical and Methodological Foundations",
        },
    },
    {
        "lectures": [4, 5, 6, 7],
        "titles": {
            "ru": "Раздел II. Власть и политическая система",
            "kk": "II бөлім. Билік және саяси жүйе",
            "en": "Section II. Power and the Political System",
        },
    },
    {
        "lectures": [8, 9, 10],
        "titles": {
            "ru": "Раздел III. Институты и акторы политики",
            "kk": "III бөлім. Саясат институттары мен акторлары",
            "en": "Section III. Political Institutions and Actors",
        },
    },
    {
        "lectures": [11, 12, 13],
        "titles": {
            "ru": "Раздел IV. Политические процессы и поведение",
            "kk": "IV бөлім. Саяси процестер мен мінез-құлық",
            "en": "Section IV. Political Processes and Behaviour",
        },
    },
    {
        "lectures": [14, 15],
        "titles": {
            "ru": "Раздел V. Прикладная и международная политология",
            "kk": "V бөлім. Қолданбалы және халықаралық саясаттану",
            "en": "Section V. Applied and International Political Science",
        },
    },
]


def section_index_for(lecture_number: int) -> Optional[int]:
    for i, sec in enumerate(SECTIONS):
        if lecture_number in sec["lectures"]:
            return i
    return None


def main() -> None:
    src = Path(sys.argv[1] if len(sys.argv) > 1 else str(Path.home() / "Downloads"))
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "lectures.json")

    lectures = []
    # Текст следующей лекции, найденный внутри файла предыдущей (см. split_trailing_lecture)
    carry: Dict[int, Dict[str, str]] = {}

    for idx in sorted(LECTURE_SOURCES):
        spec = LECTURE_SOURCES[idx]
        by_lang: Dict[str, str] = {}

        if "all" in spec:
            # Один файл на несколько языков — разбираем по тексту.
            path = src / spec["all"]
            if not path.exists():
                print(f"⚠️  нет файла: {spec['all']}", file=sys.stderr)
                continue
            by_lang = split_by_language(paragraphs(path))
            if idx == 1:
                # У лекции 1 основной файл начинается с плана всего курса, а
                # переводы лежат отдельным файлом.
                by_lang = {"ru": strip_course_plan(by_lang.get("ru", ""))}
            extra = spec.get("extra")
            if extra and (src / extra).exists():
                by_lang.update({k: v for k, v in split_by_language(paragraphs(src / extra)).items() if k in ("kk", "en")})
        else:
            # Отдельный файл на каждый язык — весь текст относится к нему.
            for lang, fname in spec.items():
                path = src / fname
                if not path.exists():
                    print(f"⚠️  нет файла: {fname}", file=sys.stderr)
                    continue
                by_lang[lang] = "\n".join(paragraphs(path)).strip()

        # Отрезаем «хвост» со следующей лекцией и передаём его дальше по циклу.
        for lang, text in list(by_lang.items()):
            head, tail = split_trailing_lecture(text, idx + 1)
            if tail:
                by_lang[lang] = head
                carry.setdefault(idx + 1, {})[lang] = tail
                print(f"ℹ️  лекция {idx} [{lang}]: найден блок лекции {idx + 1} — перенесён", file=sys.stderr)

        # Языки, которых не было в собственных файлах, берём из переноса.
        for lang, text in carry.get(idx, {}).items():
            by_lang.setdefault(lang, text)

        entry = {"number": idx, "titles": {}, "transcripts": {}, "sectionIndex": section_index_for(idx)}
        for lang, text in by_lang.items():
            # Короткие обрывки (< 400 симв.) — это остатки разбора, а не расшифровка.
            if lang not in ("ru", "kk", "en") or len(text) < 400:
                continue
            entry["transcripts"][lang] = text
            entry["titles"][lang] = title_from(text, f"Лекция {idx}")
        lectures.append(entry)

    payload = {
        "course": {
            "ru": "Введение в политологию",
            "kk": "Саясаттануға кіріспе",
            "en": "Introduction to Political Science",
        },
        "sections": SECTIONS,
        "lectures": lectures,
    }
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf8")
    print(f"✅ {out} — лекций: {len(lectures)}")
    for l in lectures:
        sizes = ", ".join(f"{k}:{len(v)//1000}k" for k, v in sorted(l["transcripts"].items()))
        print(f"   {l['number']:>2}. [{sizes}] {l['titles'].get('ru', '')[:60]}")


if __name__ == "__main__":
    main()
