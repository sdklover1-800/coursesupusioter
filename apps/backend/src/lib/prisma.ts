import { PrismaClient } from '@prisma/client';
import { isProd } from '../config/env.js';

/**
 * Единственный экземпляр Prisma-клиента.
 * Пул соединений к БД — под пиковую нагрузку (NFR-1.3; в прод — через PgBouncer).
 * ORM даёт параметризованные запросы → защита от SQL-инъекций (NFR-2.5).
 */
export const prisma = new PrismaClient({
  log: isProd ? ['warn', 'error'] : ['warn', 'error'],
});
