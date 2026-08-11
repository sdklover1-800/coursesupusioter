/** Типизированные ошибки приложения с HTTP-статусами и кодами. */
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  unauthorized: (msg = 'Не авторизован') => new AppError(401, 'UNAUTHORIZED', msg),
  forbidden: (msg = 'Недостаточно прав') => new AppError(403, 'FORBIDDEN', msg),
  notFound: (msg = 'Не найдено') => new AppError(404, 'NOT_FOUND', msg),
  conflict: (msg = 'Конфликт') => new AppError(409, 'CONFLICT', msg),
  validation: (msg = 'Ошибка валидации', details?: unknown) => new AppError(422, 'VALIDATION', msg, details),
  badRequest: (msg = 'Некорректный запрос', details?: unknown) => new AppError(400, 'BAD_REQUEST', msg, details),
  tooManyRequests: (msg = 'Слишком много запросов') => new AppError(429, 'TOO_MANY_REQUESTS', msg),
  upstream: (msg = 'Внешний сервис недоступен') => new AppError(503, 'UPSTREAM_UNAVAILABLE', msg),
  internal: (msg = 'Внутренняя ошибка') => new AppError(500, 'INTERNAL', msg),
};
