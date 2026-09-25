import { clsx } from 'clsx';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SYSTEM_REVIEW_REASONS } from '@edu/shared';
import { useFormat } from '../../lib/format';
import { issueStatusTone } from '../../lib/tones';
import { optionLetter, type IssueGroup } from '../../lib/staff';
import { Badge, Button, buttonClass } from '../ui';
import { Icon, type IconName } from '../icons';
import { LangBadge } from '../enrollment';
import { Checkbox, MetaChip } from './primitives';

const TARGET_ICON: Record<IssueGroup['targetType'], IconName> = {
  QUIZ_QUESTION: 'list-check',
  CHAT_MESSAGE: 'message',
  LECTURE: 'play',
  PRACTICAL_TASK: 'compass',
};

/** Подпись причины: студенческие — ui.issue.reasons.*, системные — issues.reason.*. */
export function useReasonLabel() {
  const { t } = useTranslation();
  return (reason: string) =>
    (SYSTEM_REVIEW_REASONS as readonly string[]).includes(reason)
      ? t(`issues.reason.${reason}`)
      : t(`ui.issue.reasons.${reason}`, { defaultValue: reason });
}

/** Ссылка «Открыть в редакторе» по типу объекта (у реплики чата редактора нет). */
export function issueEditorHref(g: IssueGroup): string | null {
  const course = g.courseId ? `course=${g.courseId}` : '';
  switch (g.targetType) {
    case 'QUIZ_QUESTION':
      return g.preview?.kind === 'QUIZ_QUESTION' ? `/manage/quiz/${g.preview.quizId}${course ? `?${course}` : ''}#q-${g.targetId}` : null;
    case 'LECTURE':
      return g.courseId ? `/manage/courses/${g.courseId}?${g.languageVersionId ? `version=${g.languageVersionId}&` : ''}lecture=${g.targetId}` : null;
    case 'PRACTICAL_TASK':
      return `/manage/practical/${g.targetId}${course ? `?${course}` : ''}`;
    default:
      return null;
  }
}

/**
 * Группа жалоб на один объект во входящих (FE5 §4): превью объекта (у вопроса —
 * варианты с выделенным ключом, только для сотрудника), причина, число сообщивших,
 * дата, комментарии; действия «Открыть в редакторе», «Решено», «Отклонить».
 */
