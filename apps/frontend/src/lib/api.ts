/**
 * HTTP-клиент: access-токен в памяти, refresh через httpOnly-cookie (FR-1.6).
 * Единый разбор конверта ошибок { error: { code, message } }.
 */

let accessToken: string | null = null;
export function setAccessToken(token: string | null): void {
  accessToken = token;
}
export function getAccessToken(): string | null {
  return accessToken;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** не пытаться обновить токен (для самого refresh) */
  skipRefresh?: boolean;
  signal?: AbortSignal;
  raw?: boolean; // вернуть Response (для файлов)
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`/api${path}`, {
    method: opts.method ?? 'GET',
    headers,
    credentials: 'include',
    signal: opts.signal,
    body: opts.body === undefined ? undefined : opts.body instanceof FormData ? opts.body : JSON.stringify(opts.body),
  });

  // Прозрачное обновление истёкшего access-токена (один раз)
  if (res.status === 401 && !opts.skipRefresh) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, { ...opts, skipRefresh: true });
  }

  if (opts.raw) {
    if (!res.ok) await throwFromResponse(res);
    return res as unknown as T;
  }

  if (!res.ok) await throwFromResponse(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function throwFromResponse(res: Response): Promise<never> {
  let code = 'ERROR';
  let message = res.statusText;
  let details: unknown;
  try {
    const data = await res.json();
    code = data?.error?.code ?? code;
    message = data?.error?.message ?? message;
    details = data?.error?.details;
  } catch {
    /* not json */
  }
  throw new ApiError(res.status, code, message, details);
}

let refreshPromise: Promise<boolean> | null = null;
async function tryRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
        if (!res.ok) return false;
        const data = (await res.json()) as { accessToken: string };
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
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
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
 */
export interface SseHandlers {
  onDelta?: (text: string) => void;
  onDone?: (result: unknown) => void;
  onError?: (err: { code: string; message: string; recoverable?: boolean }) => void;
  onOpen?: () => void;
  onWaiting?: () => void; // §5.7f: модель отвечает дольше обычного
}

export async function postSse(path: string, body: unknown, handlers: SseHandlers, signal?: AbortSignal): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let res = await fetch(`/api${path}`, { method: 'POST', headers, credentials: 'include', body: JSON.stringify(body), signal });
  if (res.status === 401) {
    if (await tryRefresh()) {
      headers.Authorization = `Bearer ${accessToken}`;
      res = await fetch(`/api${path}`, { method: 'POST', headers, credentials: 'include', body: JSON.stringify(body), signal });
    }
  }
  if (!res.ok || !res.body) {
    // L9: без хардкода строки — помечаем recoverable, локализованный текст даёт UI.
    handlers.onError?.({ code: 'HTTP_' + res.status, message: `stream start failed (${res.status})`, recoverable: true });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const evLine = chunk.split('\n').find((l) => l.startsWith('event:'));
      const dataLine = chunk.split('\n').find((l) => l.startsWith('data:'));
      if (!evLine || !dataLine) continue;
      const event = evLine.slice(6).trim();
      const data = JSON.parse(dataLine.slice(5).trim());
      if (event === 'open') handlers.onOpen?.();
      else if (event === 'waiting') handlers.onWaiting?.();
      else if (event === 'delta') handlers.onDelta?.(data.text);
      else if (event === 'done') handlers.onDone?.(data);
      else if (event === 'error') handlers.onError?.(data);
    }
  }
}
