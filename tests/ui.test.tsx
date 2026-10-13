// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from '../src/App';
import { buildDataset } from '../server/service';
import { parseWorkbook } from '../server/import';
import { AS_OF, historyWorkbook } from './fixtures';
import { DatasetSummary } from '../src/DatasetSummary';
import type { JiraDataset } from '../shared/contracts';

let container: HTMLDivElement, root: Root;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const button = (text: string) => [...container.querySelectorAll('button')].find(b => b.textContent === text)!;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.useFakeTimers();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe('BDD: пользователь выбирает источник и получает понятный результат', () => {
  it('не называет пустой частичный результат подтверждённым отсутствием HF', async () => {
    const dataset = { schemaVersion: 3, calculationProfile: 'jira-v3', source: { kind: 'file', filename: 'keys.csv' }, syncFinishedAt: AS_OF, epics: [], quality: 'partial', audit: { entries: [{ requestedKey: 'TEST-1', rows: [2], decision: 'unresolved', reason: 'Нет доступа' }], eligibilityCoverage: 'partial', duplicates: 0 } } as unknown as JiraDataset;
    await act(async () => root.render(<DatasetSummary dataset={dataset} />));
    expect(container.textContent).toContain('Не удалось проверить всех кандидатов');
    expect(container.textContent).not.toContain('В подтверждённой выборке нет');
  });
  it('AC-01/04: три режима; ссылка на эпик отправляется самостоятельно, polling останавливается', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (url === '/api/dataset') return response({ dataset: null });
      if (url === '/api/epic/import') return response({ id: 'one' }, 202);
      return response({ id: 'one', status: 'failed', errors: [{ code: 'EXAMPLE', message: 'Пример ошибки Jira' }], dataset: null, total: 1, completed: 0 });
    });
    await act(async () => root.render(<App />));
    expect(button('Файл')).toBeDefined(); expect(button('Доска Jira')).toBeDefined(); expect(button('Эпик Jira')).toBeDefined();
    await act(async () => button('Эпик Jira').click());
    const input = container.querySelector<HTMLInputElement>('input[type=url]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'https://hq.tutu.ru/browse/TEST-1');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(fetcher.mock.calls.some(([url, init]) => url === '/api/epic/import' && init?.body === JSON.stringify({ url: 'https://hq.tutu.ru/browse/TEST-1' }))).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(container.textContent).toContain('Пример ошибки Jira');
    expect(fetcher.mock.calls.find(([url]) => url === '/api/jobs/one')?.[1]?.signal?.aborted).toBe(true);
    const count = fetcher.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(fetcher).toHaveBeenCalledTimes(count);
  });
  it('AC-06: эпик только в Открыто виден на календаре без Excel-fallback', async () => {
    const dataset = buildDataset(parseWorkbook(historyWorkbook([['TEST-1', '[HF] Открыт', '2026-09-01T09:00:00Z', '']]), 'open.xlsx', AS_OF), AS_OF);
    dataset.epics[0].statusCoverage = 'complete'; dataset.epics[0].flagCoverage = 'partial';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ dataset }));
    await act(async () => root.render(<App />));
    expect(container.textContent).toContain('TTM ещё не начат');
    expect(container.querySelector('.status-segment')?.textContent).toBe('Открыто');
    expect(container.querySelector('.end-marker')).toBeNull();
    expect(container.querySelector('.calendar-placeholder')).toBeNull();
    expect(container.querySelector('.no-history')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('.epic-title')!.click());
    expect(container.querySelector('[role=dialog]')?.textContent).toContain('История статусовПолная');
    expect(container.querySelector('[role=dialog]')?.textContent).toContain('История impedimentНеполная');
  });
});
