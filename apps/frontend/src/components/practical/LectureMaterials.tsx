import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PracticalLectureRef } from '../../lib/practical';
import { groupLectures, moduleShortTitle, usePracticalLecture } from '../../lib/practical';
import { cleanTitle, romanOf } from '../course/labels';
import { TranscriptView } from '../TranscriptView';
import { Sheet, Skeleton } from '../ui';
import { Icon } from '../icons';

/**
 * «Конспекты лекций» во время диалога (USER_DECISIONS §4): студент может читать расшифровки.
 * Лист со списком лекций по модулям; выбор открывает расшифровку только для чтения
 * (<TranscriptView compact /> с поиском) и «‹ Все лекции». Страницу диалога не покидаем.
 * Загрузка — GET /lectures/:id?enrollmentId&context=PRACTICAL (точка возобновления не меняется).
 */
export function LectureMaterials({
  open, onClose, lectures, moduleTitles, titleByOrder, enrollmentId,
}: {
  open: boolean;
  onClose: () => void;
  lectures: PracticalLectureRef[];
  moduleTitles: string[];
  /** Названия модулей из карты курса по orderIndex (если загружена) */
  titleByOrder?: Map<number, string>;
  enrollmentId: string;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<PracticalLectureRef | null>(null);
  const groups = useMemo(() => groupLectures(lectures, moduleTitles, titleByOrder), [lectures, moduleTitles, titleByOrder]);
  const lecture = usePracticalLecture(open ? selected?.id ?? null : null, enrollmentId);
  const backRef = useRef<HTMLButtonElement>(null);
  // Выбрана лекция — фокус на «‹ Все лекции» (кнопка списка исчезла)
  useEffect(() => {
    if (selected) backRef.current?.focus();
  }, [selected]);

  const title = selected ? t('practical.materials.lecture', { n: selected.lectureNumber }) : t('practical.materials.title');

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="lg"
      title={title}
      description={selected ? cleanTitle(selected.title) : t('practical.materials.hint')}
      headerExtra={
        selected ? (
          <button
            ref={backRef}
            type="button"
            onClick={() => setSelected(null)}
            className="-mt-0.5 inline-flex h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-brand transition-colors hover:bg-brand-soft"
          >
            <Icon name="chevron-left" size={16} />
            {t('practical.materials.back')}
          </button>
        ) : undefined
      }
    >
      {!selected ? (
        groups.length === 0 ? (
          <p className="text-body text-fg-2">{t('practical.materials.empty')}</p>
        ) : (
          <div className="space-y-6">
            {groups.map((g) => (
              <section key={g.moduleOrderIndex} aria-labelledby={`mat-m-${g.moduleOrderIndex}`}>
                <h3 id={`mat-m-${g.moduleOrderIndex}`} className="mb-2 flex items-baseline gap-2 text-body font-semibold text-fg">
                  <span className="font-display text-fg-2">{romanOf(g.moduleOrderIndex)}</span>
                  <span className="min-w-0">{g.title ? moduleShortTitle(g.title) : t('practical.materials.module', { roman: romanOf(g.moduleOrderIndex) })}</span>
                </h3>
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                  {g.lectures.map((l) => (
                    <li key={l.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(l)}
                        className="flex min-h-[3rem] w-full items-start gap-3 bg-card px-3.5 py-2.5 text-left transition-colors hover:bg-brand-soft/50"
                      >
                        <span className="num mt-0.5 w-7 shrink-0 text-right text-fg-2">{l.lectureNumber}</span>
                        <span className="min-w-0 flex-1 text-body text-fg">{cleanTitle(l.title)}</span>
                        <Icon name="chevron-right" size={18} className="mt-0.5 text-fg-2" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )
      ) : lecture.isLoading ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-5 w-11/12" />
          <Skeleton className="h-5 w-10/12" />
          <Skeleton className="h-5 w-9/12" />
          <Skeleton className="h-5 w-11/12" />
        </div>
      ) : lecture.isError || !lecture.data ? (
        <p role="alert" className="flex items-center gap-2 text-body text-danger-ink">
          <Icon name="alert" size={18} />
          {t('practical.materials.error')}
        </p>
      ) : (
        <TranscriptView key={lecture.data.id} text={lecture.data.transcriptText} compact />
      )}
    </Sheet>
  );
}
