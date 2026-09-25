import { describe, it, expect } from 'vitest';
import { EnrollmentStatus } from '@edu/shared';
import {
  isAdmitted,
  contentAccessDenial,
  decideSelfRequest,
  canApprove,
  canReject,
  canCancel,
  cancelAction,
  languageSwitchDecision,
  decideManagerEnroll,
  requestListWhere,
  requestListOrder,
  decideCohortOnApprove,
} from './policy.js';

const ALL = Object.values(EnrollmentStatus);

describe('доступ к контенту по статусу записи', () => {
  it('контент открыт только для ACTIVE и COMPLETED', () => {
    expect(ALL.filter(isAdmitted).sort()).toEqual(['ACTIVE', 'COMPLETED']);
  });

  it('ACTIVE/COMPLETED — без отказа', () => {
    expect(contentAccessDenial('ACTIVE')).toBeNull();
    expect(contentAccessDenial('COMPLETED')).toBeNull();
  });

  it('PENDING/REJECTED/WITHDRAWN — отказ с понятным текстом', () => {
    expect(contentAccessDenial('PENDING')).toBe('Заявка на курс ещё не одобрена');
    expect(contentAccessDenial('REJECTED')).toBe('Заявка на курс отклонена');
    expect(contentAccessDenial('WITHDRAWN')).toBe('Запись на курс отменена');
  });

  it('неизвестный статус — отказ (fail-closed)', () => {
    expect(contentAccessDenial('SOMETHING_NEW' as EnrollmentStatus)).not.toBeNull();
  });
});

describe('повторная подача заявки студентом', () => {
  it('нет записи → создать PENDING', () => {
    expect(decideSelfRequest(null)).toEqual({ action: 'create' });
  });
  it('уже на рассмотрении → вернуть существующую', () => {
    expect(decideSelfRequest('PENDING')).toEqual({ action: 'keep-pending' });
  });
  it('отклонена или отменена → открыть заново', () => {
    expect(decideSelfRequest('REJECTED')).toEqual({ action: 'reopen' });
    expect(decideSelfRequest('WITHDRAWN')).toEqual({ action: 'reopen' });
  });
  it('уже допущен к курсу → конфликт', () => {
    expect(decideSelfRequest('ACTIVE').action).toBe('conflict');
    expect(decideSelfRequest('COMPLETED').action).toBe('conflict');
  });
});

describe('рассмотрение заявки', () => {
  it('одобрить можно PENDING и REJECTED', () => {
    expect(ALL.filter(canApprove).sort()).toEqual(['PENDING', 'REJECTED']);
  });
  it('отклонить и отменить можно только PENDING', () => {
    expect(ALL.filter(canReject)).toEqual(['PENDING']);
    expect(ALL.filter(canCancel)).toEqual(['PENDING']);
  });
  it('отмена без истории удаляет строку, с историей — не удаляет (исследовательские данные)', () => {
    expect(cancelAction(false)).toBe('delete');
    expect(cancelAction(true)).toBe('withdraw');
  });
});

describe('смена языка прохождения', () => {
  it('разрешена для заявки на рассмотрении и активного курса', () => {
    expect(languageSwitchDecision('PENDING')).toBe('allow');
    expect(languageSwitchDecision('ACTIVE')).toBe('allow');
  });
  it('завершённый курс — отдельный отказ', () => {
    expect(languageSwitchDecision('COMPLETED')).toBe('completed');
  });
  it('отклонённая/отменённая — нет доступа', () => {
    expect(languageSwitchDecision('REJECTED')).toBe('not-approved');
    expect(languageSwitchDecision('WITHDRAWN')).toBe('not-approved');
  });
});

describe('прямая запись менеджером', () => {
  it('нет записи → создать', () => {
    expect(decideManagerEnroll(null)).toBe('create');
  });
  it('заявка PENDING/REJECTED → превратить в активную запись', () => {
    expect(decideManagerEnroll('PENDING')).toBe('convert');
    expect(decideManagerEnroll('REJECTED')).toBe('convert');
  });
  it('уже записан/завершил/отчислен → конфликт', () => {
    expect(decideManagerEnroll('ACTIVE')).toBe('conflict');
    expect(decideManagerEnroll('COMPLETED')).toBe('conflict');
    expect(decideManagerEnroll('WITHDRAWN')).toBe('conflict');
  });
});

describe('очередь заявок', () => {
  it('фильтр по статусу и курсу; заявки деактивированных аккаунтов скрыты', () => {
    expect(requestListWhere('PENDING')).toEqual({ status: 'PENDING', user: { isActive: true } });
    expect(requestListWhere('REJECTED', 'c1')).toEqual({ status: 'REJECTED', user: { isActive: true }, courseId: 'c1' });
  });
  it('«Все» — только пришедшие заявкой либо PENDING/REJECTED (прямые записи не попадают)', () => {
    expect(requestListWhere('ALL')).toEqual({
      OR: [{ requestedAt: { not: null } }, { status: { in: ['PENDING', 'REJECTED'] } }],
      user: { isActive: true },
    });
  });
  it('ожидающие — FIFO, остальные — свежие сверху', () => {
    expect(requestListOrder('PENDING')[0]).toEqual({ requestedAt: { sort: 'asc', nulls: 'first' } });
    expect(requestListOrder('ALL')[0]).toEqual({ requestedAt: { sort: 'desc', nulls: 'last' } });
  });
});

describe('когорта при одобрении заявки', () => {
  const base = { requested: 'AI', current: null, actorRole: 'COURSE_MANAGER' as const, hasAdmittedEnrollments: false };

  it('когорта не передана или совпадает с текущей — не меняем', () => {
    expect(decideCohortOnApprove({ ...base, requested: undefined }).action).toBe('keep');
    expect(decideCohortOnApprove({ ...base, current: 'AI', hasAdmittedEnrollments: true }).action).toBe('keep');
  });

  it('у студента нет когорты — назначает и менеджер, и админ', () => {
    expect(decideCohortOnApprove(base).action).toBe('assign');
    expect(decideCohortOnApprove({ ...base, actorRole: 'ADMIN' }).action).toBe('assign');
  });

  it('менеджер не может сменить уже назначенную группу (403)', () => {
    expect(decideCohortOnApprove({ ...base, current: 'TEACHER' }).action).toBe('forbidden');
    expect(decideCohortOnApprove({ ...base, current: 'TEACHER', hasAdmittedEnrollments: true }).action).toBe('forbidden');
  });

  it('админ меняет группу только до начала обучения на других курсах', () => {
    expect(decideCohortOnApprove({ ...base, actorRole: 'ADMIN', current: 'TEACHER' }).action).toBe('assign');
    expect(decideCohortOnApprove({ ...base, actorRole: 'ADMIN', current: 'TEACHER', hasAdmittedEnrollments: true }).action).toBe('conflict');
  });
});
