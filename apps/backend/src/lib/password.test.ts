import { describe, it, expect, vi } from 'vitest';
import argon2 from 'argon2';
import { hashPassword, verifyPasswordConstantTime } from './password.js';

describe('verifyPasswordConstantTime (вход без утечки существования email по времени)', () => {
  it('верный пароль к настоящему хешу — true, неверный — false', async () => {
    const hash = await hashPassword('Secret123');
    expect(await verifyPasswordConstantTime(hash, 'Secret123')).toBe(true);
    expect(await verifyPasswordConstantTime(hash, 'WrongPass123')).toBe(false);
  });

  it('нет пользователя — всегда false, но argon2 всё равно выполняется (та же стоимость)', async () => {
    const spy = vi.spyOn(argon2, 'verify');
    expect(await verifyPasswordConstantTime(null, 'WrongPass123')).toBe(false);
    expect(await verifyPasswordConstantTime(undefined, '')).toBe(false);
    expect(spy).toHaveBeenCalledTimes(2);
    const [dummy] = spy.mock.calls[0]!;
    expect(String(dummy)).toMatch(/^\$argon2id\$/);
    spy.mockRestore();
  });
});
