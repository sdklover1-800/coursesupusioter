import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Конвейер генерации (gen-2.0): планирование записи и сквозные проверки с подменой
 * БД и LLM-шлюза — без сети и без реальной базы.
 */
const mocks = vi.hoisted(() => ({
  completeStructured: vi.fn(),
  versionFindUnique: vi.fn(),
  moduleFindUnique: vi.fn(),
  quizFindUnique: vi.fn(),
  lectureFindUnique: vi.fn(),
  transaction: vi.fn(),
  practicalUpsert: vi.fn(),
}));

vi.mock('../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    LLM_MODEL_GENERATION: 'mock-model',
    LLM_PRICE_INPUT_PER_MTOK: 0.75,
    LLM_PRICE_OUTPUT_PER_MTOK: 4.5,
    LLM_PRICE_CACHED_INPUT_PER_MTOK: 0.075,
  },
  isProd: false,
  practicalTokenBudget: (n: number) => n,
}));
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../llm/gateway.js', () => ({ getGateway: () => ({ completeStructured: mocks.completeStructured }) }));
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    courseLanguageVersion: { findUnique: mocks.versionFindUnique },
    module: { findUnique: mocks.moduleFindUnique },
    quiz: { findUnique: mocks.quizFindUnique, create: vi.fn() },
    lecture: { findUnique: mocks.lectureFindUnique, findMany: vi.fn(async () => []), update: vi.fn() },
    quizQuestion: { findMany: vi.fn(async () => []) },
    practicalTask: { upsert: mocks.practicalUpsert },
    $transaction: mocks.transaction,
  },
}));

import { planQuizWrite, planPracticalWrite, runGeneration, RUNNABLE_GENERATION_TYPES } from './service.js';
import { archivedOrderIndex, ARCHIVE_ORDER_BASE } from './drafts.js';
import type { GenerationJobData } from '../queue/queues.js';

const job = (type: GenerationJobData['type'], regenStrategy: 'KEEP' | 'OVERWRITE' | 'APPEND'): GenerationJobData => ({
  generationJobId: 'job1',
  courseLanguageVersionId: 'v1',
  type,
  params: { regenStrategy },
  createdById: 'u1',
});

const version = (modules: unknown[]) => ({ id: 'v1', language: 'kk', title: 'Саясаттануға кіріспе', modules });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('planQuizWrite', () => {
  const base = { isGraded: true, attemptCount: 0, activeCount: 6, editedCount: 1, target: 8 };

  it('оцениваемый тест с попытками — frozen при любой стратегии', () => {
    for (const strategy of ['KEEP', 'OVERWRITE', 'APPEND'] as const) {
      expect(planQuizWrite({ ...base, strategy, attemptCount: 1 })).toEqual({ action: 'skip', reason: 'frozen' });
    }
  });

  it('тренировочный тест не «замораживается» (попыток у него не бывает)', () => {
    expect(planQuizWrite({ ...base, isGraded: false, attemptCount: 3, strategy: 'OVERWRITE' }).action).toBe('generate');
  });

  it('KEEP: пропуск при наличии вопросов, иначе полный набор', () => {
    expect(planQuizWrite({ ...base, strategy: 'KEEP' })).toEqual({ action: 'skip', reason: 'keep' });
    expect(planQuizWrite({ ...base, strategy: 'KEEP', activeCount: 0, editedCount: 0 })).toEqual({
      action: 'generate',
      count: 8,
      archiveNonEdited: false,
    });
  });

  it('OVERWRITE: ровно target вопросов вместе с сохранёнными ручными правками', () => {
    expect(planQuizWrite({ ...base, strategy: 'OVERWRITE' })).toEqual({ action: 'generate', count: 7, archiveNonEdited: true });
    expect(planQuizWrite({ ...base, strategy: 'OVERWRITE', editedCount: 8 })).toEqual({ action: 'skip', reason: 'full' });
  });

  it('APPEND: только добор до target', () => {
    expect(planQuizWrite({ ...base, strategy: 'APPEND' })).toEqual({ action: 'generate', count: 2, archiveNonEdited: false });
    expect(planQuizWrite({ ...base, strategy: 'APPEND', activeCount: 8 })).toEqual({ action: 'skip', reason: 'full' });
  });
});

