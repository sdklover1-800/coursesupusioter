/**
 * @edu/shared — единый источник контрактов между backend и frontend.
 * Доменные перечисления, константы, схемы структурированного вывода LLM.
 */
export * from './enums.js';
export * from './events.js';
export * from './constants.js';
export * from './llm-schemas.js';

/** Стандартный конверт ошибки API (единый формат) */
export interface ApiError {
  error: {
    code: string;
    message: string;
    /** Детали валидации (Zod) при 422 */
    details?: unknown;
    /** Идентификатор запроса для корреляции логов (NFR-5.1) */
    requestId?: string;
  };
}

/** Публичное представление пользователя (без passwordHash) */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: import('./enums.js').Role;
  interfaceLanguage: import('./enums.js').Language;
  cohortId: string | null;
  researchConsentAt: string | null;
  researchConsentVersion: string | null;
}
