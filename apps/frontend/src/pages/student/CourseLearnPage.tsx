import { useEffect, useRef } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { routes, useLearnView, type LearnView } from '../../lib/learn';
import { useFormat } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { Breadcrumb, Card, Icon, KindIcon, ModeBadge, QuestionGlyph, Skeleton, buttonClass } from '../../components/ui';
import { MiniQuiz } from '../../components/MiniQuiz';
import { ContentError } from '../../components/enrollment';
import { CourseMap } from '../../components/course/CourseMap';
import { ModuleSection } from '../../components/course/ModuleSection';
import { StatStrip, type StatCell } from '../../components/course/StatStrip';
import { ProgressCard } from '../../components/course/ProgressCard';
import { CertificateCard } from '../../components/course/CertificateCard';
import { HowItWorksCard } from '../../components/course/HowItWorksCard';
import { CourseLanguageRow } from '../../components/course/CourseLanguageDialog';
import {
  certificateFacts, itemLongName, itemShortName, languageName, nextHref, romanRange, totalDuration,
} from '../../components/course/labels';

/**
 * Страница курса студента (screen_specs «Course home»): крошки, герой с полосой цифр
 * и «Продолжить: …», карта курса, программа по модулям (липкая колонка модуля на lg),
 * карточки модульных тестов и итогового практикума, итоговый мини-квиз (если есть);
 * на xl — правый липкий рельс: прогресс, сертификат, «Как устроен курс», язык курса.
 * Порядок изучения свободный (USER_DECISIONS §3): подсвечен только рекомендуемый шаг.
 */
export function CourseLearnPage() {
  const { t } = useTranslation();
  const { courseId, enrollmentId } = useParams();
  const { data, isLoading, error } = useLearnView(courseId, enrollmentId);
  useDocumentTitle(data?.version.title ?? t('nav.myCourses'));

  if (isLoading) return <CoursePageSkeleton />;
  // 403 ENROLLMENT_NOT_APPROVED — дружелюбный экран со ссылкой на страницу курса
  if (error) return <ContentError error={error} courseId={courseId} enrollmentId={enrollmentId} />;
  if (!data || !courseId || !enrollmentId) return null;
  return <CourseHome view={data} courseId={courseId} enrollmentId={enrollmentId} />;
}

