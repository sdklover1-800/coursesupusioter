import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, type Language } from '@edu/shared';
import { api, ApiError } from '../../lib/api';
import { Badge, Button, Card, Field, Input, Select, toast } from '../../components/ui';
import { PageHeader, LoadingRows, EmptyState, ErrorState } from '../../components/page';

interface CourseVersion { id: string; language: string; title: string; status: string }
interface Course {
  id: string;
  defaultLanguage: string;
  status: string;
  createdBy: { name: string };
  languageVersions: CourseVersion[];
}

const statusTone: Record<string, 'muted' | 'teal' | 'danger'> = {
  DRAFT: 'muted',
  PUBLISHED: 'teal',
  ARCHIVED: 'danger',
};

/** Список курсов менеджера + создание курса (§4.2, FR-2.1). */
export function CoursesListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [creating, setCreating] = useState(false);
  const [defaultLanguage, setDefaultLanguage] = useState<Language>('ru');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['courses'],
    queryFn: () => api.get<{ items: Course[] }>('/courses'),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<{ course: { id: string } }>('/courses', {
        defaultLanguage,
        title: title.trim(),
        description: description.trim(),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['courses'] });
      toast(t('common.success'));
      navigate(`/manage/courses/${res.course.id}`);
    },
    onError: (err: unknown) =>
      toast(err instanceof ApiError ? err.message : t('errors.generic'), 'danger'),
  });

  const items = data?.items ?? [];
  const canSubmit = title.trim().length > 0 && !create.isPending;

  const createButton = (
    <Button variant={creating ? 'secondary' : 'primary'} onClick={() => setCreating((v) => !v)}>
      {creating ? t('common.cancel') : t('manager.createCourse')}
    </Button>
  );

  return (
    <>
      <PageHeader title={t('manager.courses')} action={createButton} />

      {creating && (
        <Card className="mb-6">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) create.mutate();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('manager.defaultLanguage')}>
                <Select value={defaultLanguage} onChange={(e) => setDefaultLanguage(e.target.value as Language)}>
                  {LANGUAGES.map((lng) => (
                    <option key={lng} value={lng}>{t(`languages.${lng}`)}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t('manager.courseTitle')}>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t('manager.courseTitle')}
                  autoFocus
                />
              </Field>
            </div>
            <Field label={t('lecture.transcript')} hint={t('manager.useDefault')}>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
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
        <ErrorState message={error instanceof ApiError ? error.message : t('errors.generic')} />
      ) : items.length === 0 ? (
        <EmptyState
          title={t('student.noCourses')}
          hint={t('manager.useDefault')}
          action={<Button onClick={() => setCreating(true)}>{t('manager.createCourse')}</Button>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {items.map((c) => {
            const primary = c.languageVersions.find((v) => v.language === c.defaultLanguage) ?? c.languageVersions[0];
            const heading = primary?.title || t(`languages.${c.defaultLanguage}`);
            return (
              <Link key={c.id} to={`/manage/courses/${c.id}`} className="block">
                <Card className="h-full transition-colors hover:border-brand/50">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-xs font-semibold uppercase tracking-wider text-brand">
                        {t(`languages.${c.defaultLanguage}`)}
                      </div>
                      <h3 className="mt-1 truncate text-lg font-semibold">{heading}</h3>
                    </div>
                    <Badge tone={statusTone[c.status] ?? 'muted'}>{t(`status.${c.status}`)}</Badge>
                  </div>

                  {c.languageVersions.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {c.languageVersions.map((v) => (
                        <Badge key={v.id} tone="brand">{t(`languages.${v.language}`)}</Badge>
                      ))}
                    </div>
                  )}

                  <div className="mt-4 text-xs text-muted">{c.createdBy?.name}</div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
