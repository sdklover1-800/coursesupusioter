/**
 * Healthcheck для контейнера api.
 *
 * Важно: GET /health отдаёт HTTP 200 и при status="degraded" (когда БД или Redis
 * недоступны) — см. app.ts. Поэтому проверка по коду ответа бесполезна, читаем тело.
 */
const port = process.env.PORT ?? '4000';
const timeout = AbortSignal.timeout(4000);

try {
  const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: timeout });
  const body = await res.json();
  if (body.status === 'ok') process.exit(0);
  console.error('degraded:', JSON.stringify(body.checks));
  process.exit(1);
} catch (err) {
  console.error('unreachable:', err instanceof Error ? err.message : String(err));
  process.exit(1);
}
