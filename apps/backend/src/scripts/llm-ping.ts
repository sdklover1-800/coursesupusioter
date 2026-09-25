/**
 * Проверка LLM-провайдера одной командой: ключ, модели и режимы, которыми
 * пользуется платформа — обычный ответ (генерация), JSON-режим (судья) и
 * потоковый диалог (тьютор). Идёт через шлюз, как и боевые вызовы.
 *
 *   npm run llm:ping --workspace @edu/backend        (dev)
 *   node dist/scripts/llm-ping.js                     (прод-образ)
 */
import { z } from 'zod';
import { env } from '../config/env.js';
import { LlmGateway } from '../llm/gateway.js';
import { redis } from '../lib/redis.js';

async function timed<T>(label: string, fn: () => Promise<T>, show: (r: T) => string): Promise<boolean> {
  const t0 = Date.now();
  try {
    const r = await fn();
    console.log(`  ✅ ${label} — ${Date.now() - t0} мс — ${show(r)}`);
    return true;
  } catch (e) {
    console.log(`  ❌ ${label} — ${(e as Error).message}`);
    return false;
  }
}

async function main() {
  console.log(`Провайдер: ${env.LLM_PROVIDER}`);
  console.log(`Модели: генерация=${env.LLM_MODEL_GENERATION}, диалог=${env.LLM_MODEL_DIALOG}, судья=${env.LLM_MODEL_JUDGE}\n`);
  const gw = new LlmGateway();
  const results = await Promise.all([
    timed(
      'генерация (текст)',
      () => gw.complete({ model: env.LLM_MODEL_GENERATION, purpose: 'generation', maxTokens: 200, messages: [{ role: 'user', content: 'Саясаттану деген не? Бір сөйлеммен қазақша жауап бер.' }] }),
      (r) => `${r.model}, ${r.usage.inputTokens}→${r.usage.outputTokens} ток.: «${r.text.slice(0, 80)}»`,
    ),
    timed(
      'судья (JSON)',
      () =>
        gw.completeStructured(
          { model: env.LLM_MODEL_JUDGE, purpose: 'judge', maxTokens: 200, messages: [{ role: 'user', content: 'Оцени ответ студента «демократия — власть народа». Верни объект {"correct": boolean, "reason": string}.' }] },
          z.object({ correct: z.boolean(), reason: z.string() }),
          'llm-ping',
        ),
      (r) => `${r.result.model}: ${JSON.stringify(r.data).slice(0, 80)}`,
    ),
    timed(
      'диалог (поток)',
      async () => {
        let chunks = 0;
        const r = await gw.stream(
          { model: env.LLM_MODEL_DIALOG, purpose: 'dialog', maxTokens: 120, messages: [{ role: 'user', content: 'Задай мне один наводящий вопрос о разделении властей.' }] },
          () => { chunks++; },
        );
        return { ...r, chunks };
      },
      (r) => `${r.model}, чанков ${r.chunks}: «${r.text.slice(0, 80)}»`,
    ),
  ]);
  const ok = results.filter(Boolean).length;
  console.log(`\n${ok === results.length ? '✅ Всё работает' : `❌ Не прошло: ${results.length - ok} из ${results.length}`}`);
  if (ok !== results.length) process.exitCode = 1;
}

main()
  .catch((e) => { console.error('❌', (e as Error).message); process.exitCode = 1; })
  .finally(async () => {
    await Promise.race([redis.quit(), new Promise((r) => setTimeout(r, 2000))]).catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  });
