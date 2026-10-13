// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { App } from '../src/App';
import { createApp } from '../server/app';
import { DatasetService } from '../server/service';
import { CacheStore } from '../server/cache';
import { AppError } from '../server/errors';
import { AS_OF } from './fixtures';
import { fakeGateway, jiraIssue, jiraHistory } from './jira-fixtures';
import { linkedWorkbook } from './linked-workbook';
import { ServerJiraAdapter } from '../server/jira/adapter';

let container: HTMLDivElement, root: Root;
const cleanup: (() => Promise<unknown>)[] = [];
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  for (const fn of cleanup.splice(0).reverse()) await fn();
  vi.restoreAllMocks();
});
const button = (label: string) => [...container.querySelectorAll('button')].find(item => item.textContent === label)!;
async function until(check: () => boolean) {
  for (let i = 0; i < 80; i++) {
    if (check()) return;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
  }
  throw new Error(`Timed out waiting for UI: ${container.textContent?.slice(0, 400)}`);
}
async function setup(factory: ConstructorParameters<typeof DatasetService>[2], initialFile?: Buffer) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hf-keys-flow-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const service = new DatasetService(new CacheStore(dir), () => AS_OF, factory);
  await service.initialize();
  if (initialFile) { service.import(initialFile, 'previous-demo.xlsx'); await service.waitForIdle(); }
  const server = http.createServer(createApp(service));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  cleanup.push(() => service.waitForIdle());
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const realFetch = globalThis.fetch.bind(globalThis);
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => realFetch(typeof url === 'string' && url.startsWith('/') ? base + url : url, init));
  await act(async () => root.render(<App />));
  await until(() => Boolean(button('Список ключей')));
  const submit = async (value: string) => {
    await act(async () => button('Список ключей').click());
    const input = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ключи эпиков"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  };
  return { base, service, fetcher, submit, realFetch };
}

