import { describe, it, expect } from 'vitest';
import { registerSchema, buildStudentCreateData, passwordPolicy } from './register.js';

const valid = { name: '  Айгерим Нурланова ', email: '  New.User@Example.COM ', password: 'secret123' };

describe('registerSchema', () => {
  it('нормализует ФИО (trim) и email (trim + нижний регистр)', () => {
    const r = registerSchema.parse(valid);
    expect(r.name).toBe('Айгерим Нурланова');
    expect(r.email).toBe('new.user@example.com');
    expect(r.interfaceLanguage).toBeUndefined();
  });

  it('лишние поля (роль, когорта, активность, хеш) отбрасываются — нет массового присвоения', () => {
    const r = registerSchema.parse({
      ...valid,
      role: 'ADMIN',
      cohortId: 'c1',
      isActive: false,
      mustChangePassword: true,
      passwordHash: 'x',
      researchConsentAt: '2026-01-01',
    });
    expect(Object.keys(r).sort()).toEqual(['email', 'name', 'password']);
  });

  it('язык интерфейса — только из перечня', () => {
    expect(registerSchema.parse({ ...valid, interfaceLanguage: 'kk' }).interfaceLanguage).toBe('kk');
    expect(registerSchema.safeParse({ ...valid, interfaceLanguage: 'de' }).success).toBe(false);
  });

  it('ФИО: 2..100 символов после trim, без управляющих символов', () => {
    expect(registerSchema.safeParse({ ...valid, name: ' A ' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, name: 'A'.repeat(101) }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, name: 'Иван\nПетров' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, name: 'Ли' }).success).toBe(true);
  });

  it('некорректный email отклоняется', () => {
    expect(registerSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
  });

  it('пароль — та же политика, что при смене пароля (8..128)', () => {
    expect(registerSchema.safeParse({ ...valid, password: '1234567' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, password: '12345678' }).success).toBe(true);
    expect(passwordPolicy.safeParse('x'.repeat(129)).success).toBe(false);
  });
});

describe('buildStudentCreateData', () => {
  it('всегда STUDENT, активен, без когорты, без принудительной смены пароля, с меткой саморегистрации', () => {
    const input = registerSchema.parse({ ...valid, role: 'ADMIN', cohortId: 'c1', isActive: false, selfRegisteredAt: null });
    const now = new Date('2026-09-25T10:00:00Z');
    const data = buildStudentCreateData(input, 'HASH', now);
    expect(data).toEqual({
      email: 'new.user@example.com',
      name: 'Айгерим Нурланова',
      passwordHash: 'HASH',
      role: 'STUDENT',
      interfaceLanguage: 'ru',
      isActive: true,
      mustChangePassword: false,
      cohortId: null,
      selfRegisteredAt: now,
    });
  });

  it('открытый пароль в данные для БД не попадает', () => {
    const data = buildStudentCreateData(registerSchema.parse(valid), 'HASH');
    expect(JSON.stringify(data)).not.toContain('secret123');
  });
});
