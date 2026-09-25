import { z } from 'zod';
import {
  LANGUAGES,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  Role,
  USER_NAME_MAX_LENGTH,
  USER_NAME_MIN_LENGTH,
} from '@edu/shared';

/**
 * Самостоятельная регистрация студента (POST /auth/register).
 * Чистые функции без БД — покрыты unit-тестами (register.test.ts).
 */

/** Политика пароля — общая с POST /auth/password/change (FR-1.7). */
export const passwordPolicy = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

// Управляющие символы (переводы строк, NUL и т. п.) в ФИО не допускаем:
// имя попадает в PDF-сертификат, выгрузки и письма.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Входные данные регистрации. Неизвестные поля (role, cohortId, isActive,
 * mustChangePassword, passwordHash…) Zod ОТБРАСЫВАЕТ, а данные для БД строятся
 * только из белого списка (buildStudentCreateData) — массового присвоения нет.
 */
export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(USER_NAME_MIN_LENGTH)
    .max(USER_NAME_MAX_LENGTH)
    .refine((s) => !CONTROL_CHARS.test(s), { message: 'Недопустимые символы в имени' }),
  email: z.string().trim().toLowerCase().max(254).email(),
  password: passwordPolicy,
  interfaceLanguage: z.enum(LANGUAGES).optional(),
});
export type RegisterInput = z.output<typeof registerSchema>;

/**
 * Данные создаваемого пользователя: всегда STUDENT, активен, без когорты
 * (когорту — плечо эксперимента — назначает админ при одобрении заявки),
 * без принудительной смены пароля (пароль задал сам студент).
 * selfRegisteredAt — метка «email не подтверждён» для админа (очередь заявок).
 */
export function buildStudentCreateData(input: RegisterInput, passwordHash: string, now: Date = new Date()) {
  return {
    email: input.email,
    name: input.name,
    passwordHash,
    role: Role.STUDENT,
    interfaceLanguage: input.interfaceLanguage ?? 'ru',
    isActive: true,
    mustChangePassword: false,
    cohortId: null,
    selfRegisteredAt: now,
  };
}
