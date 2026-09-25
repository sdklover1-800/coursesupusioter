import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { Prisma } from '@prisma/client';
import { customAlphabet } from 'nanoid';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';
import { logEvent } from '../../telemetry/events.js';
import { EventType, LANGUAGES, LANGUAGE_LABELS, type Language } from '@edu/shared';

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
  date: { kk: 'Берілген күні', ru: 'Дата выдачи', en: 'Date of issue' },
  serial: { kk: 'Сериялық нөмір', ru: 'Серийный номер', en: 'Serial number' },
  verify: { kk: 'Түпнұсқалығын тексеру', ru: 'Проверить подлинность', en: 'Verify authenticity' },
} as const;

/** Локаль даты сертификата по языку курса. */
const DATE_LOCALE: Record<Language, string> = { kk: 'kk-KZ', ru: 'ru-RU', en: 'en-GB' };

/** Дата выдачи прописью на языке курса (Intl): «25 сентября 2026 г.», «2026 ж. 25 қыркүйек». */
export function formatIssueDate(date: Date, lang: Language): string {
  return new Intl.DateTimeFormat(DATE_LOCALE[lang] ?? 'ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Almaty' }).format(date);
}

/** Публичная ссылка проверки сертификата (страница /verify/:serial фронтенда). */
export function verifyUrl(serialNumber: string): string {
  return `${env.PUBLIC_APP_URL.replace(/\/+$/, '')}/verify/${encodeURIComponent(serialNumber)}`;
}

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

// Палитра Inquiry: ink (рамка, текст), brand (акцент), spark (линия под именем).
const INK = '#16182B';
const BRAND = '#5B54E0';
const BRAND_SOFT = '#C7C4F6';
const SPARK = '#F2B441';
const MUTED = '#4B5068';

/**
 * Генерация PDF-сертификата (FR-9.2): имя студента, название курса, язык, дата,
 * серийный номер, QR-код и печатная ссылка на публичную проверку (/verify/:serial).
 * Возвращает поток PDF (пишется в reply). null — сертификат не выдан.
 */
export async function buildCertificatePdf(enrollmentId: string): Promise<{ stream: PDFKit.PDFDocument; serialNumber: string; filename: string } | null> {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { user: true, languageVersion: true, certificate: true },
  });
  if (!enrollment || !enrollment.certificate) return null;

  const lang: Language = (LANGUAGES as readonly string[]).includes(enrollment.languageVersion.language)
    ? (enrollment.languageVersion.language as Language)
    : 'ru';
  const serial = enrollment.certificate.serialNumber;
  const url = verifyUrl(serial);
  // QR генерируется до создания документа: ошибка не оставит полузаписанный поток.
  const qr = await QRCode.toBuffer(url, { errorCorrectionLevel: 'M', margin: 1, width: 360, color: { dark: INK, light: '#FFFFFF' } });

  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 60, info: { Title: `${L10N.title[lang]} ${serial}`, Author: env.CERT_ISSUER_NAME } });

  // FR-9.2: встроенный Unicode-шрифт с кириллицей и казахскими глифами (әғқңөұүһі).
  // По умолчанию PDFKit использует Helvetica (WinAnsi) — имена и названия на ru/kk
  // (основная аудитория РК) не отрендерились бы. DejaVu Sans — открытая лицензия.
  registerUnicodeFont(doc);

  const W = doc.page.width;
  const H = doc.page.height;
  const textX = 90;
  const textW = W - 2 * textX;

  // Рамка
  doc.lineWidth(3).strokeColor(INK).rect(30, 30, W - 60, H - 60).stroke();
  doc.lineWidth(1).strokeColor(BRAND_SOFT).rect(42, 42, W - 84, H - 84).stroke();

  // Шапка: эмитент, заголовок, подзаголовок
  let y = 112;
  doc.fillColor(BRAND).fontSize(11).text(env.CERT_ISSUER_NAME.toUpperCase(), textX, y, { width: textW, align: 'center', characterSpacing: 3 });
  y += 26;
  doc.fillColor(INK).fontSize(40).text(L10N.title[lang], textX, y, { width: textW, align: 'center', characterSpacing: 2 });
  y += 58;
  doc.fillColor(MUTED).fontSize(14).text(L10N.subtitle[lang], textX, y, { width: textW, align: 'center' });

  // Имя и курс (длинные названия переносятся — следующий блок сдвигается)
  y += 44;
  doc.fillColor(INK).fontSize(30);
  doc.text(enrollment.user.name, textX, y, { width: textW, align: 'center' });
  y += doc.heightOfString(enrollment.user.name, { width: textW }) + 10;
  doc.lineWidth(2).strokeColor(SPARK).moveTo(W / 2 - 60, y).lineTo(W / 2 + 60, y).stroke();
  y += 18;
  doc.fillColor(INK).fontSize(20);
  doc.text(enrollment.languageVersion.title, textX, y, { width: textW, align: 'center' });

  // Низ: реквизиты слева, QR и ссылка проверки справа
  const qrSize = 92;
  const bottom = H - 74;
  const qrX = W - 74 - qrSize;
  const qrY = bottom - qrSize - 14;
  doc.image(qr, qrX, qrY, { width: qrSize, height: qrSize });
  doc.fillColor(MUTED).fontSize(8).text(L10N.verify[lang], qrX - 150, qrY + qrSize + 4, { width: qrSize + 150, align: 'right' });
  doc.fillColor(BRAND).fontSize(8).text(url, qrX - 250, qrY + qrSize + 15, { width: qrSize + 250, align: 'right', link: url });

  const infoX = 74;
  const issued = enrollment.certificate.issuedAt;
  const rows: [string, string][] = [
    [L10N.language[lang], LANGUAGE_LABELS[lang]],
    [L10N.date[lang], formatIssueDate(issued, lang)],
    [L10N.serial[lang], serial],
  ];
  let infoY = bottom - rows.length * 20 + 4;
  for (const [label, value] of rows) {
    doc.fillColor(MUTED).fontSize(10).text(`${label}: `, infoX, infoY, { continued: true });
    doc.fillColor(INK).fontSize(11).text(value);
    infoY += 20;
  }

  // Хеш содержимого для контроля целостности — детерминирован, считаем ОДИН раз (L7).
  if (!enrollment.certificate.hash) {
    const hash = createHash('sha256')
      .update(`${enrollment.user.name}|${enrollment.languageVersion.title}|${serial}`)
      .digest('hex')
      .slice(0, 16);
    await prisma.certificate.update({ where: { enrollmentId }, data: { hash } });
  }

  doc.end();
  return { stream: doc, serialNumber: serial, filename: `certificate-${serial}.pdf` };
}
