import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Language } from '@edu/shared';
import { lengthCue, testwiseScore } from '../../generation/quality.js';
import {
  type EditableQuestion,
  type TextFix,
  applyTextEdits,
  questionLanguageProblems,
  replaceFirstLine,
  shortRationales,
  unfinishedSeries,
  validateTextFixes,
} from './revisions.js';

const q = (over: Partial<EditableQuestion> = {}): EditableQuestion => ({
  prompt: 'The leader concentrated кадровые decisions in his hands.',
  options: ['A', 'B', 'C', 'D'],
  explanation: 'Because of oligarchy.',
  optionRationales: ['no', 'no', 'no', 'Correct: concentration of кадровые, financial resources.'],
  ...over,
});

describe('applyTextEdits', () => {
  const edits = [
    { field: 'prompt' as const, from: 'кадровые decisions', to: 'personnel decisions' },
    { field: 'optionRationales' as const, index: 3, from: 'of кадровые,', to: 'of personnel,' },
  ];

  it('заменяет якорь и сообщает изменённые поля, не трогая варианты', () => {
    const r = applyTextEdits(q(), edits);
    expect(r.status).toBe('apply');
    if (r.status !== 'apply') return;
    expect(r.next.prompt).toBe('The leader concentrated personnel decisions in his hands.');
    expect(r.next.optionRationales![3]).toBe('Correct: concentration of personnel, financial resources.');
    expect(r.next.options).toEqual(['A', 'B', 'C', 'D']);
    expect(r.changedFields).toEqual(['prompt', 'optionRationales']);
  });

  it('повторное применение — already (идемпотентно)', () => {
    const first = applyTextEdits(q(), edits);
    if (first.status !== 'apply') throw new Error('ожидалось apply');
    expect(applyTextEdits(first.next, edits)).toEqual({ status: 'already' });
  });

  it('«стало» содержит «было» — не дублирует при повторе', () => {
    const e = [{ field: 'explanation' as const, from: 'oligarchy', to: 'oligarchy (Michels)' }];
    const first = applyTextEdits(q(), e);
    if (first.status !== 'apply') throw new Error('ожидалось apply');
    expect(first.next.explanation).toBe('Because of oligarchy (Michels).');
    expect(applyTextEdits(first.next, e)).toEqual({ status: 'already' });
  });

  it('сокращение («было» содержит «стало») применяется, а не считается сделанным', () => {
    const e = [{ field: 'explanation' as const, from: 'Because of oligarchy.', to: 'Because of' }];
    const r = applyTextEdits(q(), e);
    expect(r.status).toBe('apply');
    if (r.status === 'apply') expect(applyTextEdits(r.next, e)).toEqual({ status: 'already' });
  });

  it('нет ни «было», ни «стало» — mismatch, ничего не пишется', () => {
    const r = applyTextEdits(q({ prompt: 'Иной стенд' }), edits);
    expect(r.status).toBe('mismatch');
  });

  it('частично применённые правки: применяется остаток', () => {
    const r = applyTextEdits(q({ prompt: 'The leader concentrated personnel decisions in his hands.' }), edits);
    expect(r.status).toBe('apply');
    if (r.status === 'apply') expect(r.changedFields).toEqual(['optionRationales']);
  });

  it('whole: только точное совпадение значения', () => {
    const e = [{ field: 'optionRationales' as const, index: 0, from: 'no', to: 'This answer is wrong: a full sentence.', match: 'whole' as const }];
    expect(applyTextEdits(q(), e).status).toBe('apply');
    expect(applyTextEdits(q({ optionRationales: ['no way', 'no', 'no', 'x'] }), e).status).toBe('mismatch');
    expect(applyTextEdits(q({ optionRationales: ['This answer is wrong: a full sentence.', 'no', 'no', 'x'] }), e)).toEqual({ status: 'already' });
  });

  it('индекс вне диапазона и пустые правки — mismatch', () => {
    expect(applyTextEdits(q(), [{ field: 'options', index: 7, from: 'A', to: 'B' }]).status).toBe('mismatch');
    expect(applyTextEdits(q(), [{ field: 'prompt', from: 'x', to: 'x' }]).status).toBe('mismatch');
    expect(applyTextEdits(q(), []).status).toBe('mismatch');
  });

  it('цепочка правок одного места: у всех «стало» = итоговый текст — любой стенд сходится', () => {
    const orig = 'Вариант 0';
    const mid = 'Вариант 1';
    const final = 'Вариант 2';
    const fix1 = [{ field: 'prompt' as const, match: 'whole' as const, from: orig, to: final }];
    const fix2 = [{ field: 'prompt' as const, match: 'whole' as const, from: mid, to: final }];
    // Стенд, где правок не было: fix1 применяется, fix2 — уже.
    const a = applyTextEdits(q({ prompt: orig }), fix1);
    expect(a.status === 'apply' && a.next.prompt).toBe(final);
    expect(applyTextEdits(q({ prompt: final }), fix2)).toEqual({ status: 'already' });
    // Стенд с первой редакцией fix1 (журнал есть): fix2 доводит до итога.
    const b = applyTextEdits(q({ prompt: mid }), fix2);
    expect(b.status === 'apply' && b.next.prompt).toBe(final);
    // Стенд, получивший исправленный артефакт: обе — уже.
    expect(applyTextEdits(q({ prompt: final }), fix1)).toEqual({ status: 'already' });
  });

  it('два вхождения якоря — mismatch (неоднозначно)', () => {
    expect(applyTextEdits(q({ prompt: 'a b a' }), [{ field: 'prompt', from: 'a', to: 'c' }]).status).toBe('mismatch');
  });
});

