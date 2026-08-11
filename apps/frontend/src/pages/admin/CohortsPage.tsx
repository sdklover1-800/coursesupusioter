import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { Badge, Button, Card, Field, Input, Select, Textarea, toast } from '../../components/ui';
import { PageHeader, EmptyState, LoadingRows } from '../../components/page';

interface Cohort {
  id: string;
  name: string;
  condition: string;
  description: string | null;
  _count: { users: number; teacherSessions: number };
}

interface TeacherSession {
  id: string;
  date: string;
  topic: string;
  cohort: { name: string };
}

type ConditionTone = 'brand' | 'teal' | 'muted';

/** Условия эксперимента для когорты (§10.1 CohortCondition) — подписи прямым текстом. */
const CONDITION_OPTIONS: { value: string; label: string; tone: ConditionTone }[] = [
  { value: 'AI_ASSISTED', label: 'С ИИ-ассистентом', tone: 'brand' },
  { value: 'WITH_TEACHER', label: 'С преподавателем', tone: 'teal' },
  { value: 'CONTROL', label: 'Контрольная', tone: 'muted' },
];
const DEFAULT_CONDITION = 'AI_ASSISTED';

function conditionMeta(value: string) {
  return CONDITION_OPTIONS.find((o) => o.value === value) ?? { value, label: value, tone: 'muted' as ConditionTone };
}

/** Управление когортами + занятия с преподавателем (FR-R.1, FR-R.9). ADMIN. */
export function CohortsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  // Форма создания когорты
  const [name, setName] = useState('');
  const [condition, setCondition] = useState(DEFAULT_CONDITION);
  const [description, setDescription] = useState('');

  // Форма занятия + выбранная когорта (управляет и списком занятий)
  const [selectedCohortId, setSelectedCohortId] = useState('');
  const [topic, setTopic] = useState('');
  const [date, setDate] = useState('');

  const cohortsQ = useQuery({
    queryKey: ['cohorts-full'],
    queryFn: () => api.get<{ items: Cohort[] }>('/admin/cohorts'),
  });

  const sessionsQ = useQuery({
    queryKey: ['teacher-sessions', selectedCohortId],
    queryFn: () => api.get<{ items: TeacherSession[] }>(`/admin/teacher-sessions?cohortId=${selectedCohortId}`),
    enabled: !!selectedCohortId,
  });

  const createCohort = useMutation({
    mutationFn: () => api.post('/admin/cohorts', { name: name.trim(), condition, description: description.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cohorts-full'] });
      setName('');
      setCondition(DEFAULT_CONDITION);
      setDescription('');
      toast(t('common.success'), 'teal');
    },
    onError: (err: Error) => toast(err.message, 'danger'),
  });

  const logSession = useMutation({
    mutationFn: () =>
      api.post('/admin/teacher-sessions', { cohortId: selectedCohortId, topic: topic.trim(), date: new Date(date).toISOString() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teacher-sessions', selectedCohortId] });
      qc.invalidateQueries({ queryKey: ['cohorts-full'] });
      setTopic('');
      setDate('');
      toast(t('common.success'), 'teal');
    },
    onError: (err: Error) => toast(err.message, 'danger'),
  });

  const onCreateCohort = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createCohort.mutate();
  };

  const onLogSession = (e: FormEvent) => {
    e.preventDefault();
    if (!selectedCohortId || !topic.trim() || !date) return;
    logSession.mutate();
  };

  const cohorts = cohortsQ.data?.items ?? [];

  return (
    <>
      <PageHeader eyebrow="Admin" title={t('nav.cohorts')} subtitle={t('admin.condition')} />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Список когорт ─────────────────────────────── */}
        <section className="space-y-4 lg:col-span-2">
          {cohortsQ.isLoading ? (
            <LoadingRows rows={4} />
          ) : !cohorts.length ? (
            <EmptyState title={t('common.empty')} hint={t('admin.createCohort')} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {cohorts.map((c) => {
                const meta = conditionMeta(c.condition);
                return (
                  <Card key={c.id} className="flex flex-col">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-lg font-semibold">{c.name}</h3>
                      <Badge tone={meta.tone}>{t(`conditions.${c.condition}`, { defaultValue: meta.label })}</Badge>
                    </div>
                    {c.description && <p className="mt-1.5 line-clamp-3 text-sm text-muted">{c.description}</p>}

                    <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-4 text-sm">
                      <div>
                        <div className="font-mono text-xl font-semibold tabular-nums">{c._count.users}</div>
                        <div className="text-xs text-muted">{t('dashboard.students')}</div>
                      </div>
                      <div>
                        <div className="font-mono text-xl font-semibold tabular-nums">{c._count.teacherSessions}</div>
                        <div className="text-xs text-muted">{t('dashboard.teacherSessionsCount')}</div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Формы: создание когорты + занятие ─────────── */}
        <aside className="space-y-6">
          {/* Создать когорту */}
          <Card>
            <h2 className="mb-4 text-base font-semibold">{t('admin.createCohort')}</h2>
            <form className="space-y-4" onSubmit={onCreateCohort}>
              <Field label={t('admin.name')}>
                <Input value={name} onChange={(e) => setName(e.target.value)} required />
              </Field>
              <Field label={t('admin.condition')}>
                <Select value={condition} onChange={(e) => setCondition(e.target.value)}>
                  {CONDITION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Описание">
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
              <Button type="submit" className="w-full" loading={createCohort.isPending} disabled={!name.trim()}>
                {t('common.create')}
              </Button>
            </form>
          </Card>

          {/* Занятие с преподавателем */}
          <Card>
            <h2 className="mb-4 text-base font-semibold">{t('admin.logTeacherSession')}</h2>
            <form className="space-y-4" onSubmit={onLogSession}>
              <Field label={t('admin.cohort')}>
                <Select value={selectedCohortId} onChange={(e) => setSelectedCohortId(e.target.value)} required>
                  <option value="" disabled>{t('common.search')}…</option>
                  {cohorts.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t('admin.topic')}>
                <Input value={topic} onChange={(e) => setTopic(e.target.value)} required />
              </Field>
              <Field label={t('admin.date')}>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </Field>
              <Button
                type="submit"
                variant="spark"
                className="w-full"
                loading={logSession.isPending}
                disabled={!selectedCohortId || !topic.trim() || !date}
              >
                {t('common.save')}
              </Button>
            </form>

            {/* Список занятий выбранной когорты */}
            <div className="mt-6 border-t border-border pt-4">
              <div className="mb-3 font-mono text-xs font-semibold uppercase tracking-wider text-brand">
                {t('admin.teacherSessions')}
              </div>
              {!selectedCohortId ? (
                <p className="text-sm text-muted">{t('dashboard.noData')}</p>
              ) : sessionsQ.isLoading ? (
                <LoadingRows rows={2} />
              ) : !sessionsQ.data?.items.length ? (
                <p className="text-sm text-muted">{t('dashboard.noData')}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {sessionsQ.data.items.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 py-2.5">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-soft font-mono text-xs font-bold text-brand">◆</span>
                      <span className="flex-1 text-sm font-medium">{s.topic}</span>
                      <span className="font-mono text-xs tabular-nums text-muted whitespace-nowrap">
                        {new Date(s.date).toLocaleDateString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}
