// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SourceForm } from '../src/SourceForm';
import { App } from '../src/App';
import type { JiraDataset } from '../shared/contracts';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatasetService } from '../server/service';
import { CacheStore } from '../server/cache';
import { AppError } from '../server/errors';
import { fakeGateway, jiraHistory, jiraIssue } from './jira-fixtures';
import { AS_OF } from './fixtures';
import { DatasetSummary } from '../src/DatasetSummary';

let container: HTMLDivElement, root: Root;
const dirs: string[] = [];
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const button = (label: string) => [...container.querySelectorAll('button')].find(item => item.textContent === label)!;
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const errorOnly = () => ({
  schemaVersion: 3, calculationProfile: 'jira-v3', id: 'keys-only', asOf: '2026-09-18T09:00:00.000Z', savedAt: '2026-09-18T09:00:00.000Z',
  source: { kind: 'keys', importedAt: '2026-09-18T09:00:00.000Z', historyMode: 'jira' }, syncStartedAt: '2026-09-18T09:00:00.000Z', syncFinishedAt: '2026-09-18T09:00:00.000Z',
  audit: { sourceCoverage: 'complete', eligibilityCoverage: 'partial', inputRows: 2, duplicates: 0, resolvedIssues: 0,
    entries: [
      { requestedKey: '<script>alert(1)</script>', rows: [1], decision: 'invalid', reason: 'Некорректный формат ключа Jira.' },
      { requestedKey: '<script>alert(1)</script>', rows: [3], decision: 'invalid', reason: 'Некорректный формат ключа Jira.' },
    ] }, epics: [], warnings: [], quality: 'partial',
}) as unknown as JiraDataset;
async function mixedDataset() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hf-keys-ui-')); dirs.push(dir);
  const gateway = fakeGateway();
  gateway.getIssue.mockImplementation(async key => {
    if (key === 'TEST-2') throw new AppError('JIRA_NOT_FOUND', 'Не найдена или недоступна', 404);
    if (key === 'TEST-4' || key === '10004') return jiraIssue({ id: '10004', key: 'TEST-4', title: 'Короткий HF' });
    if (key === 'TEST-1' || key === '10001') return jiraIssue();
    throw new Error(`Unexpected key: ${key}`);
  });
  gateway.getHistory.mockImplementation(async issue => issue.key === 'TEST-4' ? jiraHistory({
    key: 'TEST-4', title: 'Короткий HF', historyCount: 2,
    statusChanges: [
      { id: '1', at: '2026-09-02T09:00:00.000Z', from: '[HF] Открыт', to: '[HF] Подготовка' },
      { id: '2', at: '2026-09-07T09:00:00.000Z', from: '[HF] Подготовка', to: '[HF] Закрыт' },
    ], proof: { expected: 2, received: 2, terminal: true, adapterVersion: 'fake-v1' },
  }) : jiraHistory());
  const service = new DatasetService(new CacheStore(dir), () => AS_OF, vi.fn().mockResolvedValue(gateway));
  await service.initialize();
  const result = service.importKeys('TEST-1\nневерный ключ\nTEST-4\nTEST-2');
  await service.waitForIdle();
  expect(result.status).toBe('completed');
  return result.dataset as JiraDataset;
}
async function partialHistoryDataset() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hf-keys-partial-ui-')); dirs.push(dir);
  const gateway = fakeGateway();
  gateway.getIssue.mockImplementation(async key => key === 'TEST-4' || key === '10004'
    ? jiraIssue({ id: '10004', key: 'TEST-4', currentStatus: '[HF] Открыт' }) : jiraIssue());
  gateway.getHistory.mockImplementation(async issue => issue.key === 'TEST-4'
    ? jiraHistory({ key: 'TEST-4', currentStatus: '[HF] Открыт', statusChanges: [], historyCount: 0,
      proof: { expected: 0, received: 0, terminal: true, adapterVersion: 'fake-v1' } })
    : jiraHistory({ flagCoverage: 'partial', flagAvailable: false }));
  const service = new DatasetService(new CacheStore(dir), () => AS_OF, vi.fn().mockResolvedValue(gateway));
  await service.initialize();
  const result = service.importKeys('TEST-1\nTEST-4'); await service.waitForIdle();
  expect(result.status).toBe('completed');
  return result.dataset as JiraDataset;
}

describe('KEYS-FORM: ввод списка в форме', () => {
  it('AC-022: отправляет исходный многострочный текст одним действием', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    await act(async () => root.render(<SourceForm busy={false} onSubmit={onSubmit} />));
    await act(async () => button('Список ключей').click());
    const input = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ключи эпиков"]')!;
    const raw = 'TEST-1\n\n| TEST-2 |\nневерный ключ';
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, raw); input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(onSubmit).not.toHaveBeenCalled();
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ kind: 'keys', text: raw });
  });
});

