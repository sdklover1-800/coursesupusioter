import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { Role } from '@edu/shared';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import {
  isApproved, pickVersion, useCancelRequest, useCatalogCourse, useMyCourses, useRequestEnrollment,
  type CatalogCourse, type CatalogVersion, type MyEnrollment,
} from '../../lib/catalog';
import { useFormat } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { Button, Card, Icon, KindIcon, ModeBadge, QuestionGlyph, Select, Skeleton, toast } from '../../components/ui';
import { EmptyState, ErrorState, MeterBar } from '../../components/page';
import { ChevronIcon, LinkButton, LockIcon, StatusPill } from '../../components/enrollment';
import { StatStrip, type StatCell } from '../../components/course/StatStrip';
import { CertificatePreview } from '../../components/course/CertificatePreview';
import { certificateRule, cleanModuleTitle, cleanTitle, languageName, romanOf } from '../../components/course/labels';

/** Ссылка на силлабус/сведения о преподавателе (A28) — если PI предоставил PDF. */
const SYLLABUS_URL = (import.meta.env.VITE_SYLLABUS_URL as string | undefined)?.trim() || null;

/**
 * Публичная страница курса (screen_specs «Public catalog and course page»): hero с языками
 * и полосой цифр, блок «В курсе», типизированная программа I–V (лекция ▶ с длительностью,
 * мини-квиз · тренировка, модульный тест · оценивание, итоговый практикум) с сертификатом
 * в конце, образец сертификата и «Как получить сертификат?». Действие по состоянию —
 * прежняя логика заявок: аноним → регистрация; студент → заявка/статус; одобрено → курс.
 * Контент курса (видео, расшифровки, вопросы) здесь не раскрывается.
 */
