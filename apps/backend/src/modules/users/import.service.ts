import { parse as parseCsv } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { LANGUAGES, type Language } from '@edu/shared';
import { prisma } from '../../lib/prisma.js';
import { hashPassword, generateStartPassword } from '../../lib/password.js';

/**
 * Импорт студентов из CSV/Excel (FR-1.3, Приложение A).
 * Валидация строк, предпросмотр, отчёт об ошибках, частичное применение.
 */

export interface ImportRow {
  rowNumber: number;
  email?: string;
  name?: string;
  interface_language?: string;
  cohort?: string;
}

export interface ImportRowResult {
  rowNumber: number;
  email: string;
  name: string;
  status: 'ok' | 'error';
  errors: string[];
  startPassword?: string; // возвращается только при apply
}

export interface ImportReport {
  total: number;
  valid: number;
  invalid: number;
  results: ImportRowResult[];
}

const rowSchema = z.object({
  email: z.string().trim().toLowerCase().email('Некорректный email'),
  name: z.string().trim().min(1, 'Пустое имя'),
  interface_language: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || (LANGUAGES as readonly string[]).includes(v), 'Неизвестный язык интерфейса'),
  cohort: z.string().trim().optional(),
});

/** Разбор файла (по mime/расширению) в массив строк. */
export function parseImportFile(buffer: Buffer, filename: string): ImportRow[] {
  const lower = filename.toLowerCase();
  let records: Record<string, string>[];
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames[0];
    const sheet = sheetName ? wb.Sheets[sheetName] : undefined;
    if (!sheet) return [];
    records = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' });
  } else {
    records = parseCsv(buffer, { columns: true, skip_empty_lines: true, trim: true, bom: true });
  }
  return records.map((r, i) => ({
    rowNumber: i + 2, // +2: строка 1 — заголовки
    email: r.email,
    name: r.name,
    interface_language: r.interface_language,
    cohort: r.cohort,
  }));
}

/**
 * Валидация строк с учётом дублей внутри файла и с существующими пользователями,
 * проверки существования когорты (Приложение A).
 * @param apply если true — валидные строки создаются в БД (частичное применение).
 */
export async function validateAndMaybeApply(
  rows: ImportRow[],
  defaultLanguage: Language,
  apply: boolean,
): Promise<ImportReport> {
  const results: ImportRowResult[] = [];
  const seenEmails = new Set<string>();

  // Предзагрузка существующих email и когорт
  const emails = rows.map((r) => (r.email ?? '').trim().toLowerCase()).filter(Boolean);
  const existing = await prisma.user.findMany({ where: { email: { in: emails } }, select: { email: true } });
  const existingEmails = new Set(existing.map((u) => u.email));
  const cohorts = await prisma.cohort.findMany({ select: { id: true, name: true } });
  const cohortByName = new Map(cohorts.map((c) => [c.name, c.id]));

  for (const row of rows) {
    const errors: string[] = [];
    const parsed = rowSchema.safeParse(row);
    const email = (row.email ?? '').trim().toLowerCase();
    const name = (row.name ?? '').trim();

    if (!parsed.success) {
      for (const issue of parsed.error.issues) errors.push(issue.message);
    } else {
      if (seenEmails.has(parsed.data.email)) errors.push('Дубль email внутри файла');
      if (existingEmails.has(parsed.data.email)) errors.push('Email уже существует в системе');
      if (parsed.data.cohort && !cohortByName.has(parsed.data.cohort)) errors.push(`Когорта «${parsed.data.cohort}» не найдена`);
      seenEmails.add(parsed.data.email);
    }

    const status = errors.length === 0 ? 'ok' : 'error';
    const result: ImportRowResult = { rowNumber: row.rowNumber, email, name, status, errors };

    if (status === 'ok' && apply && parsed.success) {
      const startPassword = generateStartPassword();
      const cohortId = parsed.data.cohort ? cohortByName.get(parsed.data.cohort) ?? null : null;
      await prisma.user.create({
        data: {
          email: parsed.data.email,
          name: parsed.data.name,
          role: 'STUDENT',
          interfaceLanguage: parsed.data.interface_language ?? defaultLanguage,
          cohortId,
          passwordHash: await hashPassword(startPassword),
          mustChangePassword: true,
        },
      });
      result.startPassword = startPassword; // FR-1.4 — показывается администратору один раз
    }

    results.push(result);
  }

  const valid = results.filter((r) => r.status === 'ok').length;
  return { total: rows.length, valid, invalid: rows.length - valid, results };
}