export function IssueRow({
  group, selected, onToggleSelect, onResolve, onDismiss, onReopen, busy,
}: {
  group: IssueGroup;
  selected: boolean;
  onToggleSelect: () => void;
  onResolve: () => void;
  onDismiss: () => void;
  onReopen: () => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const { formatDate } = useFormat();
  const reasonLabel = useReasonLabel();
  const g = group;
  const isOpen = g.openIssueIds.length > 0;
  const href = issueEditorHref(g);
  const [top, ...rest] = g.reasons;
  const originLabel = g.origin === 'SYSTEM' ? t('issues.origin.SYSTEM') : g.origin === 'MIXED' ? t('issues.origin.MIXED') : t('issues.origin.STUDENT');

  return (
    <li className={clsx('card !rounded-xl p-4 transition-colors sm:p-5', selected && 'border-brand/50 bg-brand-soft/30')}>
      <div className="flex items-start gap-3">
        <div className="pt-0.5">
          <Checkbox checked={selected} disabled={!isOpen} onChange={onToggleSelect} label={t('issues.selectRow')} />
        </div>
        <div className="min-w-0 flex-1">
          {/* Шапка: тип объекта · язык · происхождение · статус · дата */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span className="inline-flex items-center gap-1.5 text-label text-fg-2">
              <Icon name={TARGET_ICON[g.targetType]} size={16} />
              {t(`issues.target.${g.targetType}`)}
            </span>
            {g.language && <LangBadge lang={g.language} />}
            <MetaChip icon={g.origin === 'STUDENT' ? 'users' : 'flag'} tone={g.origin === 'STUDENT' ? 'plain' : 'spark'}>
              {originLabel}
            </MetaChip>
            {!isOpen && <Badge tone={issueStatusTone[g.status] ?? 'muted'}>{t(`issues.status.${g.status}`)}</Badge>}
            <span className="ml-auto whitespace-nowrap text-small text-fg-2">{formatDate(g.latestAt, 'datetime')}</span>
          </div>

          <Preview group={g} />

          {/* Причины, сообщившие, контексты */}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-small text-fg-2">
            {top && (
              <MetaChip tone={(SYSTEM_REVIEW_REASONS as readonly string[]).includes(top.reason) ? 'spark' : 'danger'} icon="flag">
                {reasonLabel(top.reason)}
                {top.count > 1 && <span className="num text-small">×{top.count}</span>}
              </MetaChip>
            )}
            {rest.length > 0 && <span>{rest.map((r) => `${reasonLabel(r.reason)}${r.count > 1 ? ` ×${r.count}` : ''}`).join(' · ')}</span>}
            {g.reporterCount > 0 && <span>{t('issues.reporters', { count: g.reporterCount })}</span>}
            {g.contexts.length > 0 && <span>{g.contexts.map((c) => t(`issues.context.${c}`, { defaultValue: c })).join(', ')}</span>}
          </div>

          {g.comments.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {g.comments.map((c, i) => (
                <li key={i} className="rounded-lg border-l-2 border-border-strong bg-surface px-3 py-1.5 text-body text-fg">
                  {c.text}
                  <span className="ml-2 text-small text-fg-2">— {reasonLabel(c.reason)}, {formatDate(c.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Действия */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {href ? (
              <Link to={href} className={buttonClass('secondary', 'sm', 'whitespace-nowrap')}>
                <Icon name="external-link" size={16} />
                {t('issues.openEditor')}
              </Link>
            ) : (
              <span className="text-small text-fg-2">{t('issues.noEditor')}</span>
            )}
            <div className="ml-auto flex flex-wrap gap-2">
              {isOpen ? (
                <>
                  <Button size="sm" variant="ghost" onClick={onDismiss} disabled={busy} className="whitespace-nowrap">
                    {t('issues.dismiss')}
                  </Button>
                  <Button size="sm" onClick={onResolve} disabled={busy} className="whitespace-nowrap">
                    <Icon name="check" size={16} />
                    {t('issues.resolve')}
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="ghost" onClick={onReopen} disabled={busy} className="whitespace-nowrap">
                  <Icon name="refresh" size={16} />
                  {t('issues.reopen')}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

/** Превью объекта жалобы. */
function Preview({ group }: { group: IssueGroup }) {
  const { t } = useTranslation();
  const p = group.preview;
  if (!p) return <p className="mt-2 text-body text-fg-2">{t('issues.previewMissing')}</p>;
  switch (p.kind) {
    case 'QUIZ_QUESTION':
      return (
        <div className="mt-2" lang={group.language ?? undefined}>
          <div className="text-small text-fg-2">
            {p.quizTitle}
            {p.canonicalKey && <span className="num ml-2 text-small">{p.canonicalKey}</span>}
            {p.archived && <span className="ml-2">· {t('manager.qe.archived')}</span>}
          </div>
          <p className="mt-1 font-medium text-fg">{p.prompt}</p>
          <ol className="mt-2 grid gap-1 sm:grid-cols-2">
            {p.options.map((o, i) => {
              const key = p.correctOptionIds.includes(i);
              return (
                <li key={i} className={clsx('flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-body', key ? 'bg-teal/12 text-fg' : 'bg-surface text-fg')}>
                  <span className={clsx('num shrink-0', key ? 'font-semibold text-teal-ink' : 'text-fg-2')}>{optionLetter(i)}</span>
                  <span className="min-w-0 flex-1">{o}</span>
                  {key && (
                    <span className="inline-flex shrink-0 items-center gap-1 text-small font-semibold text-teal-ink">
                      <Icon name="check" size={14} />
                      {t('issues.key')}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      );
    case 'CHAT_MESSAGE':
      return (
        <figure className="mt-2">
          <figcaption className="text-small text-fg-2">{p.role === 'AI' ? t('issues.roleTutor') : p.role === 'STUDENT' ? t('issues.roleStudent') : p.role}</figcaption>
          <blockquote className="mt-1 whitespace-pre-line rounded-lg border-l-2 border-spark-ink/60 bg-surface px-3 py-2 text-body text-fg" lang={group.language ?? undefined}>
            {p.excerpt}
          </blockquote>
        </figure>
      );
    case 'LECTURE':
      return (
        <p className="mt-2 font-medium text-fg" lang={group.language ?? undefined}>
          {/* Названия лекций курса уже начинаются с номера («7. …») — не дублируем его */}
          {p.lectureNumber && !/^\s*\d+[.)]/.test(p.title) ? t('issues.lectureN', { n: p.lectureNumber, title: p.title }) : p.title}
        </p>
      );
    case 'PRACTICAL_TASK':
      return (
        <p className="mt-2 font-medium text-fg" lang={group.language ?? undefined}>
          {p.title}
        </p>
      );
    default:
      return null;
  }
}