export function CatalogCoursePage() {
  const { t, i18n } = useTranslation();
  const { formatDuration } = useFormat();
  const { courseId } = useParams();
  const { user } = useAuth();
  const q = useCatalogCourse(courseId);
  const mine = useMyCourses(user?.role === Role.STUDENT);
  const enrollment = mine.data?.items.find((e) => e.courseId === courseId);
  const [versionId, setVersionId] = useState<string | null>(null);
  const course = q.data?.course;
  // Выбранная версия: явный выбор → язык заявки студента → язык интерфейса → первая.
  const version = course?.versions.length
    ? course.versions.find((v) => v.id === versionId) ??
      course.versions.find((v) => v.id === enrollment?.languageVersion.id) ??
      pickVersion(course.versions, i18n.language)!
    : undefined;
  useDocumentTitle(version?.title ?? t('catalog.pageTitle'));

  if (q.isLoading) return <CoursePageSkeleton />;
  if (q.isError) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <>
        <BackLink />
        {notFound ? (
          <EmptyState title={t('catalog.notFound')} action={<LinkButton to="/catalog" variant="secondary">{t('catalog.back')}</LinkButton>} />
        ) : (
          <ErrorState message={t('catalog.loadError')} />
        )}
      </>
    );
  }
  if (!course || !version) return null;

  const modules = [...version.modules].sort((a, b) => a.orderIndex - b.orderIndex);
  const lectureCount = modules.reduce((n, m) => n + m.lectures.length, 0);
  const quizModules = modules.filter((m) => m.assessmentType === 'QUIZ');
  const hasPractical = modules.some((m) => m.assessmentType === 'PRACTICAL' || m.hasPractical);
  const hasMini = modules.some((m) => m.lectures.some((l) => l.hasMiniQuiz));
  const locked = !enrollment || !isApproved(enrollment.status);
  const onlyOther = course.versions.length === 1 && course.versions[0]!.language !== i18n.language ? course.versions[0]!.language : null;

  const cells: StatCell[] = [
    {
      key: 'lectures',
      value: lectureCount,
      label: `${t('course.stat.lectures', { count: lectureCount })} ${t('course.stat.inModules', { count: modules.length })}`,
    },
  ];
  if (version.durationSec) cells.push({ key: 'video', value: formatDuration(version.durationSec, 'human'), label: t('course.stat.video') });
  if (quizModules.length) {
    cells.push({ key: 'quizzes', value: quizModules.length, label: `${t('course.stat.quizzes', { count: quizModules.length })} · ${t('course.stat.quizzesHint')}` });
  }
  if (hasPractical) {
    cells.push({ key: 'practical', value: <QuestionGlyph size={26} />, label: `${t('course.stat.practical')} ${t('course.stat.practicalHint')}` });
  }
  const rule = certificateRule(t, 'PASS_ALL', {
    lectures: lectureCount,
    quizModuleIndexes: quizModules.map((m) => m.orderIndex),
    hasPractical,
  });

  return (
    <>
      <BackLink />

      {/* Шапка курса: на ink — тёмная палитра токенов */}
      <section data-theme="dark" className="relative overflow-hidden rounded-2xl bg-ink px-5 py-8 text-fg sm:px-10 sm:py-10">
        <div className="bg-inquiry-grid absolute inset-0 opacity-25" aria-hidden />
        <div className="relative">
          {course.versions.length > 1 && (
            <div role="radiogroup" aria-label={t('catalog.courseLanguage')} className="mb-6 flex flex-wrap items-center gap-2">
              <span className="eyebrow mr-1">{t('catalog.courseLanguage')}</span>
              {course.versions.map((v) => {
                const active = v.id === version.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    lang={v.language}
                    onClick={() => setVersionId(v.id)}
                    className={clsx(
                      'min-h-[2.25rem] rounded-full px-3.5 py-1 text-label font-semibold transition-colors focus-visible:outline-spark',
                      active ? 'bg-spark text-ink' : 'bg-white/[0.08] text-fg-2 hover:bg-white/15 hover:text-fg',
                    )}
                  >
                    {t(`languages.${v.language}`)}
                  </button>
                );
              })}
            </div>
          )}
          <h1 lang={version.language} className="max-w-3xl font-display text-display-xl">{version.title}</h1>
          {version.description && (
            <p lang={version.language} className="mt-3 max-w-[62ch] text-body-lg text-fg-2">{version.description}</p>
          )}
          {onlyOther && (
            <p className="mt-3 inline-flex items-center gap-2 text-meta text-fg-2">
              <Icon name="globe" size={16} />
              {t(`catalog.onlyIn.${onlyOther}`, { defaultValue: '' })}
            </p>
          )}
          <StatStrip cells={cells} tone="dark" className="mt-6 max-w-3xl" />
        </div>
      </section>

      {/* Мобильные: действие → «В курсе» и программа → сертификат; lg: справа действие и сертификат */}
      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <aside className="lg:col-start-2 lg:row-start-1">
          <EnrollPanel course={course} version={version} onVersionChange={setVersionId} enrollment={enrollment} enrollmentLoading={mine.isLoading} />
        </aside>

        <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <Included course={course} lectureCount={lectureCount} quizCount={quizModules.length} hasPractical={hasPractical} hasMini={hasMini} />
          <Syllabus version={version} modules={modules} locked={locked} />
        </div>

        <div className="space-y-6 lg:col-start-2 lg:row-start-2">
          <Card className="!p-5">
            <h2 className="font-sans text-title">{t('catalog.certificatePreview')}</h2>
            <CertificatePreview title={version.title} sample className="mt-3" />
            <p className="mt-3 text-meta text-fg-2">{rule}</p>
          </Card>
          <HowToGetCertificate quizzes={quizModules.length > 0} practical={hasPractical} />
          {SYLLABUS_URL && (
            <a
              href={SYLLABUS_URL}
              target="_blank"
              rel="noreferrer"
              className="card flex items-center gap-3 !p-4 text-body font-semibold text-brand transition-colors hover:border-brand/50"
            >
              <Icon name="file-text" size={20} />
              <span className="flex-1">{t('catalog.syllabusLink')}</span>
              <Icon name="external-link" size={16} />
            </a>
          )}
        </div>
      </div>
    </>
  );
}

function BackLink() {
  const { t } = useTranslation();
  return (
    <Link to="/catalog" className="mb-4 inline-flex items-center gap-1.5 rounded-lg text-body font-semibold text-fg-2 transition-colors hover:text-fg">
      <Icon name="arrow-left" size={16} /> {t('catalog.back')}
    </Link>
  );
}

function CoursePageSkeleton() {
  return (
    <>
      <Skeleton className="mb-4 h-5 w-40" />
      <Skeleton className="h-56 w-full rounded-2xl" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Skeleton className="h-80 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    </>
  );
}

