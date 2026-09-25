import { clsx } from 'clsx';
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { activeSectionAt, findMatches, parseTranscript, type ParsedTranscript, type TranscriptBlock, type TranscriptSection } from '../lib/transcript';
import { TimeChip } from './ui';
import { Icon } from './icons';
import { FollowToggle, TranscriptSearch } from './lecture/TranscriptSearch';
import { isTypingTarget, prefersReducedMotion, scrollToRatio } from './lecture/lectureUtils';

/** Совместимость: разбор расшифровки теперь в lib/transcript (чистые функции). */
export { parseTranscript } from '../lib/transcript';

/**
 * Читательский вид расшифровки лекции (FR-4.5, screen_specs «Transcript»).
 * Экспорт и проп `text` неизменны: FE4 показывает <TranscriptView text=… /> в листе
 * «Материалы лекции» практикума, FE5 — в предпросмотре редактора. Все новые пропсы
 * необязательны: без currentTime/onSeek это статья с оглавлением и поиском.
 *
 * - оглавление-карточка с таймкодами; заголовки секций — TimeChip-кнопки (перемотка);
 * - активная секция (время плеера в [start, end)): левая полоса spark, заливка brand-soft, «Сейчас»;
 * - «Следить за видео» (по умолчанию выкл.): активная секция держится на 30% высоты окна;
 *   ручная прокрутка выключает режим и показывает «Вернуться к текущему месту»;
 * - поиск: <mark> через разбиение текста, «3 из 12», ↑/↓, Enter / Shift+Enter;
 * - на xl — мини-карта секций справа; типографика transcript 18/30, мера 68ch.
 */
export interface TranscriptViewProps {
  text: string;
  /** Текущее время плеера, с — подсветка активной секции */
  currentTime?: number | null;
  /** Перемотка плеера (клик по таймкоду секции/оглавления) */
  onSeek?: (sec: number) => void;
  /** Начальное состояние «Следить за видео» (переключатель виден, если есть currentTime) */
  follow?: boolean;
  /** Компактно: оглавление свёрнуто, без мини-карты, текст 17px (листы и предпросмотр) */
  compact?: boolean;
  /** Управляемый запрос поиска (вкладка «Термины» подставляет термин) */
  query?: string;
  onQueryChange?: (q: string) => void;
  /** id поля поиска — клавиша «/» на странице лекции */
  searchInputId?: string;
  /** Классы липкой панели поиска (смещение top и поля под контейнер страницы) */
  searchBarClassName?: string;
  /** Доп. классы панели, пока поиск пуст (страница лекции: на мобильных не липнет — место под текст) */
  searchBarIdleClassName?: string;
  /** Мини-карта секций справа на xl (страница лекции). Выкл. по умолчанию: в листах/превью
   *  ширина контейнера меньше окна, и колонка отняла бы место у текста */
  minimap?: boolean;
  /** Режим чтения: оглавление — липкая колонка справа (lg+) вместо карточки */
  stickyToc?: boolean;
  /** Готовый разбор (страница уже разобрала текст для полосы разделов) */
  parsed?: ParsedTranscript;
}

interface Range {
  start: number;
  end: number;
  /** Глобальный номер совпадения */
  g: number;
}
type RangesByKey = Map<string, Range[]>;

