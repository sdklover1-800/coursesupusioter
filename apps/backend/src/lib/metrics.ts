import client from 'prom-client';

/**
 * Операционные метрики (NFR-5.2): нагрузка, ошибки, расход токенов LLM.
 * Формат Prometheus; эндпоинт /metrics (в проде ограничить на сетевом уровне).
 */
export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const httpDuration = new client.Histogram({
  name: 'http_request_duration_ms',
  help: 'Длительность HTTP-запросов, мс',
  labelNames: ['method', 'route', 'status'],
  buckets: [5, 15, 30, 50, 100, 200, 500, 1000, 3000],
  registers: [registry],
});

export const httpErrors = new client.Counter({
  name: 'http_errors_total',
  help: 'Число ответов со статусом >= 500',
  labelNames: ['route'],
  registers: [registry],
});

export const llmTokens = new client.Counter({
  name: 'llm_tokens_total',
  help: 'Суммарный расход токенов LLM',
  labelNames: ['direction', 'provider'], // input|output
  registers: [registry],
});

export const llmCalls = new client.Counter({
  name: 'llm_calls_total',
  help: 'Число вызовов LLM',
  labelNames: ['provider', 'label', 'outcome'], // ok|error
  registers: [registry],
});
