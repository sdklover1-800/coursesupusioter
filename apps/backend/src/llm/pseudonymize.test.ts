import { describe, it, expect } from 'vitest';
import { pseudonymizeText, pseudonymizeMessages } from './pseudonymize.js';

describe('pseudonymizeText (DP-5 — очистка идентификаторов на границе)', () => {
  it('вычищает email', () => {
    const r = pseudonymizeText('Свяжитесь: aigerim@esil.edu.kz по вопросу');
    expect(r.text).not.toContain('aigerim@esil.edu.kz');
    expect(r.text).toContain('[REDACTED_EMAIL]');
    expect(r.redactions).toBe(1);
  });

  it('вычищает ИИН (12 цифр)', () => {
    const r = pseudonymizeText('ИИН студента 123456789012 в заявке');
    expect(r.text).toContain('[REDACTED_ID]');
    expect(r.text).not.toContain('123456789012');
  });

  it('вычищает телефон', () => {
    const r = pseudonymizeText('Тел: +7 701 234 56 78 звоните');
    expect(r.text).toContain('[REDACTED_PHONE]');
  });

  it('обычный учебный текст не трогается', () => {
    const src = 'Аристотель проанализировал 150 полисов и создал классификацию форм правления.';
    const r = pseudonymizeText(src);
    expect(r.text).toBe(src);
    expect(r.redactions).toBe(0);
  });

  it('короткие числа (например, «150») не считаются телефоном', () => {
    const r = pseudonymizeText('в 150 городах');
    expect(r.text).toContain('150');
  });

  it('несколько идентификаторов считаются по отдельности', () => {
    const r = pseudonymizeText('a@b.kz и c@d.kz');
    expect(r.redactions).toBe(2);
  });
});

describe('pseudonymizeMessages', () => {
  it('чистит каждое сообщение и суммирует redactions', () => {
    const r = pseudonymizeMessages([
      { role: 'user', content: 'я x@y.kz' },
      { role: 'assistant', content: 'нет идентификаторов' },
    ]);
    expect(r.redactions).toBe(1);
    expect(r.messages[0]!.content).toContain('[REDACTED_EMAIL]');
    expect(r.messages[1]!.content).toBe('нет идентификаторов');
  });
});
