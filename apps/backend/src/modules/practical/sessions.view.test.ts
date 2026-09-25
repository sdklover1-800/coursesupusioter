import { describe, it, expect } from 'vitest';
import { buildEvaluation, buildSessionDetail, buildSessionsView, buildBrief, deriveVerdictCode, turnDone, type SessionRow } from './sessions.view.js';

/**
 * DTO практикума — allowlist (A1): студент не получает вывода судьи ни в SSE `done`,
 * ни в GET /sessions/:id, пока сессия идёт; «что развивать» — только в финале (A6).
 */

// Всё, что есть во внутреннем TurnResult/строках БД и НЕ должно уйти студенту.
const FORBIDDEN_KEYS = [
  'assessment',
  'notes',
  'covered_key_points',
  'missing_key_points',
  'criterion_missing',
  'student_reached_answer',
  'integrityFlags',
  'leakCheck',
  'turnAssessment',
  'trace',
  'verdictReason',
  'evaluationResult',
  'metrics',
  'judge',
  'confirm',
  'reasoning_assessment',
  'tokensUsed',
];
const SECRET_VALUES = [
  'SECRET_NOTE ответ пока неполный: не назван тип режима',
  'SECRET_KEYPOINT авторитаризм',
  'SECRET_CRITERION прогноз',
  'SECRET_LEAK_REASON',
  'SECRET_VERDICT_REASON',
  'FAST_LONG_PASTE',
];

const judge = {
  reasoning_assessment: { methodicalness: 2, question_quality: 1, logical_progression: 2, self_correction: 1, notes: SECRET_VALUES[0] },
  covered_key_points: [1, 2],
  missing_key_points: [3],
  criterion_missing: [SECRET_VALUES[2]],
  student_reached_answer: false,
};

/** TurnResult со всеми внутренними полями — как его возвращает оркестратор. */
const richTurnResult = {
  status: 'IN_PROGRESS',
  verdictCode: null,
  tutorMessage: 'Какой признак режима вы видите в условии?',
  tutorMessageId: 'ai-msg-1',
  userMessageId: 'st-msg-1',
  aiMessageCount: 3,
  maxAiMessages: 24,
  remainingAiMessages: 21,
  verdictReason: SECRET_VALUES[4],
  assessment: judge.reasoning_assessment,
  turnAssessment: { ...judge.reasoning_assessment, judge, confirm: null, keyPoints: [SECRET_VALUES[1]] },
  integrityFlags: [{ type: SECRET_VALUES[5], detail: '120 симв/с' }],
  leakCheck: { leaks: false, reason: SECRET_VALUES[3], ms: 700, timeout: false },
  evaluationResult: { avg_methodicalness: 2 },
  tokensUsed: 5000,
  tokenCeiling: 160000,
  trace: { judgeOutput: judge, confirmOutput: null, rawTutorText: SECRET_VALUES[1] },
};

function assertNoJudgeOutput(payload: unknown) {
  const json = JSON.stringify(payload);
  for (const k of FORBIDDEN_KEYS) expect(json).not.toContain(`"${k}"`);
  for (const v of SECRET_VALUES) expect(json).not.toContain(v);
}

const row = (over: Partial<SessionRow> = {}): SessionRow => ({
  id: 's1',
  status: 'IN_PROGRESS',
  verdictCode: null,
  verdictReason: SECRET_VALUES[4],
  aiMessageCount: 3,
  maxAiMessages: 24,
  startedAt: new Date('2026-09-25T08:00:00Z'),
  endedAt: null,
  summaryStatus: null,
  summary: null,
  evaluationResult: { avg_methodicalness: 2, avg_question_quality: 1, avg_logical_progression: 2.5, avg_self_correction: 1, turns: 3, reached_answer: false, reached_at_turn: null },
  excusedAt: null,
  userMessageCount: 3,
  ...over,
});

