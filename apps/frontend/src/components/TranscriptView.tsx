import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';

/**
 * Читательский вид расшифровки лекции (FR-4.5).
 *
 * Расшифровки заказчика структурированы таймкодами вида «[00:00–01:30] Вступление»,
 * а сплошной текст читать тяжело. Здесь текст разбирается на секции и подаётся
 * как статья: оглавление с таймкодами, заголовки секций, комфортная типографика
 * (мера строки ~68ch, увеличенный интерлиньяж).
 */

interface Section {
  timecode: string | null;
  heading: string | null;
  paragraphs: string[];
}

// «[00:00–01:30] Вступление» — таймкод и заголовок секции
const TIMECODE_RE = /^\s*\[(\d{1,2}:\d{2}(?:\s*[–—-]\s*\d{1,2}:\d{2})?)\]\s*(.*)$/;
// Служебная шапка исходного .docx — дублирует заголовок страницы, скрываем
const HEADER_RE = /^\s*(ЛЕКЦИЯ|ДӘРІС|LECTURE)\s*[№#]?\s*\d+\s*$/i;
const TITLE_RE = /^\s*(Лекция|Дәріс|Lecture)\s*\d+[.:]/i;
const META_RE = /^\s*(Курс|Course|Пән)\s*:/i;

export function parseTranscript(text: string): Section[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const sections: Section[] = [];
  let current: Section = { timecode: null, heading: null, paragraphs: [] };

  for (const line of lines) {
    const tc = TIMECODE_RE.exec(line);
    if (tc) {
      if (current.paragraphs.length || current.heading) sections.push(current);
      current = { timecode: tc[1]!.replace(/\s+/g, ''), heading: tc[2]?.trim() || null, paragraphs: [] };
      continue;
    }
    // Служебные строки шапки показываем только если они вне секций (т.е. в самом начале)
    if (!current.timecode && (HEADER_RE.test(line) || TITLE_RE.test(line) || META_RE.test(line))) continue;
    current.paragraphs.push(line);
  }
  if (current.paragraphs.length || current.heading) sections.push(current);
  return sections;
}

function slug(i: number): string {
  return `transcript-section-${i}`;
}

export function TranscriptView({ text }: { text: string }) {
  const { t } = useTranslation();
  const sections = useMemo(() => parseTranscript(text), [text]);
  const [showContents, setShowContents] = useState(true);
  const withTimecodes = sections.filter((s) => s.timecode);

  return (
    <article>
      {/* Оглавление — быстрая навигация по 20-минутной лекции */}
      {withTimecodes.length > 1 && (
        <nav className="mb-8 rounded-2xl border border-border bg-surface/60 p-4">
          <button
            onClick={() => setShowContents((s) => !s)}
            className="flex w-full items-center justify-between gap-3 text-left"
            aria-expanded={showContents}
          >
            <span className="font-mono text-xs font-semibold uppercase tracking-wider text-brand">
              {t('lecture.contents')}
            </span>
            <span className="text-xs text-muted">{showContents ? '−' : '+'}</span>
          </button>
          {showContents && (
            <ol className="mt-3 space-y-1.5">
              {sections.map((s, i) =>
                s.timecode ? (
                  <li key={i}>
                    <a
                      href={`#${slug(i)}`}
                      className="group flex items-baseline gap-3 rounded-lg px-2 py-1 text-sm transition-colors hover:bg-brand-soft"
                    >
                      <span className="shrink-0 font-mono text-xs tabular-nums text-muted group-hover:text-brand">{s.timecode}</span>
                      <span className="text-fg group-hover:text-brand">{s.heading}</span>
                    </a>
                  </li>
                ) : null,
              )}
            </ol>
          )}
        </nav>
      )}

      {sections.map((s, i) => (
        <section key={i} id={slug(i)} className={clsx(i > 0 && 'mt-10', 'scroll-mt-24')}>
          {(s.timecode || s.heading) && (
            <header className="mb-4">
              {s.timecode && (
                <span className="inline-block rounded-full bg-spark/15 px-2.5 py-0.5 font-mono text-xs font-semibold tabular-nums text-spark">
                  {s.timecode}
                </span>
              )}
              {s.heading && (
                <h3 className="mt-2 font-display text-xl font-semibold leading-snug text-fg">{s.heading}</h3>
              )}
            </header>
          )}
          <div className="space-y-4">
            {s.paragraphs.map((p, j) => (
              <p key={j} className="max-w-[68ch] text-[17px] leading-[1.75] text-fg/90">
                {p}
              </p>
            ))}
          </div>
        </section>
      ))}
    </article>
  );
}
