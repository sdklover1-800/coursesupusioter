/**
 * Простой семафор для ограничения параллелизма вызовов LLM (NFR-1.5).
 * Число одновременных активных вызовов определяет нагрузку и стоимость.
 */
export class Semaphore {
  private available: number;
  private queue: Array<() => void> = [];

  constructor(max: number) {
    this.available = Math.max(1, max);
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.available--;
  }

  release(): void {
    this.available++;
    const next = this.queue.shift();
    if (next) next();
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