const summary = {
  criteria: [
    { key: 'methodicalness', score: 2, line: 'Вы шли от признаков к выводу.' },
    { key: 'question_quality', score: 1, line: 'Вопросов к себе было мало.' },
  ],
  strengths: ['Последовательность', 'Самокоррекция'],
  toDevelop: ['Задавать себе проверочные вопросы', 'Сравнивать альтернативы'],
  highlights: [{ messageId: 'st-msg-1', criterion: 'self_correction', polarity: 'plus', note: 'Исправили определение.' }],
  droppedLines: 0,
};

describe('SSE done — allowlist (A1)', () => {
  it('ровно шесть полей и ни одного следа вывода судьи', () => {
    const done = turnDone(richTurnResult);
    expect(Object.keys(done).sort()).toEqual(['remaining', 'status', 'tutorMessage', 'tutorMessageId', 'userMessageId', 'verdictCode']);
    expect(done).toEqual({
      tutorMessage: 'Какой признак режима вы видите в условии?',
      tutorMessageId: 'ai-msg-1',
      userMessageId: 'st-msg-1',
      remaining: 21,
      status: 'IN_PROGRESS',
      verdictCode: null,
    });
    assertNoJudgeOutput(done);
  });

  it('финальный ход: код вердикта из допустимого списка, неизвестный — null', () => {
    expect(turnDone({ ...richTurnResult, status: 'PASSED', verdictCode: 'PASSED' }).verdictCode).toBe('PASSED');
    expect(turnDone({ ...richTurnResult, verdictCode: 'SOMETHING' }).verdictCode).toBeNull();
  });
});

describe('GET /sessions/:id — SessionDetail', () => {
  const messages = [
    { id: 'm0', role: 'AI', content: 'Сценарий', createdAt: new Date('2026-09-25T08:00:00Z'), turnAssessment: judge, integrityFlags: [{ type: 'FAST_LONG_PASTE' }], leakCheck: { reason: SECRET_VALUES[3] }, tokensIn: 5 },
    { id: 'st-msg-1', role: 'STUDENT', content: 'Думаю, это протест', createdAt: new Date('2026-09-25T08:01:00Z'), turnAssessment: judge },
  ];

  it('во время сессии: evaluation = null, реплики — только {id, role, content, createdAt}', () => {
    const d = buildSessionDetail(row({ summary, summaryStatus: 'READY', metrics: { leakPrevented: 1 } } as Partial<SessionRow>), messages, false);
    expect(d.evaluation).toBeNull();
    expect(d.session.status).toBe('IN_PROGRESS');
    for (const m of d.messages) expect(Object.keys(m).sort()).toEqual(['content', 'createdAt', 'id', 'role']);
    assertNoJudgeOutput(d);
  });

  it('после завершения, пока есть попытка: баллы и сильные стороны, без «что развивать» и отметок (A6)', () => {
    const e = buildEvaluation(row({ status: 'FAILED', verdictCode: 'FAILED_LIMIT', summary, summaryStatus: 'READY' }), false)!;
    expect(e.criteria.map((c) => c.key)).toEqual(['methodicalness', 'question_quality', 'logical_progression', 'self_correction']);
    expect(e.criteria[2]!.score).toBe(2.5); // балл — серверный агрегат
    expect(e.criteria[0]!.line).toBe('Вы шли от признаков к выводу.');
    expect(e.strengths).toEqual(['Последовательность', 'Самокоррекция']);
    expect(e.toDevelop).toBeNull();
    expect(e.highlights).toBeNull();
  });

  it('финал (сдано или попытки исчерпаны): открываются «что развивать» и отметки', () => {
    const e = buildEvaluation(row({ status: 'FAILED', summary, summaryStatus: 'READY' }), true)!;
    expect(e.toDevelop).toEqual(['Задавать себе проверочные вопросы', 'Сравнивать альтернативы']);
    expect(e.highlights).toEqual([{ messageId: 'st-msg-1', criterion: 'self_correction', polarity: 'plus', note: 'Исправили определение.' }]);
  });

  it('отзыв ещё не готов или не сформирован — баллы без строк', () => {
    for (const summaryStatus of ['PENDING', 'FAILED']) {
      const e = buildEvaluation(row({ status: 'FAILED', summary: null, summaryStatus }), true)!;
      expect(e.criteria.every((c) => c.line === null)).toBe(true);
      expect(e.criteria[0]!.score).toBe(2);
      expect(e.strengths).toEqual([]);
    }
  });

  it('сырой verdictReason не уходит; у старых сессий код выводится из статуса', () => {
    const d = buildSessionDetail(row({ status: 'FAILED', endedAt: new Date(), verdictReason: 'Достигнут токен-потолок (предохранитель).' }), messages, true);
    expect(d.session.verdictCode).toBe('FAILED_CEILING');
    expect(JSON.stringify(d)).not.toContain('предохранитель');
    expect(deriveVerdictCode({ status: 'FAILED', verdictCode: null, verdictReason: 'Исчерпан лимит реплик ассистента.' })).toBe('FAILED_LIMIT');
    expect(deriveVerdictCode({ status: 'PASSED', verdictCode: null })).toBe('PASSED');
    expect(deriveVerdictCode({ status: 'FAILED', verdictCode: 'ENDED_BY_STUDENT' })).toBe('ENDED_BY_STUDENT');
    expect(deriveVerdictCode({ status: 'IN_PROGRESS', verdictCode: null })).toBeNull();
  });
});

