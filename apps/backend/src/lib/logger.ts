import pino from 'pino';
import { env, isProd } from '../config/env.js';

/** Структурированное логирование (NFR-5.1). Pretty в dev, JSON в prod. */
export const logger = pino({
  level: isProd ? 'info' : 'debug',
  transport: isProd
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
  redact: {
    // Никогда не логируем секреты/ПДн (DP-1)
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.passwordHash', '*.password', 'req.body.password'],
    remove: true,
  },
  base: { env: env.NODE_ENV },
});
