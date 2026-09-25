import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Language, VerifyResult } from '@edu/shared';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';

/** Публичная проверка: не чаще 30 запросов в минуту с одного IP (перебор серийных номеров). */
const verifyRateLimit = { rateLimit: { max: 30, timeWindow: '1 minute' } } as const;

/**
 * Публичная проверка сертификата по серийному номеру (без входа) — VerifyResult из @edu/shared.
 * Отдаётся только то, что напечатано на сертификате: ФИО, курс, язык, дата, модули
 * версии и эмитент. НИКОГДА — email, группа эксперимента (когорта) и баллы.
 * Неизвестный номер → 404 { valid: false } (не конверт ошибки: страница проверки
 * показывает «сертификат не найден» по valid).
 */
export async function verifyRoutes(app: FastifyInstance): Promise<void> {
  // GET /verify/:serial — открытая ссылка из QR-кода сертификата.
  app.get('/verify/:serial', { config: verifyRateLimit }, async (req, reply) => {
    const parsed = z.object({ serial: z.string().trim().min(1).max(64) }).safeParse(req.params);
    if (!parsed.success) return reply.code(404).send({ valid: false } satisfies VerifyResult);
    const serialNumber = parsed.data.serial.toUpperCase();

    const cert = await prisma.certificate.findUnique({
      where: { serialNumber },
      select: {
        serialNumber: true,
        issuedAt: true,
        enrollment: {
          select: {
            user: { select: { name: true } },
            languageVersion: {
              select: { title: true, language: true, modules: { orderBy: { orderIndex: 'asc' }, select: { title: true } } },
            },
          },
        },
      },
    });
    if (!cert) return reply.code(404).send({ valid: false } satisfies VerifyResult);

    const version = cert.enrollment.languageVersion;
    const result: VerifyResult = {
      valid: true,
      serialNumber: cert.serialNumber,
      holderName: cert.enrollment.user.name,
      courseTitle: version.title,
      language: version.language as Language,
      issuedAt: cert.issuedAt.toISOString(),
      moduleTitles: version.modules.map((m) => m.title),
      issuer: env.CERT_ISSUER_NAME,
    };
    return result;
  });
}
