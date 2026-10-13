import { setTimeout as wait } from 'node:timers/promises';
import { AppError } from '../errors';
import { JIRA_ORIGIN } from './urls';
interface Options {
  fetcher?: typeof fetch; now?: () => number; delay?: (ms: number, signal: AbortSignal) => Promise<void>;
  maxBytes?: number; timeoutMs?: number;
}
export class JiraClient {
  private fetcher: typeof fetch;
  private delay: (ms: number, signal: AbortSignal) => Promise<void>;
  constructor(private pat: string, private options: Options = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.delay = options.delay ?? (async (ms, signal) => { await wait(ms, undefined, { signal }); });
  }
  close() { this.pat = ''; }
  async get(path: string, params: Record<string, string>, signal: AbortSignal): Promise<unknown> {
    if (!/^\/rest\/(api\/2|agile\/1\.0)\/[A-Za-z0-9_/-]+$/.test(path) || path.includes('..')) throw new AppError('JIRA_PATH', 'Неподдерживаемый путь Jira API.');
    const url = new URL(path, JIRA_ORIGIN);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    if (!this.pat) throw new AppError('JIRA_UNAUTHORIZED', 'Контекст доступа Jira завершён.');
    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal.aborted) throw new AppError('ABORTED', 'Операция остановлена.');
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(this.options.timeoutMs ?? 20_000)]);
      let retryMs = 500 * 2 ** attempt;
      try {
        const response = await this.fetcher(url, { method: 'GET', redirect: 'manual', signal: requestSignal, headers: { Authorization: `Bearer ${this.pat}`, Accept: 'application/json' } });
        if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new AppError('JIRA_REDIRECT', 'Jira перенаправила запрос. Доступ не передан по перенаправлению.'); }
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 401) throw new AppError('JIRA_UNAUTHORIZED', 'Jira не приняла PAT.', 401);
          if (response.status === 403) throw new AppError('JIRA_FORBIDDEN', 'Недостаточно прав на чтение объекта Jira.', 403);
          if (response.status === 404) throw new AppError('JIRA_NOT_FOUND', 'Объект не найден или недоступен для PAT.', 404);
          if (response.status === 429) {
            const header = response.headers.get('retry-after');
            const seconds = header === null ? NaN : Number(header);
            const now = (this.options.now ?? Date.now)();
            retryMs = header ? Math.max(0, Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now) : retryMs;
            if (!Number.isFinite(retryMs)) retryMs = 1000;
            if (retryMs > 60_000 || attempt === 2) throw new AppError('RATE_LIMITED', `Jira ограничила частоту запросов. Повтор возможен не ранее ${new Date(now + retryMs).toISOString()}.`, 429);
          } else if (response.status < 500 || attempt === 2) throw new AppError('JIRA_HTTP', `Jira вернула ошибку HTTP ${response.status}.`, 502);
        } else {
          if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) { await response.body?.cancel(); throw new AppError('JIRA_INVALID_RESPONSE', 'Jira вернула ответ не в формате JSON.'); }
          const max = this.options.maxBytes ?? 20 * 1024 * 1024;
          if (Number(response.headers.get('content-length')) > max) { await response.body?.cancel(); throw new AppError('JIRA_RESPONSE_TOO_LARGE', 'Ответ Jira превышает предел размера.'); }
          const reader = response.body?.getReader();
          if (!reader) throw new AppError('JIRA_INVALID_RESPONSE', 'Jira вернула пустой ответ.');
          const chunks: Uint8Array[] = []; let size = 0;
          try {
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              size += value.length;
              if (size > max) throw new AppError('JIRA_RESPONSE_TOO_LARGE', 'Ответ Jira превышает предел размера.');
              chunks.push(value);
            }
          } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
          try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
          catch { throw new AppError('JIRA_INVALID_RESPONSE', 'Jira вернула некорректный JSON.'); }
        }
      } catch (error) {
        if (signal.aborted) throw new AppError('ABORTED', 'Операция остановлена.');
        if (error instanceof AppError) throw error;
        if (attempt === 2) throw new AppError('JIRA_NETWORK', 'Не удалось прочитать Jira: ошибка сети или таймаут.', 502);
      }
      try { await this.delay(retryMs, signal); }
      catch { throw new AppError('ABORTED', 'Операция остановлена.'); }
    }
    throw new AppError('JIRA_NETWORK', 'Не удалось прочитать Jira.', 502);
  }
}
