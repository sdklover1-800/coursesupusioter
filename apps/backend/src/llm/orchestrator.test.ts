import { describe, it, expect, vi } from 'vitest';

/** Чистые части оркестратора без БД и LLM: первая реплика и транскрипт для судьи/тьютора. */
vi.mock('../config/env.js', () => ({ env: { NODE_ENV: 'test' }, isProd: false, tokenCeilingFor: () => 160000 }));
vi.mock('../lib/logger.js', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../telemetry/events.js', () => ({ logEvent: vi.fn(), audit: vi.fn() }));
vi.mock('./gateway.js', () => ({ getGateway: vi.fn(), addUsage: vi.fn() }));

import { OPENING_MESSAGE, openingMessage, transcriptFor } from './orchestrator.js';
import { informalAddress } from './addressForm.js';

const scenario = 'Представьте, что в вымышленной стране «Полисия»…';

describe('первая реплика тьютора без introMessage', () => {
  it('короткое приветствие на языке версии: ровно один вопрос в конце, без сценария, форма обращения фиксирована', () => {
    for (const lang of ['ru', 'kk', 'en'] as const) {
      const m = openingMessage(lang);
      expect(m.match(/\?/g)).toHaveLength(1);
      expect(m.trim().endsWith('?')).toBe(true);
      expect(m.length).toBeLessThan(200);
      expect(informalAddress(m, lang)).toEqual([]);
    }
  });

  it('transcriptFor: приветствие и сценарий как первая реплика не пересылаются судье и тьютору', () => {
    const student = { role: 'STUDENT', content: 'Начну с того, кто здесь действует.' };
    for (const first of [...Object.values(OPENING_MESSAGE), scenario]) {
      expect(transcriptFor([{ role: 'AI', content: first }, student], scenario)).toEqual([{ role: 'STUDENT', content: student.content }]);
    }
    // собственное вступление задания (introMessage) остаётся в транскрипте
    const intro = { role: 'AI', content: 'Добро пожаловать! Что вы замечаете в ситуации?' };
    expect(transcriptFor([intro, student], scenario)).toHaveLength(2);
    // SYSTEM-реплики не пересылаются никогда
    expect(transcriptFor([{ role: 'AI', content: OPENING_MESSAGE.ru }, student, { role: 'SYSTEM', content: 'Итог' }], scenario)).toHaveLength(1);
  });
});
