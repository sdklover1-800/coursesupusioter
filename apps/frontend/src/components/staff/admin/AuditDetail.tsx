import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useFormat } from '../../../lib/format';
import { EXPORT_FILENAMES, type AuditEntry, type ExportType } from '../../../lib/staffAdmin';

type Dict = Record<string, unknown>;
const isObj = (v: unknown): v is Dict => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/**
 * Границы периода выгрузки хранятся в UTC («по» — 23:59:59.999Z того же дня): показываем
 * календарный день UTC, иначе в Алматы (UTC+5) «30 сент.» превращалось бы в «1 окт.».
 */
function utcDay(v: unknown): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(String(v));
}

/** Поля пользователя из USER_UPDATED.detail.fields → подписи. */
function fieldLabel(t: TFunction, f: string): string | null {
  const map: Record<string, string> = {
    role: t('admin.role'),
    cohortId: t('admin.cohort'),
    interfaceLanguage: t('admin.interfaceLanguage'),
    isActive: t('admin.editUser.access'),
    passwordHash: t('admin.editUser.passwordTitle'),
  };
  if (f === 'mustChangePassword') return null; // часть сброса пароля
  return map[f] ?? f;
}

/**
 * Человекочитаемая сводка detail записи аудита (FE5 §8): смена группы «из → в», поля,
 * файл выгрузки с фильтрами, статус жалобы и т. п. Полный JSON — в раскрывающемся «Все поля».
 */
export function AuditDetail({
  entry, cohortName, courseName,
}: {
  entry: AuditEntry;
  cohortName: (id: string | null | undefined) => string;
  courseName: (id: string) => string;
}) {
  const { t } = useTranslation();
  const { formatDate } = useFormat();
  const d = isObj(entry.detail) ? entry.detail : {};
  const lines: string[] = [];

  switch (entry.action) {
    case 'USER_COHORT_CHANGED':
    case 'COHORT_CHANGED': {
      lines.push(t('admin.auditPage.detail.move', { from: cohortName(d.from as string | null), to: cohortName(d.to as string | null) }));
      if (typeof d.source === 'string') lines.push(t(`admin.auditPage.detail.source.${d.source}`, { defaultValue: d.source }));
      break;
    }
    case 'USER_UPDATED': {
      const fields = (Array.isArray(d.fields) ? d.fields : []).map((f) => fieldLabel(t, String(f))).filter(Boolean);
      if (fields.length) lines.push(t('admin.auditPage.detail.fields', { list: fields.join(', ') }));
      if (isObj(d.cohort)) lines.push(t('admin.auditPage.detail.move', { from: cohortName(d.cohort.from as string | null), to: cohortName(d.cohort.to as string | null) }));
      break;
    }
    case 'USER_CREATED':
      if (typeof d.role === 'string') lines.push(t('admin.auditPage.detail.role', { role: t(`roles.${d.role}`, { defaultValue: d.role }) }));
      break;
    case 'USERS_IMPORTED':
      lines.push(t('admin.auditPage.detail.imported', { total: str(d.total), valid: str(d.valid) }));
      break;
    case 'ENROLLMENT_APPROVED':
      if ('cohortId' in d) lines.push(t('admin.auditPage.detail.move', { from: cohortName(d.previousCohortId as string | null), to: cohortName(d.cohortId as string | null) }));
      if (d.bulk) lines.push(t('admin.auditPage.detail.bulk'));
      break;
    case 'COURSE_PUBLISHED':
      if (typeof d.warnings === 'number' && d.warnings > 0) lines.push(t('admin.auditPage.detail.warnings', { count: d.warnings }));
      break;
    case 'COHORT_CREATED':
    case 'COHORT_UPDATED': {
      if (typeof d.condition === 'string') lines.push(t(`conditions.${d.condition}`, { defaultValue: d.condition }));
      if (isObj(d.condition)) {
        lines.push(
          t('admin.auditPage.detail.move', {
            from: t(`conditions.${str(d.condition.from)}`, { defaultValue: str(d.condition.from) }),
            to: t(`conditions.${str(d.condition.to)}`, { defaultValue: str(d.condition.to) }),
          }),
        );
      }
      break;
    }
    case 'CONTENT_ISSUE_STATUS_CHANGED':
      lines.push(
        t('admin.auditPage.detail.move', {
          from: t(`admin.issueStatus.${str(d.from)}`, { defaultValue: str(d.from) }),
          to: t(`admin.issueStatus.${str(d.to)}`, { defaultValue: str(d.to) }),
        }),
      );
      break;
    case 'CONTENT_ISSUE_BULK_STATUS':
      lines.push(t('admin.auditPage.detail.status', { status: t(`admin.issueStatus.${str(d.status)}`, { defaultValue: str(d.status) }) }));
      if (typeof d.updated === 'number') lines.push(t('admin.auditPage.detail.updated', { count: d.updated }));
      break;
    case 'QUIZ_SETTINGS_UPDATED':
      if (isObj(d.changes)) {
        for (const [k, v] of Object.entries(d.changes)) {
          if (isObj(v)) lines.push(`${k}: ${t('admin.auditPage.detail.move', { from: str(v.from), to: str(v.to) })}`);
        }
      }
      break;
    case 'DATA_EXPORTED': {
      const type = String(d.type ?? '');
      const title = t(`admin.exportPage.types.${type}.title`, { defaultValue: type });
      lines.push(t('admin.auditPage.detail.file', { file: EXPORT_FILENAMES[type as ExportType] ? `${title} (${EXPORT_FILENAMES[type as ExportType]})` : title }));
      const f: string[] = [];
      if (typeof d.courseId === 'string') f.push(courseName(d.courseId));
      if (typeof d.cohortId === 'string') f.push(cohortName(d.cohortId));
      if (d.from || d.to) f.push(`${d.from ? formatDate(utcDay(d.from)) : '…'} – ${d.to ? formatDate(utcDay(d.to)) : '…'}`);
      if (f.length) lines.push(t('admin.auditPage.detail.filters', { list: f.join(' · ') }));
      break;
    }
    default:
      if (Array.isArray(d.fields) && d.fields.length) lines.push(t('admin.auditPage.detail.fields', { list: d.fields.join(', ') }));
  }

  const hasRaw = Object.keys(d).length > 0;
  if (!lines.length && !hasRaw) return <span className="text-fg-2">—</span>;
  return (
    <div className="min-w-0 space-y-1">
      {lines.map((l, i) => (
        <div key={i} className="break-words text-body text-fg">
          {l}
        </div>
      ))}
      {hasRaw && (
        <details className="group">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md text-sm font-medium text-brand hover:underline [&::-webkit-details-marker]:hidden">
            {t('admin.auditPage.raw')}
          </summary>
          <pre className="mt-1.5 max-h-60 max-w-full overflow-auto whitespace-pre-wrap break-all rounded-lg bg-surface-2 p-2.5 font-mono text-xs text-fg-2">
            {JSON.stringify(d, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