export function TranscriptView({
  text, currentTime, onSeek, follow = false, compact = false, query: queryProp, onQueryChange, searchInputId,
  searchBarClassName, searchBarIdleClassName, minimap = false, stickyToc = false, parsed: parsedProp,
}: TranscriptViewProps) {
  const { t } = useTranslation();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const parsed = useMemo(() => parsedProp ?? parseTranscript(text), [parsedProp, text]);
  const { sections, appendices } = parsed;
  const timeline = useMemo(() => sections.filter((s) => s.onTimeline), [sections]);
  const reduced = prefersReducedMotion();

  /* ── Поиск ── */
  const [innerQuery, setInnerQuery] = useState('');
  const query = queryProp ?? innerQuery;
  const setQuery = onQueryChange ?? setInnerQuery;
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query), 150);
    return () => window.clearTimeout(id);
  }, [query]);

  const units = useMemo(() => {
    const out: { key: string; text: string; section: number | null }[] = [];
    for (const s of sections) {
      if (s.heading) out.push({ key: `s${s.index}h`, text: s.heading, section: s.index });
      s.blocks.forEach((b, j) => out.push({ key: `s${s.index}b${j}`, text: b.text, section: s.index }));
    }
    appendices.forEach((a, k) => {
      if (a.title) out.push({ key: `a${k}t`, text: a.title, section: null });
      a.items.forEach((it, j) => out.push({ key: `a${k}i${j}`, text: it, section: null }));
    });
    return out;
  }, [sections, appendices]);

  const search = useMemo(() => {
    const byKey: RangesByKey = new Map();
    const list: { key: string; section: number | null }[] = [];
    if (debounced.trim().length < 2) return { byKey, list };
    for (const u of units) {
      const found = findMatches(u.text, debounced);
      if (!found.length) continue;
      byKey.set(
        u.key,
        found.map(([start, end]) => {
          list.push({ key: u.key, section: u.section });
          return { start, end, g: list.length - 1 };
        }),
      );
    }
    return { byKey, list };
  }, [units, debounced]);

  const [cur, setCur] = useState(0);
  useEffect(() => setCur(0), [debounced]);
  const total = search.list.length;
  const goNext = useCallback(() => setCur((c) => (total ? (c + 1) % total : 0)), [total]);
  const goPrev = useCallback(() => setCur((c) => (total ? (c - 1 + total) % total : 0)), [total]);
  useEffect(() => {
    if (!total) return;
    const el = document.getElementById(`${uid}-m-${cur}`);
    el?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    // reduced — не зависимость: значение одно на сессию
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur, search, uid]);
  const curMatchSection = total ? search.list[Math.min(cur, total - 1)]?.section ?? null : null;
  const curMatchStart = curMatchSection !== null ? sections[curMatchSection]?.startSec ?? null : null;

  /* ── Активная секция и «Следить за видео» ── */
  const canFollow = currentTime !== undefined && currentTime !== null && parsed.hasTimecodes;
  const active = canFollow ? activeSectionAt(sections, currentTime) : null;
  const activeIndex = active?.index ?? null;
  const [following, setFollowing] = useState(follow);
  const [pill, setPill] = useState(false);

  useEffect(() => {
    if (!following || activeIndex === null) return;
    const el = document.getElementById(`${uid}-s-${activeIndex}`);
    if (el) scrollToRatio(el, 0.3);
  }, [following, activeIndex, uid]);

  // Ручная прокрутка (колесо, касание, клавиши) выключает слежение
  useEffect(() => {
    if (!following) return;
    const stop = () => {
      setFollowing(false);
      setPill(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' '].includes(e.key)) stop();
    };
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchmove', stop, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchmove', stop);
      window.removeEventListener('keydown', onKey);
    };
  }, [following]);

  // Пилюля «Вернуться…» прячется, когда активная секция снова на экране
  useEffect(() => {
    if (!pill || activeIndex === null) return;
    const el = document.getElementById(`${uid}-s-${activeIndex}`);
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && entry.intersectionRatio > 0.2) setPill(false);
    }, { threshold: [0, 0.2, 0.5] });
    // Сразу после выключения секция ещё видна — ждём, пока пользователь уведёт её с экрана
    const id = window.setTimeout(() => io.observe(el), 1200);
    return () => {
      window.clearTimeout(id);
      io.disconnect();
    };
  }, [pill, activeIndex, uid]);

  const backToCurrent = () => {
    setPill(false);
    setFollowing(true);
    if (activeIndex !== null) {
      const el = document.getElementById(`${uid}-s-${activeIndex}`);
      if (el) scrollToRatio(el, 0.3);
    }
  };

  const jumpTo = (s: TranscriptSection) => {
    document.getElementById(`${uid}-s-${s.index}`)?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
  };
  const seekSection = (s: TranscriptSection) => {
    if (s.startSec !== null && onSeek) onSeek(s.startSec);
  };

  /* ── Оглавление ── */
  const tocItems = sections.filter((s) => s.heading || s.startSec !== null);
  const showTocCard = tocItems.length > 1;
  const [tocOpen, setTocOpen] = useState(!compact);
  const showMinimap = (minimap || stickyToc) && !compact && timeline.length > 1;
  const sectionTitle = (s: TranscriptSection) => s.heading ?? t('lecture.sectionN', { n: s.index + 1 });
  const bodySize = compact ? 'text-body-lg' : 'text-transcript';

  return (
    <div className={clsx(showMinimap && (stickyToc ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-10' : 'xl:grid xl:grid-cols-[minmax(0,1fr)_13rem] xl:gap-10'))}>
      <article className="min-w-0">
        {/* Липкая панель поиска */}
        <div
          className={clsx(
            'sticky z-10 -mt-1 mb-6 bg-card/95 py-2 backdrop-blur supports-[backdrop-filter]:bg-card/85',
            searchBarClassName ?? 'top-0',
            query.trim().length < 2 && searchBarIdleClassName,
          )}
        >
          <TranscriptSearch
            query={query}
            onQueryChange={setQuery}
            total={total}
            current={cur}
            onPrev={goPrev}
            onNext={goNext}
            inputId={searchInputId}
            extra={
              <>
                {total > 0 && curMatchStart !== null && (
                  <TimeChip seconds={curMatchStart} onClick={onSeek ? () => onSeek(curMatchStart) : undefined} className="shrink-0" />
                )}
                {canFollow && (
                  <FollowToggle
                    on={following}
                    onChange={(v) => {
                      setFollowing(v);
                      setPill(false);
                    }}
                  />
                )}
              </>
            }
          />
        </div>

        {/* Оглавление-карточка (в режиме чтения на lg+ — липкая колонка справа) */}
        {showTocCard && (
          <nav aria-label={t('lecture.toc')} className={clsx('mb-10 rounded-2xl border border-border bg-surface-2/60 p-4 sm:p-5', stickyToc && showMinimap && 'lg:hidden')}>
            <button
              type="button"
              onClick={() => setTocOpen((o) => !o)}
              aria-expanded={tocOpen}
              aria-label={tocOpen ? t('lecture.tocHide') : t('lecture.tocShow')}
              className="flex w-full items-center justify-between gap-3 rounded-lg text-left"
            >
              <span className="text-title text-fg">{t('lecture.toc')}</span>
              <Icon name="chevron-down" size={20} className={clsx('shrink-0 text-fg-2 transition-transform', tocOpen && 'rotate-180')} />
            </button>
            {tocOpen && (
              <ol className="mt-3 space-y-0.5">
                {tocItems.map((s) => (
                  <li
                    key={s.index}
                    className={clsx('flex items-start gap-3 rounded-lg px-2 py-1.5 transition-colors', s.index === activeIndex ? 'bg-brand-soft/60' : 'hover:bg-brand-soft/40')}
                  >
                    <a
                      href={`#${uid}-s-${s.index}`}
                      onClick={(e) => {
                        e.preventDefault();
                        jumpTo(s);
                      }}
                      aria-current={s.index === activeIndex ? 'true' : undefined}
                      className="flex min-w-0 flex-1 items-baseline gap-2.5 text-body text-fg hover:text-brand"
                    >
                      <span className="num shrink-0 text-fg-2">{s.index + 1}.</span>
                      <span className="min-w-0">{sectionTitle(s)}</span>
                    </a>
                    {s.startSec !== null && (
                      <TimeChip seconds={s.startSec} active={s.index === activeIndex} onClick={onSeek ? () => seekSection(s) : undefined} className="mt-0.5 shrink-0" />
                    )}
                  </li>
                ))}
                {appendices.length > 0 && (
                  <li className="flex items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-brand-soft/40">
                    <a
                      href={`#${uid}-appendix`}
                      onClick={(e) => {
                        e.preventDefault();
                        document.getElementById(`${uid}-appendix`)?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-body text-fg hover:text-brand"
                    >
                      <Icon name="book-open" size={16} className="shrink-0 text-fg-2" />
                      <span>{t('lecture.appendix.materials')}</span>
                    </a>
                  </li>
                )}
              </ol>
            )}
          </nav>
        )}

        {sections.map((s) => {
          const isActive = s.index === activeIndex;
          return (
            <section
              key={s.index}
              id={`${uid}-s-${s.index}`}
              aria-labelledby={s.heading || s.startSec !== null ? `${uid}-h-${s.index}` : undefined}
              className={clsx(
                'scroll-mt-40 transition-colors',
                s.index > 0 && 'mt-10',
                isActive && '-mx-4 rounded-r-2xl border-l-[3px] border-spark bg-brand-soft/40 py-4 pl-[13px] pr-4',
              )}
            >
              {(s.heading || s.startSec !== null) && (
                <header className="mb-4">
                  {s.startSec !== null && (
                    <div className="mb-2 flex flex-wrap items-center gap-2.5">
                      <TimeChip seconds={s.startSec} active={isActive} onClick={onSeek ? () => seekSection(s) : undefined} />
                      {isActive && <span className="eyebrow !text-spark-ink">{t('lecture.now')}</span>}
                    </div>
                  )}
                  <h3 id={`${uid}-h-${s.index}`} className="text-[1.25rem] font-semibold leading-7 text-fg">
                    <span className="text-fg-2">{s.index + 1}. </span>
                    <Highlighted text={sectionTitle(s)} ranges={s.heading ? search.byKey.get(`s${s.index}h`) : undefined} current={cur} uid={uid} />
                  </h3>
                </header>
              )}
              <SectionBody section={s} byKey={search.byKey} current={cur} uid={uid} bodySize={bodySize} />
            </section>
          );
        })}

        {appendices.length > 0 && (
          <section id={`${uid}-appendix`} aria-labelledby={`${uid}-appendix-h`} className="mt-12 scroll-mt-40 border-t border-border pt-8">
            <h3 id={`${uid}-appendix-h`} className="text-[1.25rem] font-semibold leading-7 text-fg">
              {t('lecture.appendix.materials')}
            </h3>
            {appendices.map((a, k) => {
              const ListTag = a.kind === 'questions' ? 'ol' : 'ul';
              return (
                <div key={k} className="mt-6">
                  <h4 className="text-body-lg font-semibold text-fg">
                    <Highlighted text={a.title || t(`lecture.appendix.${a.kind}`)} ranges={a.title ? search.byKey.get(`a${k}t`) : undefined} current={cur} uid={uid} />
                  </h4>
                  <ListTag className={clsx('mt-3 max-w-[68ch] space-y-1.5 pl-6 text-body-lg text-fg marker:text-fg-2', a.kind === 'questions' ? 'list-decimal' : 'list-disc')}>
                    {a.items.map((it, j) => (
                      <li key={j} className="pl-1">
                        <Highlighted text={it} ranges={search.byKey.get(`a${k}i${j}`)} current={cur} uid={uid} />
                      </li>
                    ))}
                  </ListTag>
                </div>
              );
            })}
          </section>
        )}
      </article>

      {/* Мини-карта секций (xl; в режиме чтения — липкое оглавление с lg) */}
      {showMinimap && (
        <aside className={clsx('hidden', stickyToc ? 'lg:block' : 'xl:block')}>
          <nav aria-label={stickyToc ? t('lecture.toc') : t('lecture.minimap')} className="sticky top-36">
            {stickyToc && <div className="eyebrow mb-3">{t('lecture.toc')}</div>}
            <ol className="space-y-1">
              {timeline.map((s) => {
                const isActive = s.index === activeIndex;
                const past = activeIndex !== null && s.index < activeIndex;
                return (
                  <li key={s.index}>
                    <button
                      type="button"
                      onClick={() => jumpTo(s)}
                      aria-current={isActive ? 'true' : undefined}
                      className="group flex w-full items-start gap-2.5 rounded-md py-1 text-left"
                    >
                      <span
                        aria-hidden
                        className={clsx(
                          'mt-2.5 h-[3px] shrink-0 rounded-full transition-all',
                          isActive ? 'w-6 bg-spark' : past ? 'w-4 bg-fg-2/50' : 'w-4 bg-border-strong',
                        )}
                      />
                      <span className={clsx('line-clamp-2 text-sm group-hover:text-fg', isActive ? 'font-semibold text-fg' : 'text-fg-2')}>
                        {sectionTitle(s)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        </aside>
      )}

      {/* «Вернуться к текущему месту» — после ручной прокрутки в режиме слежения */}
      {pill && activeIndex !== null && (
        <button
          type="button"
          onClick={backToCurrent}
          className="fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] left-1/2 z-30 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-body font-semibold text-white shadow-float transition-colors hover:bg-ink/90 dark:bg-fg dark:text-ink lg:bottom-6"
        >
          <Icon name="chevron-down" size={18} />
          {t('lecture.backToCurrent')}
        </button>
      )}
    </div>
  );
}

/* ── Текст секции (memo: время плеера меняется дважды в секунду, текст — нет) ── */
const SectionBody = memo(function SectionBody({
  section, byKey, current, uid, bodySize,
}: {
  section: TranscriptSection;
  byKey: RangesByKey;
  current: number;
  uid: string;
  bodySize: string;
}) {
  const groups: { type: 'p' | 'h' | 'ul'; items: { block: TranscriptBlock; j: number }[] }[] = [];
  section.blocks.forEach((block, j) => {
    const last = groups[groups.length - 1];
    if (block.type === 'li') {
      if (last?.type === 'ul') last.items.push({ block, j });
      else groups.push({ type: 'ul', items: [{ block, j }] });
    } else groups.push({ type: block.type, items: [{ block, j }] });
  });
  return (
    <div className="space-y-4">
      {groups.map((g) => {
        const first = g.items[0]!;
        const key = `s${section.index}b${first.j}`;
        if (g.type === 'h') {
          return (
            <h4 key={key} className="!mt-7 max-w-[68ch] text-body-lg font-semibold text-fg">
              <Highlighted text={first.block.text} ranges={byKey.get(key)} current={current} uid={uid} />
            </h4>
          );
        }
        if (g.type === 'ul') {
          return (
            <ul key={key} className={clsx('transcript max-w-[68ch] list-disc space-y-1.5 pl-6 text-fg marker:text-fg-2', bodySize)}>
              {g.items.map(({ block, j }) => (
                <li key={j} className="pl-1">
                  <Highlighted text={block.text} ranges={byKey.get(`s${section.index}b${j}`)} current={current} uid={uid} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={key} className={clsx('transcript max-w-[68ch] text-fg', bodySize)}>
            <Highlighted text={first.block.text} ranges={byKey.get(key)} current={current} uid={uid} />
          </p>
        );
      })}
    </div>
  );
});

/** Подсветка совпадений: текст режется на куски, совпадения — в <mark>. */
function Highlighted({ text, ranges, current, uid }: { text: string; ranges: Range[] | undefined; current: number; uid: string }) {
  if (!ranges?.length) return <>{text}</>;
  const parts: (string | JSX.Element)[] = [];
  let pos = 0;
  for (const r of ranges) {
    if (r.start > pos) parts.push(text.slice(pos, r.start));
    parts.push(
      <mark
        key={r.g}
        id={`${uid}-m-${r.g}`}
        className={clsx('rounded-sm px-0.5 text-fg', r.g === current ? 'bg-spark/60 ring-2 ring-spark-ink/50' : 'bg-spark/30')}
      >
        {text.slice(r.start, r.end)}
      </mark>,
    );
    pos = r.end;
  }
  if (pos < text.length) parts.push(text.slice(pos));
  return <>{parts}</>;
}
