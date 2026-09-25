import { describe, it, expect } from 'vitest';
import { isTestAccountEmail } from './testAccounts.js';

describe('isTestAccountEmail (тестовые аккаунты не попадают в выгрузку)', () => {
  it('зарезервированные домены и зоны — тестовые', () => {
    for (const e of [
      'qa-v-jsr-1@example.com',
      'reg-test-1790328137-x@EXAMPLE.COM',
      'a@example.org',
      'b@mail.example.net',
      'c@school.test',
      'd@x.invalid',
      'e@host.localhost',
      'f@demo.example',
    ]) {
      expect(isTestAccountEmail(e), e).toBe(true);
    }
  });

  it('обычные адреса студентов и сотрудников — не тестовые', () => {
    for (const e of ['student@edu.kz', 'ai@esil.edu.kz', 'user@gmail.com', 'x@contest.kz', 'y@example.com.kz', 'z@latest.io', 'w@myexample.com']) {
      expect(isTestAccountEmail(e), e).toBe(false);
    }
  });
});
