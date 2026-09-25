import { describe, it, expect } from 'vitest';
import { cleanLectureTitle, lectureTitleProblem, LECTURE_TITLE_MAX } from './lectureTitle.js';

// Реальные названия EN-версии курса после импорта (шапка .docx склеилась с названием)
const GLUED_1 =
  '1. Political Science as a Discipline: Object, Subject, and Research MethodsCourse: Introduction to Political Science (undergraduate) Video length: ~20 minutes Format: video lecture with timecodes for editing';
const GLUED_3 =
  '3. Modern Political Theories and Schools of the 20th–21st CenturiesCourse: Introduction to Political Science (Bachelor’s Level)Video duration: ~22 minutesFormat: video lecture with timecodes for editing';

describe('название лекции (FR-2.9, публичная программа курса)', () => {
  it('склеенные метаданные — проблема публикации', () => {
    expect(lectureTitleProblem(GLUED_1)).toMatch(/метаданные/);
    expect(lectureTitleProblem(GLUED_3)).toMatch(/метаданные/);
    expect(lectureTitleProblem('4. Саясат Пішімі: бейнедәріс')).toMatch(/метаданные/);
  });

  it('обычные названия (в т.ч. с двоеточием и длинные) проходят', () => {
    expect(lectureTitleProblem('1. Политология как наука: объект, предмет, методы исследования')).toBeNull();
    expect(lectureTitleProblem('14. Political Analysis and Forecasting: SWOT Analysis, Scenario Forecasting, Content Analysis of Political Texts (Practical Session)')).toBeNull();
    expect(lectureTitleProblem('Введение в курс: цели и формат занятий')).toBeNull();
    expect(lectureTitleProblem('Course: overview')).toBeNull(); // метка в самом начале — это и есть название
  });

  it('слишком длинное название — проблема', () => {
    expect(lectureTitleProblem('А'.repeat(LECTURE_TITLE_MAX + 1))).toMatch(/длиннее/);
    expect(lectureTitleProblem('А'.repeat(LECTURE_TITLE_MAX))).toBeNull();
  });

  it('очистка оставляет только название и идемпотентна', () => {
    expect(cleanLectureTitle(GLUED_1)).toBe('1. Political Science as a Discipline: Object, Subject, and Research Methods');
    expect(cleanLectureTitle(GLUED_3)).toBe('3. Modern Political Theories and Schools of the 20th–21st Centuries');
    const clean = '2. The History of Political Thought: From Antiquity to the Modern Age';
    expect(cleanLectureTitle(clean)).toBe(clean);
    expect(cleanLectureTitle(cleanLectureTitle(GLUED_1))).toBe(cleanLectureTitle(GLUED_1));
  });
});
