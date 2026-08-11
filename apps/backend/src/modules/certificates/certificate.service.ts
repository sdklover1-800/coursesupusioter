import PDFDocument from 'pdfkit';
import { Prisma } from '@prisma/client';
import { customAlphabet } from 'nanoid';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { logEvent } from '../../telemetry/events.js';
import { EventType, LANGUAGE_LABELS, type Language } from '@edu/shared';

const serialGen = customAlphabet('0123456789ABCDEFGHJKMNPQRSTUVWXYZ', 10);

/** Уникальный серийный номер сертификата (FR-9.2). */
function makeSerial(): string {
  return `EDU-${new Date().getFullYear()}-${serialGen()}`;
}

/**
 * Выдаёт сертификат по факту завершения курса, если ещё не выдан (FR-9.1).
 * Идемпотентно (1:1 с enrollment).
 */
export async function issueCertificateIfAbsent(enrollmentId: string): Promise<void> {
  const existing = await prisma.certificate.findUnique({ where: { enrollmentId } });
  if (existing) return;
  const serialNumber = makeSerial();
  try {
    const cert = await prisma.certificate.create({ data: { enrollmentId, serialNumber } });
    await logEvent({ eventType: EventType.CERTIFICATE_ISSUED, enrollmentId, payload: { serialNumber, certificateId: cert.id } });
  } catch (err) {
    // Гонка (аудит M3): recomputeProgress зовётся из нескольких мест параллельно;
    // при одновременной выдаче ловим нарушение @unique(enrollmentId) как «уже выдан».
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return;
    throw err;
  }
}

const L10N = {
  title: { kk: 'СЕРТИФИКАТ', ru: 'СЕРТИФИКАТ', en: 'CERTIFICATE' },
  subtitle: {
    kk: 'курсты сәтті аяқтағанын растайды',
    ru: 'подтверждает успешное прохождение курса',
    en: 'certifies successful completion of the course',
  },
  language: { kk: 'Тіл', ru: 'Язык', en: 'Language' },
  date: { kk: 'Күні', ru: 'Дата', en: 'Date' },
  serial: { kk: 'Сериялық нөмір', ru: 'Серийный номер', en: 'Serial number' },
} as const;

// Путь к встроенному Unicode-шрифту (apps/backend/assets/fonts). Резолвится
// относительно файла — работает и в tsx (src), и в сборке (dist).
const FONT_PATH = fileURLToPath(new URL('../../../assets/fonts/DejaVuSans.ttf', import.meta.url));

function registerUnicodeFont(doc: PDFKit.PDFDocument): void {
  if (existsSync(FONT_PATH)) {
    doc.registerFont('cert', FONT_PATH);
    doc.font('cert');
  } else {
    // Фолбэк: без шрифта кириллица не отрендерится, но PDF не упадёт.
    logger.warn({ FONT_PATH }, 'Unicode-шрифт сертификата не найден — кириллица может не отрендериться');
  }
}

/**
 * Генерация PDF-сертификата (FR-9.2): имя студента, название курса, язык, дата, серийный номер.
 * Возвращает поток PDF (пишется в reply).
 */
export async function buildCertificatePdf(enrollmentId: string): Promise<{ stream: PDFKit.PDFDocument; serialNumber: string; filename: string } | null> {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { user: true, languageVersion: true, certificate: true },
  });
  if (!enrollment || !enrollment.certificate) return null;

  const lang = (enrollment.languageVersion.language as Language) ?? 'ru';
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 60 });

  // FR-9.2: встроенный Unicode-шрифт с кириллицей и казахскими глифами (әғқңөұүһі).
  // По умолчанию PDFKit использует Helvetica (WinAnsi) — имена и названия на ru/kk
  // (основная аудитория РК) не отрендерились бы. DejaVu Sans — открытая лицензия.
  registerUnicodeFont(doc);

  // Рамка
  doc.lineWidth(3).strokeColor('#4f46e5').rect(30, 30, doc.page.width - 60, doc.page.height - 60).stroke();
  doc.lineWidth(1).strokeColor('#a5b4fc').rect(42, 42, doc.page.width - 84, doc.page.height - 84).stroke();

  doc.moveDown(2);
  doc.fillColor('#4f46e5').fontSize(40).text(L10N.title[lang], { align: 'center' });
  doc.moveDown(0.4);
  doc.fillColor('#334155').fontSize(14).text(L10N.subtitle[lang], { align: 'center' });
  doc.moveDown(1.5);
  doc.fillColor('#0f172a').fontSize(30).text(enrollment.user.name, { align: 'center' });
  doc.moveDown(0.6);
  doc.fillColor('#1e293b').fontSize(20).text(enrollment.languageVersion.title, { align: 'center' });
  doc.moveDown(2);

  const issued = enrollment.certificate.issuedAt;
  const dateStr = issued.toLocaleDateString(lang === 'en' ? 'en-GB' : lang === 'kk' ? 'kk-KZ' : 'ru-RU');
  doc.fontSize(12).fillColor('#475569');
  doc.text(`${L10N.language[lang]}: ${LANGUAGE_LABELS[lang]}`, { align: 'center' });
  doc.text(`${L10N.date[lang]}: ${dateStr}`, { align: 'center' });
  doc.text(`${L10N.serial[lang]}: ${enrollment.certificate.serialNumber}`, { align: 'center' });

  // Хеш содержимого для контроля целостности — детерминирован, считаем ОДИН раз (L7).
  if (!enrollment.certificate.hash) {
    const hash = createHash('sha256')
      .update(`${enrollment.user.name}|${enrollment.languageVersion.title}|${enrollment.certificate.serialNumber}`)
      .digest('hex')
      .slice(0, 16);
    await prisma.certificate.update({ where: { enrollmentId }, data: { hash } });
  }

  doc.end();
  return { stream: doc, serialNumber: enrollment.certificate.serialNumber, filename: `certificate-${enrollment.certificate.serialNumber}.pdf` };
}
