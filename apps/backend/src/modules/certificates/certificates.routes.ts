import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Role } from '@edu/shared';
import { prisma } from '../../lib/prisma.js';
import { parse } from '../../lib/validate.js';
import { Errors } from '../../lib/errors.js';
import { buildCertificatePdf } from './certificate.service.js';

export async function certificateRoutes(app: FastifyInstance): Promise<void> {
  // GET /me/certificates/:enrollmentId — PDF сертификат (STUDENT, FR-9.2, FR-9.3).
  app.get('/me/certificates/:enrollmentId', { preHandler: [app.authenticate, app.requireRole(Role.STUDENT)] }, async (req, reply) => {
    const { enrollmentId } = parse(z.object({ enrollmentId: z.string() }), req.params);
    const enrollment = await prisma.enrollment.findUnique({ where: { id: enrollmentId } });
    if (!enrollment || enrollment.userId !== req.user!.id) throw Errors.forbidden('Нет доступа');
    if (enrollment.status !== 'COMPLETED') throw Errors.badRequest('Курс ещё не завершён');

    const pdf = await buildCertificatePdf(enrollmentId);
    if (!pdf) throw Errors.notFound('Сертификат не найден');
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="${pdf.filename}"`);
    return reply.send(pdf.stream);
  });

  // GET /me/certificates — список выданных сертификатов.
  app.get('/me/certificates', { preHandler: [app.authenticate, app.requireRole(Role.STUDENT)] }, async (req) => {
    const certs = await prisma.certificate.findMany({
      where: { enrollment: { userId: req.user!.id } },
      include: { enrollment: { include: { languageVersion: { select: { title: true, language: true } } } } },
      orderBy: { issuedAt: 'desc' },
    });
    return { items: certs.map((c) => ({ id: c.id, serialNumber: c.serialNumber, issuedAt: c.issuedAt, enrollmentId: c.enrollmentId, course: c.enrollment.languageVersion.title, language: c.enrollment.languageVersion.language })) };
  });
}