describe('planPracticalWrite', () => {
  it('KEEP/APPEND при существующем задании — пропуск (без LLM)', () => {
    const existing = { isEdited: false, canonicalRef: null };
    expect(planPracticalWrite({ strategy: 'KEEP', existing })).toEqual({ action: 'skip', reason: 'keep' });
    expect(planPracticalWrite({ strategy: 'APPEND', existing })).toEqual({ action: 'skip', reason: 'keep' });
  });

  it('каноническое задание не перегенерируется даже при OVERWRITE', () => {
    expect(planPracticalWrite({ strategy: 'OVERWRITE', existing: { isEdited: true, canonicalRef: 'polisia-v1' } })).toEqual({
      action: 'skip',
      reason: 'canonical',
    });
  });

  it('OVERWRITE обновляет и название; нового задания — генерация', () => {
    expect(planPracticalWrite({ strategy: 'OVERWRITE', existing: { isEdited: false, canonicalRef: null } })).toEqual({
      action: 'generate',
      refreshTitle: true,
    });
    expect(planPracticalWrite({ strategy: 'KEEP', existing: null })).toEqual({ action: 'generate', refreshTitle: false });
  });
});

describe('runGeneration (подмена БД и LLM)', () => {
  it('KEEP на существующем практическом задании — НИ ОДНОГО вызова LLM', async () => {
    mocks.versionFindUnique.mockResolvedValue(
      version([
        {
          id: 'm5',
          title: 'V бөлім',
          assessmentType: 'PRACTICAL',
          coversWholeCourse: true,
          lectures: [],
          quiz: null,
          practicalTask: { isEdited: false, canonicalRef: null },
        },
      ]),
    );
    const r = await runGeneration(job('PRACTICAL', 'KEEP'));
    expect(mocks.completeStructured).not.toHaveBeenCalled();
    expect(mocks.practicalUpsert).not.toHaveBeenCalled();
    expect(r.practicals).toBe(0);
    expect(r.skipped.keep).toBe(1);
    expect(r.promptVersion).toBe('gen-2.0');
  });

  it('OVERWRITE оцениваемого теста с попытками — пропуск (frozen), без LLM и без записи', async () => {
    mocks.versionFindUnique.mockResolvedValue(
      version([
        { id: 'm1', title: 'I бөлім', assessmentType: 'QUIZ', coversWholeCourse: false, lectures: [], quiz: { id: 'q1' }, practicalTask: null },
      ]),
    );
    mocks.moduleFindUnique.mockResolvedValue({ id: 'm1', title: 'I бөлім' });
    mocks.quizFindUnique.mockResolvedValue({
      id: 'q1',
      isGraded: true,
      questions: [{ id: 'qq1', prompt: 'Сұрақ?', isEdited: false, sourceLectureId: null }],
      _count: { attempts: 2 },
    });
    const r = await runGeneration(job('QUIZ', 'OVERWRITE'));
    expect(r.skipped.frozen).toBe(1);
    expect(r.quizzes).toBe(0);
    expect(mocks.completeStructured).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('LECTURE_SUMMARY + KEEP пропускает лекции с готовым кратким содержанием без LLM', async () => {
    mocks.versionFindUnique.mockResolvedValue(
      version([
        {
          id: 'm1',
          title: 'I',
          assessmentType: 'QUIZ',
          coversWholeCourse: false,
          lectures: [{ id: 'l1', title: '1', transcriptText: 'мәтін' }],
          quiz: null,
          practicalTask: null,
        },
      ]),
    );
    mocks.lectureFindUnique.mockResolvedValue({ summary: 'Дайын қысқаша мазмұн.', transcriptText: 'мәтін' });
    const r = await runGeneration(job('LECTURE_SUMMARY', 'KEEP'));
    expect(r.summaries).toBe(0);
    expect(r.skipped.keep).toBe(1);
    expect(mocks.completeStructured).not.toHaveBeenCalled();
  });

  it('неизвестный тип задачи — громкая ошибка', async () => {
    await expect(runGeneration(job('BOGUS' as never, 'KEEP'))).rejects.toThrow(/Неизвестный тип/);
    expect(mocks.versionFindUnique).not.toHaveBeenCalled();
  });

  it('LECTURE_SUMMARY входит в поддерживаемые типы', () => {
    expect(RUNNABLE_GENERATION_TYPES.has('LECTURE_SUMMARY')).toBe(true);
  });
});

describe('archivedOrderIndex (ARCHIVE_REPLACE)', () => {
  it('10000 + партия·100 + прежний индекс', () => {
    expect(archivedOrderIndex(0, 0)).toBe(ARCHIVE_ORDER_BASE);
    expect(archivedOrderIndex(5, 0)).toBe(10005);
    expect(archivedOrderIndex(7, 2)).toBe(10207);
  });

  it('разные партии и индексы не пересекаются', () => {
    const seen = new Set<number>();
    for (let b = 0; b < 5; b++) for (let i = 0; i < 100; i++) seen.add(archivedOrderIndex(i, b));
    expect(seen.size).toBe(500);
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(ARCHIVE_ORDER_BASE);
  });

  it('индекс вне 0..99 и отрицательная партия отклоняются', () => {
    expect(() => archivedOrderIndex(100, 0)).toThrow();
    expect(() => archivedOrderIndex(-1, 0)).toThrow();
    expect(() => archivedOrderIndex(1, -1)).toThrow();
  });
});
