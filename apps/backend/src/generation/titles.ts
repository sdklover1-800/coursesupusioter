import type { Language } from '@edu/shared';

/**
 * Локализованные названия генерируемых материалов (аудит: в kk/en-версиях
 * заголовки начинались с русских «Тест:», «Мини-квиз:», «Практическое задание:»).
 * Вид совпадает с QuizKind, плюс PRACTICAL для практического задания.
 */
export type TitleKind = 'MODULE_FINAL' | 'LECTURE_MINI' | 'COURSE_FINAL' | 'PRACTICAL';

interface TitleLabels {
  /** Тест модуля: «<метка>: <модуль>». */
  moduleQuiz: string;
  /** Мини-квиз лекции: «<метка>: <лекция>». */
  lectureMini: string;
  /** Итоговый мини-квиз курса — только метка. */
  courseFinal: string;
  /** Итоговое практическое (модуль V, весь курс) — только метка. */
  finalPractical: string;
  /** Практическое задание обычного модуля: «<метка>: <модуль>». */
  modulePractical: string;
}

const LABELS: Record<Language, TitleLabels> = {
  ru: {
    moduleQuiz: 'Тест',
    lectureMini: 'Мини-квиз',
    courseFinal: 'Итоговый мини-квиз',
    finalPractical: 'Итоговое практическое задание',
    modulePractical: 'Практическое задание',
  },
  kk: {
    moduleQuiz: 'Бөлім тесті',
    lectureMini: 'Мини-квиз',
    courseFinal: 'Қорытынды мини-квиз',
    finalPractical: 'Қорытынды практикалық тапсырма',
    modulePractical: 'Практикалық тапсырма',
  },
  en: {
    moduleQuiz: 'Quiz',
    lectureMini: 'Mini-quiz',
    courseFinal: 'Final mini-quiz',
    finalPractical: 'Final practical task',
    modulePractical: 'Practical task',
  },
};

const withName = (label: string, name?: string | null) => {
  const n = name?.trim();
  return n ? `${label}: ${n}` : label;
};

/**
 * Название материала на языке версии.
 *  - MODULE_FINAL: «Тест: <модуль>» / «Бөлім тесті: <модуль>» / «Quiz: <модуль>»;
 *  - LECTURE_MINI: «Мини-квиз: <лекция>» / «Мини-квиз: <лекция>» / «Mini-quiz: <лекция>»;
 *  - COURSE_FINAL: только метка (name игнорируется);
 *  - PRACTICAL без name — итоговое задание (модуль V, весь курс): только метка;
 *    с name — практическое задание обычного модуля: «Практическое задание: <модуль>».
 */
export function localizedTitle(kind: TitleKind, language: Language, name?: string | null): string {
  const l = LABELS[language] ?? LABELS.ru;
  switch (kind) {
    case 'MODULE_FINAL':
      return withName(l.moduleQuiz, name);
    case 'LECTURE_MINI':
      return withName(l.lectureMini, name);
    case 'COURSE_FINAL':
      return l.courseFinal;
    case 'PRACTICAL':
      return name?.trim() ? withName(l.modulePractical, name) : l.finalPractical;
  }
}

/** Все известные метки — для аудита «чужих» префиксов в заголовках. */
export function titleLabels(language: Language): readonly string[] {
  return Object.values(LABELS[language]);
}
