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

# Файлы в порядке лекций 1..10
LECTURE_FILES = [
    "Политология -  1 лекция.docx",
    "2 - Политология -2 лекция рус-каз-англ.docx",
    "Политология_-_3_лекция.docx",
    "Политология_-_4_лекция.docx",
    "Политология_-_5_лекция.docx",
    "Политология_-_6_лекция.docx",
    "Политология_-_7_лекция.docx",
    "Политология - 8 лекция.docx",
    "политология - 9 лекция.docx",
    "политология -- 10 лекция.docx",
]
# Переводы лекции 1 (kk + en) лежат отдельно
LECTURE1_TRANSLATIONS = "перевод англ + каз.docx"

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
    for line in text.split("\n")[:12]:
        m = pattern.search(line.strip())
        if m:
            title = re.split(
                r"\s+(?:Курс|Course|Пән|Хронометраж|Формат|Бейненің)\s*[:\s]", m.group(1)
            )[0]
            return title.strip(" .")[:200]
    return fallback


"""
Разделы курса заданы планом из лекции 1 (он есть только там, в остальных
файлах строка раздела встречается не всегда). Модуль платформы = раздел.
Лекции 11–15 (разделы IV–V) заказчиком пока не предоставлены.
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
    for idx, fname in enumerate(LECTURE_FILES, start=1):
        path = src / fname
        if not path.exists():
            print(f"⚠️  нет файла: {fname}", file=sys.stderr)
            continue
        by_lang = split_by_language(paragraphs(path))
        if idx == 1:
            # у лекции 1 в основном файле только ru; переводы — отдельно
            by_lang = {"ru": strip_course_plan(by_lang.get("ru", ""))}
            tr = src / LECTURE1_TRANSLATIONS
            if tr.exists():
                by_lang.update({k: v for k, v in split_by_language(paragraphs(tr)).items() if k in ("kk", "en")})
        entry = {"number": idx, "titles": {}, "transcripts": {}, "sectionIndex": section_index_for(idx)}
        for lang, text in by_lang.items():
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