describe('validateTextFixes', () => {
  const base: TextFix = { id: 'x', lang: 'en', quiz: { kind: 'COURSE_FINAL' }, orderIndex: 0, note: '', edits: [{ field: 'prompt', from: 'a', to: 'b' }] };
  it('ловит повтор id, отсутствие адреса и index', () => {
    expect(validateTextFixes([base])).toEqual([]);
    expect(validateTextFixes([base, base])).toEqual(['x: повтор id']);
    expect(validateTextFixes([{ ...base, orderIndex: undefined }])).toEqual(['x: нет canonicalKey или orderIndex']);
    expect(validateTextFixes([{ ...base, edits: [{ field: 'options', from: 'a', to: 'b' }] }])).toEqual(['x: options без index']);
  });
});

describe('языковые проверки', () => {
  const tf = (lang: Language, rationales: string[], prompt = 'Statement.') => questionLanguageProblems(lang, { type: 'TRUE_FALSE', prompt, options: ['T', 'F'], explanation: null, optionRationales: rationales });

  it('en: любая кириллица, в том числе смешанное «verно»', () => {
    expect(tf('en', ['Верно, because the lecture says so.', 'verно'])).toEqual(['optionRationales[0]: кириллица', 'optionRationales[1]: кириллица']);
    expect(tf('en', ['The statement is true: the lecture says so.', 'This answer is wrong: see the lecture.'])).toEqual([]);
  });

  it('kk: русские «верно/неверно», но не казахские метки', () => {
    expect(tf('kk', ['Верно, өйткені дәрісте солай айтылған.', 'Бұл тұжырым неверно деп бағаланады.'])).toHaveLength(2);
    expect(tf('kk', ['Тұжырым дұрыс: дәрісте солай айтылған.', 'Бұл жауап дұрыс емес: тұжырым қате емес.'])).toEqual([]);
  });

  it('ru: русские метки допустимы', () => {
    expect(tf('ru', ['Утверждение верно: так сказано в лекции.', 'Этот ответ ошибочен: неверно понято.'])).toEqual([]);
  });

  it('вырожденные обоснования короче 25 символов', () => {
    expect(shortRationales(q({ optionRationales: ['верно', 'неверно', 'Утверждение верно: так сказано в лекции.'] }))).toEqual([0, 1]);
  });
});

describe('replaceFirstLine', () => {
  const fix = { from: '6-ЛЕКЦИЯ', to: '№6 ДӘРІС' };
  it('меняет только первую непустую строку', () => {
    expect(replaceFirstLine('6-ЛЕКЦИЯ\n6-дәріс. Мемлекет\n6-ЛЕКЦИЯ', fix)).toEqual({ status: 'apply', text: '№6 ДӘРІС\n6-дәріс. Мемлекет\n6-ЛЕКЦИЯ' });
  });
  it('уже исправлено / иной стенд', () => {
    expect(replaceFirstLine('№6 ДӘРІС\nтекст', fix)).toEqual({ status: 'already', first: '№6 ДӘРІС' });
    expect(replaceFirstLine('6-дәріс. Мемлекет', fix)).toEqual({ status: 'absent', first: '6-дәріс. Мемлекет' });
  });
});

describe('unfinishedSeries', () => {
  const t = (h: number) => new Date(Date.UTC(2026, 8, 25, h));
  const a = (enrollmentId: string, h: number, over: Partial<{ submittedAt: Date | null; passed: boolean; score: number }> = {}) => ({
    id: `${enrollmentId}-${h}`,
    enrollmentId,
    startedAt: t(h),
    submittedAt: t(h + 1),
    score: 0.4,
    passed: false,
    ...over,
  });
  const rules = { maxAttempts: 2, scoringRule: 'BEST' as const };

  it('отправленная неуспешная 1-я попытка из 2 — серия не завершена', () => {
    expect(unfinishedSeries([a('e1', 1)], rules)).toEqual(['e1']);
  });
  it('сдано или попытки исчерпаны — финал, серии нет', () => {
    expect(unfinishedSeries([a('e1', 1, { passed: true, score: 0.9 })], rules)).toEqual([]);
    expect(unfinishedSeries([a('e1', 1), a('e1', 3)], rules)).toEqual([]);
  });
  it('только попытка в процессе — не серия (её ловит отдельная проверка); отправленная + идущая — серия', () => {
    expect(unfinishedSeries([a('e1', 1, { submittedAt: null })], rules)).toEqual([]);
    expect(unfinishedSeries([a('e1', 1), a('e1', 3, { submittedAt: null })], rules)).toEqual(['e1']);
  });
});

