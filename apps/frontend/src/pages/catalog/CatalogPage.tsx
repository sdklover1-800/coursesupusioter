import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { LANGUAGES, Role } from '@edu/shared';
import { useAuth } from '../../lib/auth';
import { isApproved, pickVersion, useCatalog, useMyCourses, type CatalogItem, type MyEnrollment } from '../../lib/catalog';
import { useFormat } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { Button, Card, Icon, SegmentedControl, Skeleton, buttonClass } from '../../components/ui';
import { EmptyState, ErrorState } from '../../components/page';
import { StatusPill } from '../../components/enrollment';
import { keepTogether } from '../../components/course/labels';

type LangFilter = 'all' | (typeof LANGUAGES)[number];

/** Порядок языков как в переключателе интерфейса: казахский первым. */
const byLangOrder = (a: string, b: string) => (LANGUAGES as readonly string[]).indexOf(a) - (LANGUAGES as readonly string[]).indexOf(b);

/**
 * Публичный каталог курсов (screen_specs «Public catalog…», Stepik-просто): фильтр
 * «Язык обучения: Все · Қазақша · Русский · English» со счётчиками, карточки с полосой
 * «Курс · Қаз · Рус · Eng» (общий помощник shell.langShort, никогда «KZ»), описанием и
 * мета-строкой «5 модулей · 15 лекций · ≈ 6 ч · Сертификат». Контент здесь не раскрывается.
 */
export function CatalogPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  useDocumentTitle(t('catalog.pageTitle'));
  const isStudent = user?.role === Role.STUDENT;
  const catalog = useCatalog();
  const mine = useMyCourses(isStudent);
  const byCourse = new Map((mine.data?.items ?? []).map((e) => [e.courseId, e]));
  const items = catalog.data?.items ?? [];
  const [filter, setFilter] = useState<LangFilter>('all');

  // Счётчики фильтра: сколько курсов доступно на каждом языке обучения
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of items) for (const v of new Set(it.versions.map((x) => x.language))) c[v] = (c[v] ?? 0) + 1;
    return c;
  }, [items]);
  const langs = LANGUAGES.filter((l) => counts[l]);
  const visible = filter === 'all' ? items : items.filter((it) => it.versions.some((v) => v.language === filter));

  // Путь студента: шаги отмечаются по мере продвижения (аккаунт → заявка → одобрение).
  const myItems = mine.data?.items ?? [];
  const steps = [
    { n: '01', title: t('catalog.step1'), hint: t('catalog.step1Hint'), done: !!user },
    { n: '02', title: t('catalog.step2'), hint: t('catalog.step2Hint'), done: myItems.length > 0 },
    { n: '03', title: t('catalog.step3'), hint: t('catalog.step3Hint'), done: myItems.some((e) => isApproved(e.status)) },
  ];

  return (
    <>
      {/* Hero: на ink — тёмная палитра токенов (fg-2 = #C4C5DA, ≥ 14px — §8) */}
      <section className="relative mb-8 overflow-hidden rounded-2xl bg-ink px-5 py-8 sm:px-10 sm:py-10">
        <div className="bg-inquiry-grid absolute inset-0 opacity-25" aria-hidden />
        <div data-theme="dark" className="relative text-fg">
          <p className="eyebrow">{t('catalog.eyebrow')}</p>
          <h1 className="mt-2 max-w-2xl font-display text-display-xl">{t('catalog.title')}</h1>
          <p className="mt-3 max-w-[62ch] text-body-lg text-fg-2">{t('catalog.subtitle')}</p>

          {user?.role !== Role.COURSE_MANAGER && user?.role !== Role.ADMIN && (
            <ol className="mt-8 grid gap-3 sm:grid-cols-3">
              {steps.map((s) => (
                <li key={s.n} className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
                  <span className={clsx('num font-semibold', s.done ? 'text-teal-ink' : 'text-spark-ink')}>
                    {s.done ? <Icon name="check" size={18} strokeWidth={2.5} label={t('ui.done')} /> : s.n}
                  </span>
                  <div className="min-w-0">
                    <div className={clsx('text-body font-semibold', s.done ? 'text-fg-2' : 'text-fg')}>{s.title}</div>
                    <div className="mt-0.5 text-meta text-fg-2">{s.hint}</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      {catalog.isLoading ? (
        <div className="grid gap-5 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <Card key={i} className="space-y-4">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-7 w-3/4" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-11 w-full" />
            </Card>
          ))}
        </div>
      ) : catalog.isError ? (
        <div className="space-y-3 text-center">
          <ErrorState message={t('catalog.loadError')} />
          <Button variant="secondary" onClick={() => void catalog.refetch()}>{t('common.retry')}</Button>
        </div>
      ) : !items.length ? (
        <EmptyState title={t('catalog.empty')} hint={t('catalog.emptyHint')} />
      ) : (
        <>
          {langs.length > 1 && (
            <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-label font-semibold text-fg" id="catalog-lang-filter">{t('catalog.filterLabel')}</span>
              {/* Телефон: сетка 2×2 (kk-подписи длиннее — ряд из четырёх не помещается в 390px), от sm — один ряд */}
              <div className="w-full sm:w-auto">
                <SegmentedControl<LangFilter>
                  ariaLabel={t('catalog.filterLabel')}
                  tone="brand"
                  className="grid w-full grid-cols-2 !rounded-2xl sm:inline-flex sm:w-auto sm:!rounded-full"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: 'all', label: <FilterLabel text={t('catalog.filterAll')} count={items.length} /> },
                    ...langs.map((l) => ({
                      value: l,
                      lang: l,
                      label: <FilterLabel text={t(`languages.${l}`)} count={counts[l] ?? 0} />,
                    })),
                  ]}
                />
              </div>
            </div>
          )}
          {visible.length ? (
            <div className={clsx('grid grid-cols-1 gap-5 md:grid-cols-2', visible.length >= 3 && 'xl:grid-cols-3')}>
              {visible.map((c) => <CourseCard key={c.id} course={c} enrollment={byCourse.get(c.id)} lang={filter === 'all' ? null : filter} />)}
            </div>
          ) : (
            <EmptyState title={t('catalog.filterEmpty')} />
          )}
        </>
      )}
    </>
  );
}