describe('KEYS-SUMMARY: сводка прямого списка', () => {
  it('AC-021/025: локальная проверка не называется чтением Jira; смешанная отделяет HF от ошибок', async () => {
    await act(async () => root.render(<DatasetSummary dataset={errorOnly()} />));
    expect(container.textContent).toContain('Jira не запрашивалась');
    expect(container.textContent).toContain('ошибок 2');
    expect(container.textContent).not.toContain('Загружено');
    const mixed = await mixedDataset();
    await act(async () => root.render(<DatasetSummary dataset={mixed} />));
    expect(container.textContent).toContain('история Jira');
    expect(container.textContent).toContain('ошибок 2');
  });
  it('AC-028: подтверждённый HF с неполным флагом остаётся с TTM, начальное Открыто — без ошибки ключа', async () => {
    const dataset = await partialHistoryDataset();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ dataset }));
    await act(async () => root.render(<App />));
    expect(container.querySelectorAll('.epic-row')).toHaveLength(2);
    expect(container.querySelectorAll('.error-row')).toHaveLength(0);
    expect(container.querySelectorAll('.epic-row')[0].textContent).toContain('15,00');
    expect(container.querySelectorAll('.epic-row')[1].textContent).toContain('TTM ещё не начат');
    await act(async () => container.querySelector<HTMLButtonElement>('.epic-row .epic-title')!.click());
    expect(container.querySelector('[role=dialog]')?.textContent).toContain('История impedimentНеполная');
  });
});

describe('KEYS-TABLE: ошибочные строки рядом с эпиками', () => {
  it('AC-021/025: таблица только с ошибками показывает оба исходных вхождения без метрик, полос и HTML', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ dataset: errorOnly() }));
    await act(async () => root.render(<App />));
    const rows = container.querySelectorAll('.error-row');
    expect(rows).toHaveLength(2);
    expect([...rows].map(row => row.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Строка 1'), expect.stringContaining('Строка 3')]));
    expect(rows[0].textContent).toContain('<script>alert(1)</script>');
    expect(rows[0].querySelector('script')).toBeNull();
    expect(rows[0].querySelectorAll('.error-metric')).not.toHaveLength(0);
    expect([...rows[0].querySelectorAll('.error-metric')].every(cell => cell.textContent === '—')).toBe(true);
    expect(container.querySelector('.status-segment')).toBeNull();
    expect(container.querySelector('.no-results')).toBeNull();
    expect(container.textContent).toContain('время проверки ввода');
    expect(container.textContent).not.toContain('Загружено');
    expect(container.textContent).not.toContain('полная история');
    expect(container.textContent).not.toContain('TTM по истории');
  });
  it('AC-025/026: поиск и обе сортировки сохраняют ошибки после известных TTM', async () => {
    const dataset = await mixedDataset();
    expect(dataset.epics.map(epic => epic.ttmMs)).toEqual([15 * 86400000, 5 * 86400000]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ dataset }));
    await act(async () => root.render(<App />));
    const hfKeys = () => [...container.querySelectorAll('.epic-row .epic-title strong')].map(node => node.textContent);
    expect(hfKeys()).toEqual(['TEST-1', 'TEST-4']);
    expect(container.querySelectorAll('.error-row')).toHaveLength(2);
    expect(container.querySelector('.dataset-meta')?.textContent).toContain('10,00');
    expect(container.querySelector('.dataset-meta')?.textContent).toContain('15,00');
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Изменить направление сортировки"]')!.click());
    expect(hfKeys()).toEqual(['TEST-4', 'TEST-1']);
    expect(container.querySelectorAll('.error-row')).toHaveLength(2);
    const input = container.querySelector<HTMLInputElement>('[aria-label="Поиск по ключу или названию"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'TEST-2'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(container.querySelectorAll('.epic-row')).toHaveLength(0);
    expect(container.querySelectorAll('.error-row')).toHaveLength(1);
    expect(container.querySelector('.no-results')).toBeNull();
  });
  it('AC-019/027: алиасы одной недоступной задачи дают одну строку и один счётчик ошибки', async () => {
    const dataset = errorOnly();
    dataset.audit.entries = [
      { requestedKey: 'OLD-1', rows: [1], issueId: '10001', decision: 'unresolved', reason: 'Не найдена или недоступна' },
      { requestedKey: 'TEST-1', rows: [2], issueId: '10001', decision: 'unresolved', reason: 'Не найдена или недоступна' },
    ];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ dataset }));
    await act(async () => root.render(<App />));
    expect(container.querySelectorAll('.error-row')).toHaveLength(1);
    expect(container.querySelector('.source-line')?.textContent).toContain('ошибок 1');
  });
});
