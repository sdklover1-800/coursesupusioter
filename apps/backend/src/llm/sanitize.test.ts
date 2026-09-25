import { describe, it, expect } from 'vitest';
import { clampSentenceAware, collapseWhitespace, questionMarkCount, sanitizeTutorReply, splitSentences, stripMarkdown } from './sanitize.js';

/** Санитизация реплики тьютора (калибровка A.2, A22): markdown, пробелы, лимит по предложениям. */
describe('stripMarkdown / collapseWhitespace', () => {
  it('снимает жирный, заголовки, маркеры списков, обратные кавычки и ссылки', () => {
    const raw = '**Хорошо.** Рассмотрим:\n- тип режима\n- легитимность\n### Вопрос\nКакой признак `важнее` по [лекции](http://x)?';
    const { text, hadMarkdown } = stripMarkdown(raw);
    expect(hadMarkdown).toBe(true);
    expect(text).not.toMatch(/\*|`|#|^\s*-\s/m);
    expect(text).toContain('лекции');
    expect(text).not.toContain('http');
  });

  it('обычный текст не считается разметкой', () => {
    expect(stripMarkdown('Что вы думаете о режиме?').hadMarkdown).toBe(false);
  });

  it('нумерованный список 1) 2) склеивается в один абзац без слипания слов', () => {
    const out = collapseWhitespace(stripMarkdown('Подумайте о двух вещах:\n1) режим\n2) институты\nКакая связь между ними?').text);
    expect(out).toBe('Подумайте о двух вещах: режим; институты; Какая связь между ними?');
    expect(out).not.toContain('\n');
  });

  it('переносы и двойные пробелы схлопываются в один абзац', () => {
    expect(collapseWhitespace('Первое.  \n\n  Второе   предложение?')).toBe('Первое. Второе предложение?');
  });
});

describe('clampSentenceAware (A22)', () => {
  // Реплика на казахском > 700 символов (≈ 250 токенов kk), последнее предложение — вопрос.
  const kk =
    'Сіз саяси режимді анықтауға қатысты маңызды белгілерді атап өттіңіз, әсіресе бұқаралық ақпарат құралдарына бақылаудың күшеюін және сайлау ережелерін өзгерту ниетін. ' +
    'Бұл белгілер билік пен қоғам арасындағы қатынастың қалай өзгеріп жатқанын көрсетуі мүмкін, сондықтан оларды жеке-жеке емес, бір процестің бөліктері ретінде қарастырған жөн. ' +
    'Курстың екінші бөлімінде билік ресурстары мен легитимділік туралы айтылған тұстарды қайта қарап шығуға болады. ' +
    'Сонымен қатар наразылық акцияларының қалай басталғанын және биліктің оларға қалай жауап бергенін салыстырып көрсеңіз, қорытындыңыз нақтырақ болады. ' +
    'Осы белгілердің қайсысы Сіздің ойыңызша биліктің заңдылығы мен қоғамның оны мойындауы арасындағы айырмашылықты ең анық көрсетеді?';

  it('700+ символов kk: укладывается в 700, вопрос сохранён, выброшены самые ранние предложения', () => {
    expect(kk.length).toBeGreaterThan(700);
    const r = clampSentenceAware(kk, 700);
    expect(r.clamped).toBe(true);
    expect(r.overLimit).toBe(false);
    expect(r.text.length).toBeLessThanOrEqual(700);
    expect(r.text.endsWith('көрсетеді?')).toBe(true);
    expect(r.text.startsWith('Сіз саяси режимді')).toBe(false); // первое предложение ушло первым
    // Внутри предложения не режем: каждое оставшееся предложение — целиком из исходника
    for (const s of splitSentences(r.text)) expect(kk).toContain(s);
  });

  it('короткая реплика не меняется', () => {
    const t = 'Что вы видите в условии? ';
    expect(clampSentenceAware(t, 600)).toEqual({ text: 'Что вы видите в условии?', clamped: false, overLimit: false });
  });

  it('оборванная реплика (finish=length): недописанный хвост после вопроса выбрасывается', () => {
    const truncated =
      'Вы назвали несколько признаков. Какой из них сильнее всего говорит о легитимности власти? Кроме того, в разделе II курса обсуждались ресурсы влас';
    const r = clampSentenceAware(truncated, 100);
    expect(r.text).toBe('Вы назвали несколько признаков. Какой из них сильнее всего говорит о легитимности власти?');
    expect(r.text).not.toContain('ресурсы');
    // Тесный лимит: раннее предложение уходит первым, вопрос остаётся
    expect(clampSentenceAware(truncated, 60).text).toBe('Какой из них сильнее всего говорит о легитимности власти?');
  });

  it('вопрос длиннее лимита — не режем внутри, помечаем overLimit', () => {
    const q = `${'Очень '.repeat(30)}длинный вопрос?`;
    const r = clampSentenceAware(`Вступление. ${q}`, 50);
    expect(r.overLimit).toBe(true);
    expect(r.text).toBe(q);
  });

  it('вопрос в кавычках-ёлочках тоже распознаётся как последнее вопросительное предложение', () => {
    const t = `${'Длинное вступление без вопроса. '.repeat(5)}Спросите себя: «почему власть это делает?»`;
    const r = clampSentenceAware(t, 80);
    expect(r.text.endsWith('делает?»')).toBe(true);
  });
});

describe('sanitizeTutorReply', () => {
  it('markdown + лимит за один проход; ровно один вопрос сохраняется', () => {
    const raw = '**Интересно.**\n\n- Вы упомянули протесты.\n- Вы упомянули СМИ.\n\nКак эти два факта связаны с изменением правил выборов?';
    const r = sanitizeTutorReply(raw, 600);
    expect(r.hadMarkdown).toBe(true);
    expect(r.text).toBe('Интересно. Вы упомянули протесты. Вы упомянули СМИ. Как эти два факта связаны с изменением правил выборов?');
    expect(questionMarkCount(r.text)).toBe(1);
  });
});