/* ── «В курсе» ───────────────────────────────────────────── */
function Included({
  course, lectureCount, quizCount, hasPractical, hasMini,
}: {
  course: CatalogCourse;
  lectureCount: number;
  quizCount: number;
  hasPractical: boolean;
  hasMini: boolean;
}) {
  const { t } = useTranslation();
  const langs = course.versions.map((v) => t(`languages.${v.language}`)).join(', ');
  const items: { key: string; icon: ReactNode; text: string; badge?: ReactNode }[] = [
    { key: 'lectures', icon: <KindIcon kind="LECTURE" size={28} />, text: t('catalog.incLectures', { count: lectureCount }) },
    ...(hasMini ? [{ key: 'mini', icon: <KindIcon kind="MINI_QUIZ" size={28} />, text: t('catalog.inc.mini'), badge: <ModeBadge mode="practice" /> }] : []),
    ...(quizCount ? [{ key: 'quiz', icon: <KindIcon kind="MODULE_QUIZ" size={28} />, text: t('course.count.quizzes', { count: quizCount }), badge: <ModeBadge mode="graded" /> }] : []),
    ...(hasPractical ? [{ key: 'practical', icon: <KindIcon kind="PRACTICAL" size={28} />, text: t('catalog.inc.practical') }] : []),
    { key: 'certificate', icon: <KindIcon kind="CERTIFICATE" size={28} />, text: t('catalog.inc.certificate') },
    { key: 'languages', icon: <span className="grid h-7 w-7 place-items-center rounded-md border border-border-strong text-fg-2"><Icon name="globe" size={16} /></span>, text: t('catalog.incLanguages', { list: langs }) },
  ];
  return (
    <Card className="!p-5 sm:!p-6">
      <h2 className="font-sans text-title">{t('catalog.inCourse')}</h2>
      <ul className="mt-4 grid gap-x-6 gap-y-3.5 sm:grid-cols-2">
        {items.map((it) => (
          <li key={it.key} className="flex items-start gap-3">
            <span className="shrink-0" aria-hidden>{it.icon}</span>
            <span className="min-w-0 pt-0.5 text-body text-fg">
              {it.text}
              {it.badge && <span className="ml-2 inline-flex align-middle">{it.badge}</span>}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ── Программа курса (типизированный аккордеон I–V) ──────── */
function Syllabus({ version, modules, locked }: { version: CatalogVersion; modules: CatalogVersion['modules']; locked: boolean }) {
  const { t } = useTranslation();
  const { formatDuration } = useFormat();
  const firstId = modules[0]?.id;
  const [open, setOpen] = useState<Set<string>>(() => new Set(firstId ? [firstId] : []));
  // Смена языковой версии — другие id модулей: раскрываем первый заново.
  useEffect(() => { setOpen(new Set(firstId ? [firstId] : [])); }, [version.id, firstId]);
  const allOpen = modules.length > 0 && modules.every((m) => open.has(m.id));

  function toggle(id: string) {
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  const row = (key: string, icon: ReactNode, text: ReactNode, right?: ReactNode, muted?: boolean) => (
    <li key={key} className={clsx('flex items-center gap-3 py-2', muted && 'text-fg-2')}>
      <span className="shrink-0" aria-hidden>{icon}</span>
      <span lang={version.language} className="min-w-0 flex-1 text-body">{text}</span>
      {right}
      {locked && !muted && <LockIcon className="h-3.5 w-3.5 shrink-0 text-fg-2" />}
    </li>
  );

  return (
    <Card className="!p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
        <h2 className="font-sans text-title">{t('catalog.syllabus')}</h2>
        {modules.length > 1 && (
          <button
            type="button"
            onClick={() => setOpen(allOpen ? new Set() : new Set(modules.map((m) => m.id)))}
            className="min-h-[2.25rem] rounded-lg px-2 text-label font-semibold text-brand transition-colors hover:bg-brand-soft"
          >
            {allOpen ? t('catalog.collapseAll') : t('catalog.expandAll')}
          </button>
        )}
      </div>

      <ol className="divide-y divide-border">
        {modules.map((m) => {
          const isOpen = open.has(m.id);
          const panelId = `module-panel-${m.id}`;
          const lectures = [...m.lectures].sort((a, b) => a.orderIndex - b.orderIndex);
          const practical = m.assessmentType === 'PRACTICAL' || !!m.hasPractical;
          const roman = romanOf(m.orderIndex);
          return (
            <li key={m.id}>
              <h3 className="font-sans">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => toggle(m.id)}
                  className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-brand-soft/40 sm:gap-4 sm:px-6"
                >
                  <span className="w-9 shrink-0 font-display text-display-md text-fg" aria-hidden>{roman}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-label text-fg-2">
                      {t('course.moduleNo', { roman })} · {t('course.count.lectures', { count: lectures.length })}
                    </span>
                    <span lang={version.language} className="mt-0.5 block text-body font-semibold text-fg">{cleanModuleTitle(m.title)}</span>
                  </span>
                  <ChevronIcon className={clsx('h-4 w-4 shrink-0 text-fg-2 transition-transform duration-200', isOpen && 'rotate-180')} />
                </button>
              </h3>

              {isOpen && (
                <div id={panelId} className="px-5 pb-4 sm:px-6 sm:pl-[4.75rem]">
                  <ol>
                    {lectures.map((l) =>
                      row(
                        l.id,
                        <KindIcon kind="LECTURE" size={20} />,
                        <>
                          {cleanTitle(l.title)}
                          {l.hasMiniQuiz && (
                            <span className="mt-0.5 flex items-center gap-1.5 text-meta text-fg-2">
                              <KindIcon kind="MINI_QUIZ" size={16} />
                              {t('catalog.row.mini')}
                            </span>
                          )}
                        </>,
                        l.durationSec ? <span className="num shrink-0 text-fg-2">{formatDuration(l.durationSec, 'clock')}</span> : undefined,
                      ),
                    )}
                    {!practical &&
                      row(
                        `${m.id}-quiz`,
                        <KindIcon kind="MODULE_QUIZ" size={20} />,
                        <span className="font-medium">
                          {m.quizQuestionCount
                            ? t('catalog.row.quiz', { questions: t('course.count.questions', { count: m.quizQuestionCount }) })
                            : t('catalog.row.quizNoCount')}
                        </span>,
                      )}
                    {practical &&
                      row(`${m.id}-practical`, <KindIcon kind="PRACTICAL" size={20} />, <span className="font-medium">{t('catalog.row.practical')}</span>)}
                  </ol>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {/* Путь заканчивается сертификатом (Scrimba) */}
      <ol className="border-t border-border px-5 py-3 sm:px-6">
        {version.hasFinalMiniQuiz && row('final-mini', <KindIcon kind="FINAL_MINI_QUIZ" size={20} />, t('catalog.row.finalMini'), undefined, true)}
        {row('certificate', <KindIcon kind="CERTIFICATE" size={20} />, t('catalog.row.certificate'), undefined, true)}
      </ol>

      {locked && (
        <div className="flex items-center gap-2 border-t border-border px-5 py-3 text-meta text-fg-2 sm:px-6">
          <LockIcon className="h-3.5 w-3.5 shrink-0" /> {t('catalog.lockedHint')}
        </div>
      )}
    </Card>
  );
}

/* ── «Как получить сертификат?» ──────────────────────────── */
function HowToGetCertificate({ quizzes, practical }: { quizzes: boolean; practical: boolean }) {
  const { t } = useTranslation();
  const steps = [
    t('catalog.howToGetLectures'),
    ...(quizzes ? [t('catalog.howToGetQuizzes')] : []),
    ...(practical ? [t('catalog.howToGetPractical')] : []),
    t('catalog.howToGetIssue'),
  ];
  return (
    <details className="card group !p-0" open>
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-2xl px-5 py-4 [&::-webkit-details-marker]:hidden">
        <Icon name="award" size={20} className="text-spark-ink" />
        <span className="flex-1 text-title">{t('catalog.howToGet')}</span>
        <ChevronIcon className="h-4 w-4 shrink-0 text-fg-2 transition-transform group-open:rotate-180" />
      </summary>
      <ol className="space-y-2.5 px-5 pb-5">
        {steps.map((s, i) => (
          <li key={s} className="flex gap-3 text-body text-fg">
            <span className="num grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">{i + 1}</span>
            <span className="min-w-0">{s}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

/* ── Блок действия по состоянию (логика заявок без изменений) ─ */
function EnrollPanel({ course, version, onVersionChange, enrollment, enrollmentLoading }: {
  course: CatalogCourse;
  version: CatalogVersion;
  onVersionChange: (id: string) => void;
  enrollment?: MyEnrollment;
  enrollmentLoading: boolean;
}) {
  const { t } = useTranslation();
  const { user, loading } = useAuth();

  if (loading || (user?.role === Role.STUDENT && enrollmentLoading)) {
    return (
      <Card className="space-y-4">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-11 w-full" />
      </Card>
    );
  }

  // Аноним: регистрация (с возвратом на эту страницу) или вход
  if (!user) {
    const next = encodeURIComponent(`/catalog/${course.id}`);
    return (
      <Card className="!p-5 sm:!p-6">
        <QuestionGlyph size={40} />
        <h2 className="mt-4 font-sans text-title">{t('catalog.ctaAnonTitle')}</h2>
        <p className="mt-2 text-body text-fg-2">{t('catalog.ctaAnonText')}</p>
        <div className="mt-5 space-y-2">
          <LinkButton to={`/register?next=${next}`} size="lg" className="!h-auto min-h-[3rem] w-full py-2.5 text-center leading-snug">{t('catalog.registerAndApply')}</LinkButton>
          <LinkButton to={`/login?next=${next}`} variant="secondary" className="w-full">{t('auth.signIn')}</LinkButton>
        </div>
      </Card>
    );
  }

  // Менеджер/админ: заявки обрабатываются на отдельной странице
  if (user.role !== Role.STUDENT) {
    return (
      <Card className="!p-5 sm:!p-6">
        <p className="eyebrow">{t('catalog.staffTitle')}</p>
        <p className="mt-2 text-body text-fg">{t('catalog.staffText')}</p>
        <LinkButton to={`/manage/requests?courseId=${course.id}`} variant="secondary" className="mt-5 w-full">
          {t('catalog.openRequests')}
          <Icon name="arrow-right" size={16} />
        </LinkButton>
      </Card>
    );
  }

  if (enrollment && isApproved(enrollment.status)) return <ApprovedPanel course={course} enrollment={enrollment} />;
  if (enrollment?.status === 'PENDING') return <PendingPanel enrollment={enrollment} />;
  return <ApplyPanel course={course} version={version} onVersionChange={onVersionChange} enrollment={enrollment} />;
}

function ApplyPanel({ course, version, onVersionChange, enrollment }: {
  course: CatalogCourse; version: CatalogVersion; onVersionChange: (id: string) => void; enrollment?: MyEnrollment;
}) {
  const { t } = useTranslation();
  const { formatDate } = useFormat();
  const request = useRequestEnrollment(course.id);
  const again = enrollment?.status === 'REJECTED' || enrollment?.status === 'WITHDRAWN';

  function submit() {
    request.mutate(version.id, {
      onSuccess: () => toast(t('catalog.applied'), 'teal'),
      onError: (err) => toast(err instanceof ApiError ? err.message : t('errors.generic'), 'danger'),
    });
  }

  return (
    <Card className="!p-5 sm:!p-6">
      {again && enrollment ? (
        <>
          <StatusPill status={enrollment.status} />
          <h2 className="mt-3 font-sans text-title">
            {enrollment.status === 'REJECTED' ? t('catalog.rejectedTitle') : t('catalog.withdrawnTitle')}
          </h2>
          {enrollment.reviewedAt && <p className="mt-1 text-meta text-fg-2">{t('requests.reviewedOn', { date: formatDate(enrollment.reviewedAt) })}</p>}
          {enrollment.reviewNote && (
            <blockquote className="mt-4 rounded-xl border border-border bg-surface px-4 py-3 text-body">
              <div className="mb-1 text-label text-fg-2">{t('catalog.reviewNote')}</div>
              {enrollment.reviewNote}
            </blockquote>
          )}
          <p className="mt-3 text-body text-fg-2">{t('catalog.rejectedText')}</p>
        </>
      ) : (
        <>
          <h2 className="font-sans text-title">{t('catalog.ctaApplyTitle')}</h2>
          <p className="mt-2 text-body text-fg-2">{t('catalog.ctaApplyText')}</p>
        </>
      )}

      <div className="mt-5 space-y-1.5">
        <label htmlFor="apply-lang" className="text-label font-semibold text-fg">{t('catalog.studyLanguage')}</label>
        {course.versions.length > 1 ? (
          <Select id="apply-lang" value={version.id} onChange={(e) => onVersionChange(e.target.value)}>
            {course.versions.map((v) => <option key={v.id} value={v.id}>{t(`languages.${v.language}`)}</option>)}
          </Select>
        ) : (
          <div id="apply-lang" className="flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-body" lang={version.language}>
            <Icon name="globe" size={16} className="text-fg-2" /> {languageName(t, version.language)}
          </div>
        )}
      </div>
      <Button size="lg" className="mt-4 w-full" loading={request.isPending} onClick={submit}>
        {again ? t('catalog.applyAgain') : t('catalog.apply')}
      </Button>
      <p className="mt-3 flex items-center gap-2 text-meta text-fg-2">
        <LockIcon className="h-3.5 w-3.5 shrink-0" /> {t('catalog.lockedHint')}
      </p>
    </Card>
  );
}

function PendingPanel({ enrollment }: { enrollment: MyEnrollment }) {
  const { t } = useTranslation();
  const { formatDate } = useFormat();
  const cancel = useCancelRequest();
  const [confirming, setConfirming] = useState(false);

  function doCancel() {
    cancel.mutate(enrollment.id, {
      onSuccess: () => { toast(t('catalog.cancelled'), 'brand'); setConfirming(false); },
      onError: (err) => toast(err instanceof ApiError ? err.message : t('errors.generic'), 'danger'),
    });
  }

  return (
    <Card className="border-spark/40 !p-5 sm:!p-6">
      <span className="relative grid h-10 w-10 place-items-center rounded-full bg-spark/15 text-spark-ink" aria-hidden>
        <Icon name="clock" size={20} />
        <span className="absolute right-0 top-0 h-2.5 w-2.5 animate-pulse rounded-full bg-spark ring-2 ring-card" />
      </span>
      <h2 className="mt-3 font-sans text-title">{t('catalog.pendingTitle')}</h2>
      <p className="mt-2 text-body text-fg-2">{t('catalog.pendingText')}</p>
      <dl className="mt-4 space-y-2 rounded-xl bg-surface px-4 py-3 text-meta">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-fg-2">{t('catalog.studyLanguage')}</dt>
          <dd className="font-semibold">{t(`languages.${enrollment.languageVersion.language}`)}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-fg-2">{t('requests.colRequested')}</dt>
          <dd className="text-fg">{formatDate(enrollment.requestedAt)}</dd>
        </div>
      </dl>
      {confirming ? (
        <div className="mt-4 rounded-xl border border-danger/30 bg-danger/8 p-3" role="group" aria-label={t('catalog.cancelConfirm')}>
          <p className="text-body font-semibold">{t('catalog.cancelConfirm')}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="secondary" size="sm" autoFocus onClick={() => setConfirming(false)} disabled={cancel.isPending}>{t('catalog.keep')}</Button>
            <Button variant="danger" size="sm" loading={cancel.isPending} onClick={doCancel}>{t('catalog.cancelYes')}</Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" className="mt-4 w-full" onClick={() => setConfirming(true)}>{t('catalog.cancelRequest')}</Button>
      )}
    </Card>
  );
}

function ApprovedPanel({ course, enrollment }: { course: CatalogCourse; enrollment: MyEnrollment }) {
  const { t } = useTranslation();
  const completed = enrollment.status === 'COMPLETED';
  const pct = Math.round(enrollment.summary?.progress.percent ?? enrollment.progressPercent ?? 0);
  return (
    <Card className="border-teal/40 !p-5 sm:!p-6">
      <StatusPill status={enrollment.status} />
      <h2 className="mt-3 font-sans text-title">{completed ? t('catalog.completedTitle') : t('catalog.activeTitle')}</h2>
      <div className="mt-4">
        <MeterBar value={pct / 100} tone="teal" label={t('student.progress')} />
      </div>
      <LinkButton to={`/learn/${course.id}/${enrollment.id}`} size="lg" className="mt-5 w-full">
        {t('catalog.goToCourse')}
        <Icon name="arrow-right" size={18} />
      </LinkButton>
    </Card>
  );
}
