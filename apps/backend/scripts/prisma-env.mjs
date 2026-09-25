#!/usr/bin/env node
/**
 * Prisma CLI с переменными из корневого .env монорепо.
 *
 * Prisma CLI сам читает только apps/backend/.env и prisma/.env, а DATABASE_URL лежит
 * в корневом .env (его же читают dev/worker/db:seed через --env-file-if-exists).
 * Без обёртки `prisma migrate status` падает с P1012 «DATABASE_URL not found».
 *
 * Уже заданные переменные окружения важнее файла (как у --env-file); файла нет —
 * запускаем как есть (Docker/CI передают переменные сами).
 *
 *   node scripts/prisma-env.mjs migrate status   (npm run db:status)
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(here, '../../../.env');
const env = { ...process.env };
if (existsSync(envFile)) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync(envFile, 'utf8')))) {
    if (env[key] === undefined) env[key] = value;
  }
}

const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
const res = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { stdio: 'inherit', env, cwd: resolve(here, '..') });
if (res.error) {
  console.error(res.error.message);
  process.exit(1);
}
process.exit(res.status ?? 1);