describe('KEYS-FLOW: пользовательский путь через настоящий локальный API', () => {
  it('RAILDIS → дочерний эпик → Epic Link и contains: все допустимые задачи, без дублей, отклонённых и подзадач', async () => {
    const records = [
      ['1', 'RAILDIS-58', '6', '[HF] Реализация'], ['2', 'RAIL-11361', '6', '[DF] Реализация'],
      ['3', 'ANL-19960', '3', 'В работе'], ['4', 'RAIL-12909', '3', 'В работе'],
      ['5', 'RAIL-12559', '3', 'В работе'], ['6', 'RAIL-10639', '3', 'В работе'], ['7', 'RAIL-99999', '5', 'В работе'],
    ];
    const get = vi.fn(async (url: string) => {
      if (url === '/rest/api/2/status') return [];
      const id = url.split('/').at(-1)!;
      if (url.includes('/epic/')) return { startAt: 0, total: url.includes('/2/') ? 5 : 0,
        issues: url.includes('/2/') ? records.slice(2).map(([id, key]) => ({ id, key })) : [] };
      const record = records.find(([issueId, key]) => issueId === id || key === id)!;
      const [issueId, key, type, status] = record;
      const target = issueId === '1' ? records[1] : issueId === '2' ? records[2] : null;
      return { id: issueId, key, fields: { summary: 'Тестовая задача', issuetype: { id: type, name: type === '6' ? 'Эпик' : 'Задача', subtask: type === '5' },
        status: { id: '10', name: status, statusCategory: { key: 'indeterminate' } }, resolution: issueId === '6' ? { id: '20', name: 'Отклонено' } : null,
        created: '2026-09-01T00:00:00Z', updated: '2026-09-01T00:00:00Z', customfield_10000: [],
        issuelinks: target ? [{ type: { outward: 'contains', inward: 'is contained in' }, outwardIssue: { id: target[0], key: target[1] } }] : [] },
        changelog: { startAt: 0, total: 0, maxResults: 0, histories: [] } };
    });
    const profile = { version: '9.12.10' as const, epicTypeIds: ['6'], flagFieldId: 'customfield_10000', flagOptionId: '10000', historyMode: 'issue-expand' as const, flowRule: 'status-prefix' as const };
    const { service, submit } = await setup(async () => new ServerJiraAdapter({ get }, profile));
    await submit('RAILDIS-58');
    await until(() => container.querySelectorAll('.epic-row').length === 1);
    expect(container.querySelector('.timeline-table')?.textContent).not.toContain('RAIL-11361');
    await act(async () => container.querySelector<HTMLButtonElement>('.epic-row button[aria-expanded="false"]')!.click());
    expect(container.querySelector('.timeline-table')?.textContent).toContain('RAIL-11361');
    expect(container.querySelector('.timeline-table')?.textContent).not.toContain('RAIL-12909');
    const second = container.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!;
    await act(async () => second.click());
    const table = container.querySelector('.timeline-table')!;
    for (const key of ['ANL-19960', 'RAIL-12909', 'RAIL-12559']) expect(table.textContent?.split(key)).toHaveLength(2);
    for (const key of ['RAIL-10639', 'RAIL-99999']) expect(table.textContent).not.toContain(key);
    expect(service.getDataset()?.hierarchy?.coverage).toBe('complete');
    expect(Object.values(service.getDataset()!.hierarchy!.nodes).find(n => n.key === 'RAIL-12909')?.timeline.state).toBe('complete');
  });
  it('заменяет прежнюю демонстрацию ровно тремя запрошенными CARSDIS, сохраняя ключ дочерней задачи', async () => {
    const keys = ['CARSDIS-6', 'CARSDIS-18', 'CARSDIS-26'];
    const child = jiraIssue({ id: '20001', key: 'CARSDEL-7', flow: 'unknown', isEpic: false, issueType: 'Задача' });
    const issues = keys.map((key, i) => jiraIssue({ id: String(10001 + i), key, links: i === 0 ? [{ parent: String(10001 + i), child: child.id, childKey: child.key }] : [] }));
    const gateway = fakeGateway();
    gateway.getIssue.mockImplementation(async key => {
      const issue = [...issues, child].find(issue => issue.key === key || issue.id === key);
      if (!issue) throw new Error('Unexpected fixture key');
      return issue;
    });
    gateway.getHistory.mockImplementation(async issue => jiraHistory({ key: issue.key }));
    const { service, submit } = await setup(vi.fn().mockResolvedValue(gateway), linkedWorkbook());
    expect(container.querySelector('.epic-row')?.textContent).toContain('A-1');
    await submit(keys.join('\n'));
    await until(() => container.querySelectorAll('.epic-row').length === 3);
    expect(service.getDataset()?.epics.map(epic => epic.summary.key).sort()).toEqual([...keys].sort());
    expect(container.querySelector('.timeline-table')?.textContent).not.toContain('A-1');
    const parent = [...container.querySelectorAll('.epic-row')].find(row => row.textContent?.includes('CARSDIS-6'))!;
    const expand = parent.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
    expect(expand).not.toBeNull();
    await act(async () => expand!.click());
    expect(container.querySelector('.timeline-table')?.textContent).toContain('CARSDEL-7');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it('AC-020/022/025: один смешанный ввод приводит к HF и двум объяснённым ошибкам', async () => {
    const gateway = fakeGateway();
    gateway.getIssue.mockImplementation(async key => {
      if (key === 'TEST-2') throw new AppError('JIRA_NOT_FOUND', 'Не найдена или недоступна', 404);
      if (key === 'TEST-3' || key === '10003') return jiraIssue({ id: '10003', key: 'TEST-3', flow: 'DF' });
      if (key === 'TEST-1' || key === '10001') return jiraIssue();
      throw new Error(`Unexpected key: ${key}`);
    });
    gateway.getHistory.mockResolvedValue(jiraHistory());
    const factory = vi.fn().mockResolvedValue(gateway);
    const { base, service, fetcher, submit, realFetch } = await setup(factory);
    const raw = 'TEST-1\nневерный ключ\nTEST-2\nTEST-3';
    await submit(raw);
    await until(() => container.querySelectorAll('.error-row').length === 2 && container.querySelectorAll('.epic-row').length === 1);
    expect(fetcher.mock.calls.filter(([url]) => url === '/api/keys/import')).toHaveLength(1);
    expect(fetcher.mock.calls.find(([url]) => url === '/api/keys/import')?.[1]?.body).toBe(JSON.stringify({ text: raw }));
    expect(container.querySelector('.epic-row')?.textContent).toContain('TEST-1');
    expect(container.querySelectorAll('.status-segment').length).toBeGreaterThan(0);
    expect([...container.querySelectorAll('.error-row')].map(row => row.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('неверный ключ'), expect.stringContaining('TEST-2')]));
    expect(container.querySelector('.timeline-table')?.textContent).not.toContain('TEST-3');
    expect(container.querySelector('.dataset-meta')?.textContent).toContain('15,00');
    const { dataset } = await (await realFetch(base + '/api/dataset')).json();
    expect(dataset.id).toBe(service.getDataset()?.id);
    expect(dataset.audit.entries).toHaveLength(4);
  });
  it('AC-021: только ошибки показываются после сохранения, без обращения к Jira', async () => {
    const factory = vi.fn().mockRejectedValue(new Error('Jira must not be used'));
    const { base, submit, realFetch } = await setup(factory);
    await submit('неверный ключ\nещё один');
    await until(() => container.querySelectorAll('.error-row').length === 2);
    expect(container.querySelectorAll('.epic-row')).toHaveLength(0);
    expect(container.querySelector('.no-results')).toBeNull();
    expect(container.textContent).toContain('Jira не запрашивалась');
    expect(factory).not.toHaveBeenCalled();
    const { dataset } = await (await realFetch(base + '/api/dataset')).json();
    expect(dataset.epics).toEqual([]);
    expect(dataset.audit.entries.map((entry: { decision: string }) => entry.decision)).toEqual(['invalid', 'invalid']);
  });
});
