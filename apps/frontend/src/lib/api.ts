/**
 * HTTP-клиент: access-токен в памяти, refresh через httpOnly-cookie (FR-1.6).
 * Единый разбор конверта ошибок { error: { code, message, details, requestId } } → ApiError(.code).
 */

let accessToken: string | null = null;
export function setAccessToken(token: string | null): void {
  accessToken = token;
}
export function getAccessToken(): string | null {
  return accessToken;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    /** Код из конверта ошибки (ApiErrorCode из @edu/shared) или 'ERROR' */
    public code: string,
    message: string,
    public details?: unknown,
    public requestId?: string,
  ) {
    super(message);
  }
}

/**
 * Глобальные реакции на ответы API (регистрирует lib/auth.tsx):
 * onAuthLost — refresh не удался у вошедшего пользователя (сессия истекла);
 * onGateError — 403 PASSWORD_CHANGE_REQUIRED / CONSENT_REQUIRED (гейты доступа).
 */
export interface ApiListeners {
  onAuthLost?: () => void;
  onGateError?: (code: string) => void;
}
let listeners: ApiListeners = {};
export function setApiListeners(l: ApiListeners): void {
  listeners = l;
}
const GATE_CODES = new Set(['PASSWORD_CHANGE_REQUIRED', 'CONSENT_REQUIRED']);

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** не пытаться обновить токен (для самого refresh) */
  skipRefresh?: boolean;
  signal?: AbortSignal;
  raw?: boolean; // вернуть Response (для файлов)
  /** fetch keepalive — запрос переживает уход со страницы (FE2: сохранение позиции при размонтировании) */
  keepalive?: boolean;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const hadToken = !!accessToken;
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`/api${path}`, {
    method: opts.method ?? 'GET',
    headers,
    credentials: 'include',
    signal: opts.signal,
    keepalive: opts.keepalive,
    body: opts.body === undefined ? undefined : opts.body instanceof FormData ? opts.body : JSON.stringify(opts.body),
  });

  // Прозрачное обновление истёкшего access-токена (один раз)
  if (res.status === 401 && !opts.skipRefresh) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, { ...opts, skipRefresh: true });
    // Сессия была, но обновить её не удалось → «Сессия истекла» (auth.tsx)
    if (hadToken) listeners.onAuthLost?.();
  }

  if (!res.ok) await throwFromResponse(res);
  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  // 202/200 с пустым телом (например, POST /auth/register) — не падаем на JSON.parse
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function throwFromResponse(res: Response): Promise<never> {
  let code = 'ERROR';
  let message = res.statusText;
  let details: unknown;
  let requestId: string | undefined;
  try {
    const data = await res.json();
    code = data?.error?.code ?? code;
    message = data?.error?.message ?? message;
    details = data?.error?.details;
    requestId = data?.error?.requestId;
  } catch {
    /* not json */
  }
  if (res.status === 403 && GATE_CODES.has(code)) listeners.onGateError?.(code);
  throw new ApiError(res.status, code, message, details, requestId);
}

let refreshPromise: Promise<boolean> | null = null;
async function tryRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
        // «Сессии нет» может прийти и без ошибки (204 или 200 без accessToken) — это тоже не вход
        if (!res.ok || res.status === 204) return false;
        const data = (await res.json()) as { accessToken?: unknown };
        if (typeof data.accessToken !== 'string' || !data.accessToken) return false;
        setAccessToken(data.accessToken);
        return true;
      } catch {
        return false;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { method: 'GET', signal }),
  post: <T>(path: string, body?: unknown, opts?: { keepalive?: boolean }) =>
    request<T>(path, { method: 'POST', body, keepalive: opts?.keepalive }),
  /** keepalive: true — для сохранения при уходе со страницы (unmount/visibilitychange) */
  patch: <T>(path: string, body?: unknown, opts?: { keepalive?: boolean }) =>
    request<T>(path, { method: 'PATCH', body, keepalive: opts?.keepalive }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  postForm: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
  /** Скачивание файла (PDF/CSV) с авторизацией. */
  download: async (path: string, filename: string) => {
    const res = await request<Response>(path, { raw: true });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
  tryRefresh,
};

/**
 * SSE-поток для сократического чата (§11.3). Отправляет POST и читает
 * event-stream вручную (fetch + ReadableStream), т.к. EventSource не умеет POST.
 * Каждое событие сначала уходит в onEvent(name, data), затем в именной обработчик.
 */
export interface SseHandlers {
  /** Любое событие потока (catch-all), в т.ч. будущие/неизвестные */
  onEvent?: (name: string, data: unknown) => void;
  onDelta?: (text: string) => void;
  /** Полная полезная нагрузка 'done' (FE4 сужает до TurnDone из @edu/shared) */
  onDone?: (payload: unknown) => void;
  onError?: (err: { code: string; message: string; recoverable?: boolean }) => void;
  onOpen?: () => void;
  onWaiting?: () => void; // §5.7f: сервер «думает» дольше обычного
}

export async function postSse(path: string, body: unknown, handlers: SseHandlers, signal?: AbortSignal): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const hadToken = !!accessToken;
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let res = await fetch(`/api${path}`, { method: 'POST', headers, credentials: 'include', body: JSON.stringify(body), signal });
  if (res.status === 401) {
    if (await tryRefresh()) {
      headers.Authorization = `Bearer ${accessToken}`;
      res = await fetch(`/api${path}`, { method: 'POST', headers, credentials: 'include', body: JSON.stringify(body), signal });
    } else if (hadToken) {
      listeners.onAuthLost?.();
    }
  }
  if (!res.ok || !res.body) {
    // Конверт ошибки (409 и т.п.) — отдаём код сервера; иначе L9: без хардкода строки,
    // помечаем recoverable, локализованный текст даёт UI.
    let code = 'HTTP_' + res.status;
    let message = `stream start failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error?.code) code = data.error.code;
      if (data?.error?.message) message = data.error.message;
    } catch {
      /* не JSON */
    }
    if (res.status === 403 && GATE_CODES.has(code)) listeners.onGateError?.(code);
    handlers.onError?.({ code, message, recoverable: res.status >= 500 || res.status === 0 || code.startsWith('HTTP_') });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const dispatch = (chunk: string) => {
    const lines = chunk.split('\n');
    const evLine = lines.find((l) => l.startsWith('event:'));
    const dataLines = lines.filter((l) => l.startsWith('data:'));
    if (!evLine || !dataLines.length) return;
    const event = evLine.slice(6).trim();
    let data: unknown;
    try {
      // Многострочные data: склеиваются через \n (спецификация SSE)
      data = JSON.parse(dataLines.map((l) => l.slice(5).replace(/^ /, '')).join('\n'));
    } catch {
      return;
    }
    handlers.onEvent?.(event, data);
    const d = data as { text?: string } & { code: string; message: string; recoverable?: boolean };
    if (event === 'open') handlers.onOpen?.();
    else if (event === 'waiting') handlers.onWaiting?.();
    else if (event === 'delta') handlers.onDelta?.(d.text ?? '');
    else if (event === 'done') handlers.onDone?.(data);
    else if (event === 'error') handlers.onError?.(d);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) dispatch(chunk);
  }
  if (buffer.trim()) dispatch(buffer);
}
