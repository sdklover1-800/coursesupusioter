/**
 * Нагрузочный тест API (AC-13, §8.1). Характеризует НЕ-LLM read-path (NFR-1.6:
 * отклик — десятки–сотни мс). LLM-эндпоинты (диалог/генерация) намеренно НЕ
 * нагружаются: их пропускная способность ограничена моделью и регулируется
 * очередью + семафором параллелизма (NFR-1.5), а не приложением.
 *
 * Запуск (сервер поднят):  node scripts/loadtest.mjs [connections] [duration]
 */
import autocannon from 'autocannon';

const BASE = process.env.LOAD_BASE ?? 'http://localhost:4000';
const CONNECTIONS = Number(process.argv[2] ?? 250);
const DURATION = Number(process.argv[3] ?? 20);

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${email}: HTTP ${res.status}`);
  return (await res.json()).accessToken;
}

async function firstEnrollment(token) {
  const res = await fetch(`${BASE}/api/me/courses`, { headers: { Authorization: `Bearer ${token}` } });
  const items = (await res.json()).items;
  return items[0]; // { id: enrollmentId, courseId }
}

function fmt(r) {
  return {
    reqPerSec: Math.round(r.requests.average),
    latency_p50_ms: r.latency.p50,
    latency_p90_ms: r.latency.p90,
    latency_p99_ms: r.latency.p99,
    latency_max_ms: r.latency.max,
    non2xx: r.non2xx,
    errors: r.errors,
    timeouts: r.timeouts,
    total: r.requests.total,
  };
}

function run(title, opts) {
  return new Promise((resolve, reject) => {
    console.log(`\n▶ ${title}  (connections=${CONNECTIONS}, duration=${DURATION}s)`);
    const inst = autocannon({ url: BASE, connections: CONNECTIONS, duration: DURATION, ...opts }, (err, res) => {
      if (err) return reject(err);
      console.log('   ', JSON.stringify(fmt(res)));
      resolve(fmt(res));
    });
    autocannon.track(inst, { renderProgressBar: false });
  });
}

async function main() {
  const student = await login('student@edu.kz', 'Student123!');
  const enr = await firstEnrollment(student);
  const authHeader = { authorization: `Bearer ${student}` };
  console.log(`Цель: ${BASE} | enrollment=${enr.id} course=${enr.courseId}`);

  const results = {};
  results.health = await run('GET /health (baseline, без БД-нагрузки авторизации)', { requests: [{ method: 'GET', path: '/health' }] });
  results.meCourses = await run('GET /api/me/courses (auth + запрос)', { headers: authHeader, requests: [{ method: 'GET', path: '/api/me/courses' }] });
  results.learn = await run('GET /api/courses/:id/learn (auth + consent + вложенные include)', {
    headers: authHeader,
    requests: [{ method: 'GET', path: `/api/courses/${enr.courseId}/learn?enrollmentId=${enr.id}` }],
  });

  console.log('\n=== ИТОГ ===');
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error('load test failed:', e.message); process.exit(1); });
