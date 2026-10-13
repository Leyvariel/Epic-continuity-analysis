import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatasetService } from '../server/service';
import { CacheStore } from '../server/cache';
import { AppError } from '../server/errors';
import type { ImportJobV3 } from '../shared/contracts';
import { AS_OF, workbook } from './fixtures';
import { fakeGateway, jiraIssue, jiraHistory } from './jira-fixtures';
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function setup() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hf-jira-')); dirs.push(dir);
  const gateway = fakeGateway(), factory = vi.fn().mockResolvedValue(gateway), cache = new CacheStore(dir);
  const service = new DatasetService(cache, () => AS_OF, factory);
  await service.initialize(); return { service, factory, gateway, dir, cache };
}
async function finish(job: ImportJobV3) {
  for (let i = 0; i < 100; i++) { if (['completed', 'failed'].includes(job.status)) return job; await new Promise(r => setTimeout(r, 2)); }
  throw new Error('job timeout');
}
describe('BDD: источник → Jira → публикация → обновление', () => {
  it('не публикует историю первой попытки, если задача изменилась и повторное чтение истории недоступно', async () => {
    const { service, gateway } = await setup();
    gateway.getIssue.mockResolvedValueOnce(jiraIssue()).mockResolvedValue(jiraIssue({ updated: AS_OF }));
    gateway.getHistory.mockResolvedValueOnce(jiraHistory()).mockRejectedValue(new AppError('JIRA_FORBIDDEN', 'История недоступна', 403));
    const job = await finish(service.importEpic('https://hq.tutu.ru/browse/TEST-1'));
    expect(gateway.getHistory).toHaveBeenCalledTimes(2);
    expect(job.status).toBe('failed'); expect(service.getDataset()).toBeNull();
  });
  it('старый и новый ключ одной задачи объединяются до истории, итоговый аудит согласован', async () => {
    const { service, gateway } = await setup();
    gateway.getIssue.mockImplementation(async key => jiraIssue({ key: 'NEW-1', ...(key === 'TEST-1' ? { flow: 'DF' } : {}) }));
    const result = await finish(service.importJiraFile(Buffer.from('Ключ\nTEST-1\nNEW-1'), 'keys.csv'));
    expect(result.status).toBe('completed');
    expect(result.dataset?.epics).toHaveLength(1);
    expect(result.audit?.entries.map(e => e.decision)).toEqual(['included', 'included']);
    expect(result.audit?.resolvedIssues).toBe(1); expect(result.audit?.duplicates).toBe(1);
    expect(gateway.getHistory).toHaveBeenCalledTimes(1);
  });
  it('изменение резолюции в контрольном чтении исключает эпик, а не публикует старый HF', async () => {
    const { service, gateway } = await setup();
    gateway.getIssue.mockResolvedValueOnce(jiraIssue()).mockResolvedValue(jiraIssue({ resolution: 'Отклонено', updated: AS_OF }));
    const result = await finish(service.importEpic('https://hq.tutu.ru/browse/TEST-1'));
    expect(result.status).toBe('completed'); expect(result.dataset?.epics).toEqual([]);
    expect(result.audit?.entries[0].decision).toBe('excluded-rejected');
  });
  it('401 прекращает выборку; новое задание разрешено только после завершения предыдущего', async () => {
    const { service, gateway } = await setup();
    gateway.getIssue.mockRejectedValue(new AppError('JIRA_UNAUTHORIZED', 'PAT не принят', 401));
    const first = service.importJiraFile(Buffer.from('Ключ\nTEST-1\nTEST-2\nTEST-3\nTEST-4\nTEST-5\nTEST-6'), 'keys.csv');
    expect(() => service.importEpic('https://hq.tutu.ru/browse/TEST-1')).toThrow(/Дождитесь/);
    expect((await finish(first)).status).toBe('failed'); expect(gateway.getIssue).toHaveBeenCalledTimes(4);
    expect(gateway.getIssue.mock.calls.map(([key]) => key)).toEqual(['TEST-1', 'TEST-2', 'TEST-3', 'TEST-4']);
    expect(gateway.close).toHaveBeenCalledTimes(1);
  });
  it('AC-05: одинаковый эпик из трёх источников даёт одинаковый расчёт', async () => {
    const { service, gateway } = await setup();
    const file = await finish(service.importJiraFile(workbook([['Ключ'], ['TEST-1']]), 'keys.xlsx'));
    const epic = await finish(service.importEpic('https://hq.tutu.ru/browse/TEST-1'));
    expect(gateway.readBoard).not.toHaveBeenCalled();
    const board = await finish(service.importBoard('https://hq.tutu.ru/secure/RapidBoard.jspa?rapidView=1482'));
    for (const job of [file, epic, board]) { expect(job.status).toBe('completed'); expect(job.dataset?.epics[0].ttmMs).toBe(15 * 86400000); }
    expect(epic.dataset?.epics[0].intervals).toEqual(file.dataset?.epics[0].intervals);
    expect(board.dataset?.epics[0].intervals).toEqual(file.dataset?.epics[0].intervals);
    expect(epic.dataset?.epics[0].summary.sourceRow).toBeUndefined();
  });
  it('AC-09: ранее исключённый кандидат файла повторно проверяется; кэш без Jira', async () => {
    const { service, gateway, dir } = await setup();
    gateway.getIssue.mockResolvedValue(jiraIssue({ flow: 'DF' }));
    const first = await finish(service.importJiraFile(Buffer.from('Ключ\nTEST-1'), 'keys.csv'));
    expect(first.dataset?.epics).toEqual([]);
    gateway.getIssue.mockResolvedValue(jiraIssue({ key: 'NEW-1' }));
    const next = await finish(service.refresh(first.dataset!.id));
    expect(next.dataset?.epics[0].summary.key).toBe('NEW-1');
    expect(gateway.getIssue.mock.calls.at(-1)?.[0]).toBe('10001');
    const noNetwork = vi.fn().mockRejectedValue(new Error('forbidden'));
    const restored = new DatasetService(new CacheStore(dir), () => '2027-01-01T00:00:00Z', noNetwork);
    await restored.initialize();
    expect(restored.getDataset()).toEqual(next.dataset); expect(noNetwork).not.toHaveBeenCalled();
    expect(() => service.refresh(first.dataset!.id)).toThrow(/набор/i);
  });
  it('AC-10: частичный файл не смешивается с прежним набором; недоступный одиночный эпик не заменяет его', async () => {
    const { service, gateway } = await setup();
    gateway.getIssue.mockImplementation(async key => { if (key === 'TEST-2') throw new AppError('JIRA_NOT_FOUND', 'Недоступна', 404); return jiraIssue(); });
    const result = await finish(service.importJiraFile(Buffer.from('Ключ\nTEST-1\nTEST-2'), 'keys.csv'));
    expect(result.status).toBe('completed'); expect(result.dataset?.quality).toBe('partial'); expect(result.dataset?.epics).toHaveLength(1);
    const failed = await finish(service.importEpic('https://hq.tutu.ru/browse/TEST-2'));
    expect(failed.status).toBe('failed'); expect(service.getDataset()?.id).toBe(result.dataset?.id);
  });
  it('все истории недоступны: failed; неполная доступная история: partial, а не ложный not-started', async () => {
    const { service, gateway } = await setup();
    gateway.getHistory.mockRejectedValueOnce(new AppError('JIRA_FORBIDDEN', 'Нет доступа к истории', 403));
    expect((await finish(service.importEpic('https://hq.tutu.ru/browse/TEST-1'))).status).toBe('failed');
    gateway.getHistory.mockResolvedValue(jiraHistory({ statusCoverage: 'partial', currentStatus: '[HF] Открыт', statusChanges: [] }));
    const partial = await finish(service.importEpic('https://hq.tutu.ru/browse/TEST-1'));
    expect(partial.status).toBe('completed'); expect(partial.dataset?.epics[0].ttmState).toBe('indeterminate');
  });
  it('неполная или нестабильная доска не публикует усечённый набор', async () => {
    const { service, gateway } = await setup();
    const board = { id: '1482', name: 'Доска', fingerprint: 'a', complete: false, candidates: [] };
    gateway.readBoard.mockResolvedValue(board);
    expect((await finish(service.importBoard('https://hq.tutu.ru/secure/RapidBoard.jspa?rapidView=1482'))).status).toBe('failed');
    let counter = 0;
    gateway.readBoard.mockImplementation(async () => ({ ...board, complete: true, fingerprint: String(counter++) }));
    expect((await finish(service.importBoard('https://hq.tutu.ru/secure/RapidBoard.jspa?rapidView=1482'))).status).toBe('failed');
  });
  it('не начинает массовое чтение историй доски, если пригодность хотя бы одного кандидата неизвестна', async () => {
    const { service, gateway } = await setup();
    gateway.readBoard.mockResolvedValue({ id: '1482', name: 'Доска', fingerprint: 'stable', complete: true, candidates: [{ requestedKey: 'TEST-1', rows: [] }, { requestedKey: 'TEST-2', rows: [] }] });
    gateway.getIssue.mockImplementation(async key => jiraIssue({ key, id: key === 'TEST-1' ? '10001' : '10002', flow: key === 'TEST-1' ? 'HF' : 'unknown' }));
    const result = await finish(service.importBoard('https://hq.tutu.ru/secure/RapidBoard.jspa?rapidView=1482'));
    expect(result.status).toBe('failed'); expect(gateway.getHistory).not.toHaveBeenCalled();
    expect(result.audit?.entries.find(e => e.requestedKey === 'TEST-2')?.decision).toBe('unresolved');
  });
  it('пустой ключевой файл не читает credentials; отказ записи не публикуется; mutex освобождается', async () => {
    const { service, factory, cache } = await setup();
    expect((await finish(service.importJiraFile(Buffer.from('Ключ\nне ключ'), 'keys.csv'))).status).toBe('failed');
    expect(factory).not.toHaveBeenCalled();
    vi.spyOn(cache, 'write').mockRejectedValueOnce(new Error('secret-marker'));
    const failed = await finish(service.importEpic('https://hq.tutu.ru/browse/TEST-1'));
    expect(failed.status).toBe('failed'); expect(JSON.stringify(failed)).not.toContain('secret-marker'); expect(service.getDataset()).toBeNull();
    expect((await finish(service.importEpic('https://hq.tutu.ru/browse/TEST-1'))).status).toBe('completed');
  });
});