describe('GET /practical-tasks/:id/sessions — PracticalSessionsView', () => {
  const brief = buildBrief({
    id: 't1',
    title: 'Полисия',
    scenarioPrompt: 'Сценарий',
    agenda: ['Позиция', 'Аргументы', 'Вывод', 'лишний'],
    estimatedMinutes: 25,
    maxAiMessages: 24,
    maxSessions: 2,
    language: 'ru',
    moduleTitles: ['I', 'II'],
    lectures: [{ id: 'l1', title: 'Лекция 1', lectureNumber: 1, moduleOrderIndex: 0 }],
  });
  const task = { maxSessions: 2, availableFrom: null, availableUntil: null };

  it('бриф без эталона/рубрики; повестка не длиннее 3 пунктов', () => {
    expect(brief.agenda).toEqual(['Позиция', 'Аргументы', 'Вывод']);
    expect(Object.keys(brief)).not.toContain('referenceSolution');
    expect(Object.keys(brief)).not.toContain('rubricSpec');
  });

  it('после PASSED начать нельзя; сессия без реплик студента не засчитывается (A7)', () => {
    const v = buildSessionsView(
      brief,
      [
        row({ id: 'a', status: 'FAILED', verdictCode: 'ENDED_BY_STUDENT', userMessageCount: 0, endedAt: new Date('2026-09-25T08:10:00Z') }),
        row({ id: 'b', status: 'PASSED', verdictCode: 'PASSED', startedAt: new Date('2026-09-25T09:00:00Z'), endedAt: new Date('2026-09-25T09:20:00Z') }),
      ],
      task,
    );
    expect(v.items.map((i) => [i.id, i.counted])).toEqual([
      ['a', false],
      ['b', true],
    ]);
    expect(v.status).toBe('PASSED');
    expect(v.canStart).toBe(false);
    expect(v.final).toBe(true);
    assertNoJudgeOutput(v);
  });

  it('активная сессия возвращается как activeSessionId; две засчитанные неудачи — попытки исчерпаны', () => {
    const active = buildSessionsView(brief, [row({ id: 'x' })], task);
    expect(active.activeSessionId).toBe('x');
    expect(active.canStart).toBe(false);
    const used = buildSessionsView(
      brief,
      [
        row({ id: 'a', status: 'FAILED', verdictCode: 'FAILED_LIMIT', endedAt: new Date() }),
        row({ id: 'b', status: 'ABANDONED', verdictCode: 'ABANDONED', startedAt: new Date('2026-09-26T08:00:00Z'), endedAt: new Date() }),
      ],
      task,
    );
    expect(used.sessionsUsed).toBe(2);
    expect(used.canStart).toBe(false);
    expect(used.final).toBe(true);
    expect(used.latestFinishedSessionId).toBe('b');
  });
});
