import { useMemo, useState } from 'react';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, PublishStatus, type Language } from '@edu/shared';
import { api } from '../../lib/api';
import { useCatalog } from '../../lib/catalog';
import {
  admittedCount, apiErrorMessage, staffKeys, useManagedCourses, type StaffCourse, type StaffCourseListItem, type StaffEnrollment,
} from '../../lib/staff';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { Button, Card, Field, Input, Select, toast } from '../../components/ui';
import { Icon } from '../../components/icons';
import { PageHeader, LoadingRows, EmptyState } from '../../components/page';
import { AutoTextarea, LoadError } from '../../components/staff/primitives';

const LANG_ORDER = LANGUAGES as readonly string[];

interface CardStats {
  modules: number | null;
  lectures: number | null;
  enrolled: number | null;
  pending: number | null;
}

/**
 * Список курсов менеджера и создание курса (§4.2, FR-2.1; FE5 §1): на карточке —
 * название, одна мета-строка (модули, лекции, записанные) и статусы языковых версий.
 * Модули/лекции опубликованных версий — из публичного каталога (лёгкий ответ);
 * для неопубликованных — из полного курса.
 */
export function CoursesListPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('manager.courses'));
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [creating, setCreating] = useState(false);
  const [defaultLanguage, setDefaultLanguage] = useState<Language>('ru');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const { data, isLoading, isError, error, refetch, isFetching } = useManagedCourses();
  const items = useMemo(() => data?.items ?? [], [data]);
  const catalog = useCatalog();

  // Модули/лекции: опубликованная базовая версия — из каталога, иначе — полный курс
  const catalogVersion = (c: StaffCourseListItem) => {
    const primary = c.languageVersions.find((v) => v.language === c.defaultLanguage) ?? c.languageVersions[0];
    return catalog.data?.items.find((x) => x.id === c.id)?.versions.find((v) => v.id === primary?.id);
  };
  const needDetail = catalog.isSuccess ? items.filter((c) => c.languageVersions.length && !catalogVersion(c)) : [];
  const details = useQueries({
    queries: needDetail.map((c) => ({
      queryKey: staffKeys.course(c.id),
      queryFn: () => api.get<{ course: StaffCourse }>(`/courses/${c.id}`),
      staleTime: 60_000,
    })),
  });
  const enrollments = useQueries({
    queries: items.map((c) => ({
      queryKey: staffKeys.enrollments(c.id),
      queryFn: () => api.get<{ items: StaffEnrollment[] }>(`/enrollments?courseId=${encodeURIComponent(c.id)}`),
      staleTime: 60_000,
    })),
  });

  function statsOf(c: StaffCourseListItem, i: number): CardStats {
    const cv = catalogVersion(c);
    let modules: number | null = cv ? cv.moduleCount : null;
    let lectures: number | null = cv ? cv.lectureCount : null;
    if (!cv) {
      const di = needDetail.findIndex((x) => x.id === c.id);
      const course = di >= 0 ? details[di]?.data?.course : undefined;
      const primary = course?.languageVersions.find((v) => v.language === c.defaultLanguage) ?? course?.languageVersions[0];
      if (primary) {
        modules = primary.modules.length;
        lectures = primary.modules.reduce((s, m) => s + m.lectures.length, 0);
      }
    }
    const enr = enrollments[i]?.data?.items;
    return {
      modules,
      lectures,
      enrolled: enr ? admittedCount(enr) : null,
      pending: enr ? enr.filter((e) => e.status === 'PENDING').length : null,
    };
  }

  const create = useMutation({
    mutationFn: () =>
      api.post<{ course: { id: string } }>('/courses', {
        defaultLanguage,
        title: title.trim(),
        description: description.trim() || undefined,
      }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: staffKeys.courses });
      toast(t('manager.courseCreated'), 'teal');
      navigate(`/manage/courses/${res.course.id}`);
    },
    onError: (err: unknown) => toast(apiErrorMessage(err, t), 'danger'),
  });

  const canSubmit = title.trim().length > 0 && !create.isPending;

  return (
    <>
      <PageHeader
        title={t('manager.courses')}
        subtitle={t('manager.coursesSubtitle')}
        action={
          <Button variant={creating ? 'secondary' : 'primary'} onClick={() => setCreating((v) => !v)}>
            {creating ? t('common.cancel') : (<><Icon name="plus" size={18} />{t('manager.createCourse')}</>)}
          </Button>
        }
      />

      {creating && (
        <Card className="mb-6 !p-4 sm:!p-6">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) create.mutate();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-[14rem_minmax(0,1fr)]">
              <Field label={t('manager.defaultLanguage')}>
                <Select value={defaultLanguage} onChange={(e) => setDefaultLanguage(e.target.value as Language)}>
                  {LANG_ORDER.map((lng) => (
                    <option key={lng} value={lng}>{t(`languages.${lng}`)}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t('manager.courseTitle')}>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} lang={defaultLanguage} autoFocus />
              </Field>
            </div>
            <Field label={t('manager.description')} hint={t('manager.createHint')}>
              <AutoTextarea value={description} onChange={(e) => setDescription(e.target.value)} lang={defaultLanguage} minRows={3} />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" loading={create.isPending} disabled={!canSubmit}>
                {t('common.create')}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {isLoading ? (
        <LoadingRows rows={4} />
      ) : isError ? (
        <LoadError error={error} onRetry={() => void refetch()} retrying={isFetching} />
      ) : items.length === 0 ? (
        <EmptyState
          title={t('manager.coursesEmpty')}
          hint={t('manager.coursesEmptyHint')}
          action={<Button onClick={() => setCreating(true)}>{t('manager.createCourse')}</Button>}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {items.map((c, i) => (
            <li key={c.id} className="min-w-0">
              <CourseCard course={c} stats={statsOf(c, i)} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function CourseCard({ course: c, stats }: { course: StaffCourseListItem; stats: CardStats }) {
  const { t } = useTranslation();
  const versions = [...c.languageVersions].sort((a, b) => {
    if (a.language === c.defaultLanguage) return -1;
    if (b.language === c.defaultLanguage) return 1;
    return LANG_ORDER.indexOf(a.language) - LANG_ORDER.indexOf(b.language);
  });
  const primary = versions[0];
  const heading = primary?.title || t(`languages.${c.defaultLanguage}`);
  const meta = [
    t(`languages.${c.defaultLanguage}`),
    stats.modules !== null ? t('manager.count.modules', { count: stats.modules }) : null,
    stats.lectures !== null ? t('manager.count.lectures', { count: stats.lectures }) : null,
    stats.enrolled !== null ? t('manager.count.enrolled', { count: stats.enrolled }) : null,
  ].filter(Boolean);

  return (
    <Link
      to={`/manage/courses/${c.id}`}
      className="card group flex h-full min-w-0 flex-col p-5 transition-colors hover:border-brand/50 focus-visible:border-brand sm:p-6"
    >
      <h2 className="line-clamp-2 text-title text-fg group-hover:text-brand" lang={primary?.language}>{heading}</h2>
      <p className="mt-1 text-meta text-fg-2">{meta.join(' · ')}</p>
      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-border pt-3" aria-label={t('manager.languageVersions')}>
        {versions.map((v) => {
          const published = v.status === PublishStatus.PUBLISHED;
          return (
            <li key={v.id} className="inline-flex items-center gap-1.5 text-small">
              <span className="font-semibold text-fg" lang={v.language}>{t(`shell.langShort.${v.language}`)}</span>
              <Icon name={published ? 'check' : v.status === PublishStatus.ARCHIVED ? 'history' : 'pencil'} size={14} className={published ? 'text-teal-ink' : 'text-fg-2'} />
              <span className={published ? 'font-medium text-teal-ink' : 'text-fg-2'}>{t(`status.${v.status}`)}</span>
            </li>
          );
        })}
        {stats.pending ? (
          <li className="inline-flex items-center gap-1.5 text-small font-medium text-spark-ink sm:ml-auto">
            <Icon name="mail" size={14} />
            {t('manager.pendingRequests', { count: stats.pending })}
          </li>
        ) : null}
      </ul>
    </Link>
  );
}