function CourseHome({ view, courseId, enrollmentId }: { view: LearnView; courseId: string; enrollmentId: string }) {
  const { t } = useTranslation();
  const { formatDuration } = useFormat();
  const { hash } = useLocation();
  const modules = [...view.version.modules].sort((a, b) => a.orderIndex - b.orderIndex);
  const next = view.next;
  const lang = view.version.language;
  const facts = certificateFacts(modules);
  const duration = totalDuration(modules);
  const quizCount = modules.filter((m) => m.quiz).length;
  const hasPractical = modules.some((m) => m.practicalTask);
  // Практикум «охватывает модули I–IV» — все модули, кроме его собственного
  const practicalModule = modules.find((m) => m.practicalTask);
  const coversRange = romanRange(modules.filter((m) => m !== practicalModule).map((m) => m.orderIndex));

  const cells: StatCell[] = [
    {
      key: 'lectures',
      value: facts.lectures,
      label: `${t('course.stat.lectures', { count: facts.lectures })} ${t('course.stat.inModules', { count: modules.length })}`,
    },
  ];
  if (duration) cells.push({ key: 'video', value: formatDuration(duration, 'human'), label: t('course.stat.video') });
  if (quizCount) cells.push({ key: 'quizzes', value: quizCount, label: `${t('course.stat.quizzes', { count: quizCount })} · ${t('course.stat.quizzesHint')}` });
  if (hasPractical) {
    cells.push({
      key: 'practical',
      value: <QuestionGlyph size={26} className="align-middle" />,
      label: `${t('course.stat.practical')} ${t('course.stat.practicalHint')}`,
    });
  }

  // Мобильные: один раз прокрутить к рекомендуемому шагу (или к якорю из адреса)
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current) return;
    scrolled.current = true;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('a11y');
    const behavior: ScrollBehavior = reduce ? 'auto' : 'smooth';
    const anchor = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
    if (anchor) {
      anchor.scrollIntoView({ block: 'start', behavior });
      return;
    }
    const mobile = window.matchMedia?.('(max-width: 1023px)').matches;
    if (!mobile || !next) return;
    const el = document.getElementById(`item-${next.id}`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top >= 0 && r.bottom <= window.innerHeight - 140) return; // уже на экране
    el.scrollIntoView({ block: 'center', behavior });
  }, [hash, next]);

  const resumeHref = next ? nextHref(courseId, enrollmentId, next) : null;
  const resumeLabel = next
    ? next.kind === 'CERTIFICATE'
      ? t('course.certificateCta')
      : t('course.resume', { name: itemLongName(t, next) })
    : null;

  return (
    <>
      <Breadcrumb items={[{ label: t('nav.myCourses'), to: routes.home() }, { label: view.version.title }]} className="mb-4" />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px] xl:gap-8">
        {/* Герой */}
        <header className="xl:col-start-1">
          <p className="eyebrow">{t('course.eyebrow', { language: languageName(t, lang) })}</p>
          <h1 className="mt-1 font-display text-display-xl" lang={lang}>{view.version.title}</h1>
          {view.version.description && (
            <p className="mt-2 line-clamp-3 max-w-[62ch] text-body-lg text-fg-2" lang={lang}>{view.version.description}</p>
          )}
          <StatStrip cells={cells} className="mt-5" />
          {resumeHref && resumeLabel && (
            <Link to={resumeHref} className={buttonClass(next?.kind === 'PRACTICAL' ? 'spark' : 'primary', 'lg', 'mt-5 !h-auto min-h-[3rem] max-w-full py-2.5 text-left')}>
              <span className="min-w-0 break-words">{resumeLabel}</span>
              <Icon name="arrow-right" size={18} />
            </Link>
          )}
        </header>

        <CourseMap
          className="xl:col-start-1"
          courseId={courseId}
          enrollmentId={enrollmentId}
          modules={modules}
          next={next}
          certificate={view.certificate}
        />

        {/* Правый рельс (xl): прогресс и подсказка прокручиваются, сертификат и язык курса —
            липкий блок (он помещается в экран; весь рельс выше экрана и липким быть не может).
            Ниже xl — под картой курса, сеткой 2×. */}
        <aside
          aria-label={t('course.progress.title')}
          className="grid gap-4 sm:grid-cols-2 xl:col-start-2 xl:row-span-3 xl:row-start-1 xl:flex xl:flex-col"
        >
          <ProgressCard progress={view.progress} />
          <HowItWorksCard />
          <div className="contents xl:sticky xl:top-20 xl:block xl:space-y-4">
            <CertificateCard
              certificate={view.certificate}
              enrollmentId={enrollmentId}
              courseTitle={view.version.title}
              facts={facts}
              maxItems={4}
            />
            <CourseLanguageRow view={view} />
          </div>
        </aside>

        {/* Программа курса */}
        <section aria-labelledby="syllabus-title" className="min-w-0 xl:col-start-1">
          <Card className="!p-5 sm:!p-6">
            <h2 id="syllabus-title" className="mb-5 font-sans text-title">{t('course.syllabus.title')}</h2>
            {modules.map((m) => (
              <ModuleSection
                key={m.id}
                module={m}
                courseId={courseId}
                enrollmentId={enrollmentId}
                next={next}
                current={!!next && next.moduleId === m.id}
                coversRange={coversRange}
              />
            ))}
          </Card>

          {/* Итоговый мини-квиз — только если он есть (A29: свой заголовок, MiniQuiz без своего) */}
          {view.version.finalMiniQuizId && (
            <Card className="surface-practice mt-6 scroll-mt-20 !p-5 sm:!p-6" >
              <div id="final-mini-quiz" className="scroll-mt-24" />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <KindIcon kind="FINAL_MINI_QUIZ" size={28} />
                <h2 className="font-sans text-title">{t('course.finalMini.title')}</h2>
                <ModeBadge mode="practice" long />
              </div>
              <p className="mt-2 text-meta text-fg-2">{t('course.finalMini.hint')}</p>
              <div className="mt-4">
                <MiniQuiz url={`/language-versions/${view.version.id}/final-mini-quiz`} enrollmentId={enrollmentId} hideHeading />
              </div>
            </Card>
          )}
        </section>
      </div>

      {/* Мобильные: липкая панель «Продолжить» над нижними вкладками (+ safe area в самих вкладках) */}
      {next && resumeHref && (
        <>
          <div className="h-16 lg:hidden" aria-hidden />
          <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] z-20 border-t border-border bg-card/95 px-4 py-2 backdrop-blur lg:hidden">
            <Link to={resumeHref} className={buttonClass(next.kind === 'PRACTICAL' ? 'spark' : 'primary', 'md', 'w-full !h-11')}>
              <span className="min-w-0 truncate">
                {next.kind === 'CERTIFICATE' ? t('course.certificateCta') : t('course.mobileContinue', { name: itemShortName(t, next) })}
              </span>
              <Icon name="arrow-right" size={18} />
            </Link>
          </div>
        </>
      )}
    </>
  );
}

function CoursePageSkeleton() {
  return (
    <div aria-busy="true">
      <Skeleton className="mb-4 h-5 w-56" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px] xl:gap-8">
        <div className="space-y-6">
          <div className="space-y-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-12 w-72" />
          </div>
          <Skeleton className="h-64 w-full rounded-2xl" />
          <Skeleton className="h-96 w-full rounded-2xl" />
        </div>
        <div className="hidden space-y-4 xl:block">
          <Skeleton className="h-48 w-full rounded-2xl" />
          <Skeleton className="h-80 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