function FilterLabel({ text, count }: { text: string; count: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {text}
      <span className="num opacity-80">{count}</span>
    </span>
  );
}

/**
 * Карточка курса (§8: ≤ 3 уровня текста): полоса «Курс · Қаз · Рус · Eng», название, описание
 * (3 строки), ОДНА мета-строка и ОДИН статус заявки. Ссылка растянута на всю карточку.
 */
function CourseCard({ course, enrollment, lang }: { course: CatalogItem; enrollment?: MyEnrollment; lang: string | null }) {
  const { t, i18n } = useTranslation();
  const { formatDuration } = useFormat();
  const v = (lang && course.versions.find((x) => x.language === lang)) || pickVersion(course.versions, i18n.language);
  if (!v) return null;
  const langList = [...new Set(course.versions.map((x) => x.language))].sort(byLangOrder);
  const strip = t('catalog.cardStrip', { langs: langList.map((l) => t(`shell.langShort.${l}`)).join(' · ') });
  const meta = [
    t('course.count.modules', { count: v.moduleCount }),
    t('course.count.lectures', { count: v.lectureCount }),
    v.durationSec ? keepTogether(formatDuration(v.durationSec, 'human')) : null,
    v.hasCertificate ? t('catalog.metaCertificate') : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <article className="card group relative flex flex-col overflow-hidden transition-colors hover:border-brand/40 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand">
      <div className="flex min-h-[2.5rem] items-center justify-between gap-3 bg-brand-soft px-5 py-1.5">
        <span className="text-label font-semibold text-brand">
          <span aria-hidden>{strip}</span>
          <span className="sr-only">{t('catalog.languages')}: {langList.map((l) => t(`languages.${l}`)).join(', ')}</span>
        </span>
        {enrollment && <StatusPill status={enrollment.status} />}
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h2 className="font-display text-display-md" lang={v.language}>
          <Link to={`/catalog/${course.id}`} className="outline-none after:absolute after:inset-0 after:content-[''] group-hover:text-brand">
            {v.title}
          </Link>
        </h2>
        {v.description && <p className="mt-2 line-clamp-3 max-w-[62ch] text-body text-fg-2" lang={v.language}>{v.description}</p>}
        <div className="mt-auto pt-5">
          <p className="border-t border-dotted border-border-strong pt-4 text-meta text-fg-2">{meta}</p>
          <span className={buttonClass('secondary', 'md', 'mt-4 w-full group-hover:border-brand/50 group-hover:text-brand')} aria-hidden>
            {t('catalog.details')}
            <Icon name="arrow-right" size={18} className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>
    </article>
  );
}