/* ── Проверенные артефакты content-data (регрессия ревизии 2026-09-26) ── */

const DATA = join(dirname(fileURLToPath(import.meta.url)), '../../../content-data/politology');
const read = <T>(name: string): T => JSON.parse(readFileSync(join(DATA, name), 'utf8')) as T;

interface ArtQuestion extends EditableQuestion {
  type: string;
  correctOptionIds: number[];
  canonicalKey?: string;
}
type Bank = { meta: { textFixes?: TextFix[] } } & Record<'ru' | 'kk' | 'en', Record<string, ArtQuestion[]>>;

describe('graded-bank.v1.json', () => {
  const bank = read<Bank>('graded-bank.v1.json');
  const langs: Language[] = ['ru', 'kk', 'en'];

  it('правки textFixes уже внесены в сам артефакт (already)', () => {
    const fixes = bank.meta.textFixes ?? [];
    expect(fixes.length).toBeGreaterThan(0);
    expect(validateTextFixes(fixes)).toEqual([]);
    for (const f of fixes) {
      const module = f.quiz.kind === 'MODULE_FINAL' ? `M${f.quiz.module + 1}` : '';
      const item = bank[f.lang as 'ru' | 'kk' | 'en'][module]!.find((x) => x.canonicalKey === f.canonicalKey)!;
      expect(applyTextEdits(item, f.edits), f.id).toEqual({ status: 'already' });
    }
  });

  it('без чужого алфавита и вырожденных обоснований; гейт длины и testwise ≤ 0.375 в каждом модуле', () => {
    for (const lang of langs) {
      for (const [m, items] of Object.entries(bank[lang])) {
        for (const x of items) {
          expect(questionLanguageProblems(lang, x), `${lang} ${x.canonicalKey}`).toEqual([]);
          expect(shortRationales(x), `${lang} ${x.canonicalKey}`).toEqual([]);
          expect(lengthCue(x.options, x.correctOptionIds), `${lang} ${x.canonicalKey}`).toBe(false);
        }
        expect(testwiseScore(items), `${lang} ${m}`).toBeLessThanOrEqual(0.375);
      }
    }
  });
});

describe('обоснования TRUE_FALSE (rationales.v1.json, overlaps.v1.json)', () => {
  type Row = { prompt: string; options: string[]; correctOptionIds: number[]; optionRationales: string[] };
  const rat = read<{ meta: { textFixes?: TextFix[] }; quizzes: { lang: Language; rows: Row[] }[] }>('rationales.v1.json');
  const ovl = read<{ meta: { textFixes?: TextFix[] }; minis: { lang: Language; items: (Row & { type: string; explanation: string | null })[] }[] }>('overlaps.v1.json');
  const tfRows = [
    ...rat.quizzes.flatMap((z) => z.rows.filter((r) => r.options.length === 2).map((r) => ({ lang: z.lang, r }))),
    ...ovl.minis.flatMap((m) => m.items.filter((r) => r.type === 'TRUE_FALSE').map((r) => ({ lang: m.lang, r }))),
  ];
  const prefix: Record<Language, { ok: [string, string]; wrong: string }> = {
    ru: { ok: ['Утверждение верно:', 'Утверждение неверно:'], wrong: 'Этот ответ ошибочен:' },
    kk: { ok: ['Тұжырым дұрыс:', 'Тұжырым қате:'], wrong: 'Бұл жауап дұрыс емес:' },
    en: { ok: ['The statement is true:', 'The statement is false:'], wrong: 'This answer is wrong:' },
  };

  it('45 вопросов: язык курса, полные предложения, вердикт согласован с ключом', () => {
    expect(tfRows).toHaveLength(45);
    for (const { lang, r } of tfRows) {
      const k = r.correctOptionIds[0]!;
      const q = { type: 'TRUE_FALSE', prompt: r.prompt, options: r.options, explanation: null, optionRationales: r.optionRationales };
      expect(questionLanguageProblems(lang, q), r.prompt).toEqual([]);
      expect(shortRationales(q), r.prompt).toEqual([]);
      expect(r.optionRationales[k]!.startsWith(prefix[lang].ok[k]!), r.prompt).toBe(true);
      expect(r.optionRationales[1 - k]!.startsWith(prefix[lang].wrong), r.prompt).toBe(true);
    }
  });

  it('textFixes: «стало» совпадает с артефактом, id уникальны', () => {
    const fixes = [...(rat.meta.textFixes ?? []), ...(ovl.meta.textFixes ?? [])];
    expect(fixes).toHaveLength(45);
    expect(validateTextFixes(fixes)).toEqual([]);
    const byPrompt = new Map(tfRows.map(({ r }) => [r.prompt, r]));
    for (const f of fixes) {
      const r = byPrompt.get(f.prompt!)!;
      expect(r, f.id).toBeDefined();
      expect(applyTextEdits({ prompt: r.prompt, options: r.options, explanation: null, optionRationales: r.optionRationales }, f.edits), f.id).toEqual({ status: 'already' });
    }
  });
});
