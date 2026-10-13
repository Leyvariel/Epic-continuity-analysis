import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { jiraInputsSchema } from '../server/jira/cache-schema';
import { CacheStore } from '../server/cache';
import { DatasetService } from '../server/service';
import { buildJiraDataset } from '../server/jira/dataset';
import { AS_OF } from './fixtures';
import { parseKeyCandidates } from '../server/key-candidates';
import { collectJiraInputs } from '../server/jira/pipeline';
import { AppError } from '../server/errors';
import { fakeGateway, jiraIssue, jiraHistory } from './jira-fixtures';
import { isJiraDataset, type ImportJobV3 } from '../shared/contracts';

const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const invalidInput = () => ({
  source: { kind: 'keys', importedAt: AS_OF, historyMode: 'jira' },
  candidates: [],
  audit: { sourceCoverage: 'complete', eligibilityCoverage: 'partial', inputRows: 1, duplicates: 0, resolvedIssues: 0,
    entries: [{ requestedKey: 'неверный ключ', rows: [3], decision: 'invalid', reason: 'Некорректный формат ключа Jira.' }] },
  asOf: AS_OF, syncStartedAt: AS_OF, syncFinishedAt: AS_OF,
  epics: [], histories: {}, historyWarnings: {}, warnings: [],
});

const job = (): ImportJobV3 => ({ id: 'job', status: 'queued', total: null, completed: 0, currentKey: null, errors: [], dataset: null, createdAt: AS_OF });

describe('KEYS-PIPELINE: отбор прямого списка', () => {
  it('AC-021: только ошибочные строки дают локальный набор без gateway', async () => {
    const factory = vi.fn();
    const state = job();
    const inputs = await collectJiraInputs({ kind: 'keys', parsed: parseKeyCandidates('неверный ключ\nещё один') }, state, factory, new AbortController().signal, () => AS_OF);
    expect(factory).not.toHaveBeenCalled();
    expect(inputs.source).toMatchObject({ kind: 'keys', importedAt: AS_OF });
    expect(inputs.candidates).toEqual([]);
    expect(inputs.audit.entries.map(entry => [entry.requestedKey, entry.rows, entry.decision])).toEqual([
      ['неверный ключ', [1], 'invalid'], ['ещё один', [2], 'invalid'],
    ]);
    expect(inputs.audit).toMatchObject({ sourceCoverage: 'complete', eligibilityCoverage: 'partial' });
    expect(state.audit).toEqual(inputs.audit);
  });
  it.each(['\n', ','])('AC-020/025/094: смешанная выборка с разделителем %j', async separator => {
    const gateway = fakeGateway();
    gateway.getIssue.mockImplementation(async key => {
      if (key === 'TEST-2') throw new AppError('JIRA_NOT_FOUND', 'Не найдена или недоступна', 404);
      if (key === 'TEST-3' || key === '10003') return jiraIssue({ id: '10003', key: 'TEST-3', flow: 'DF' });
      if (key === 'TEST-1' || key === '10001') return jiraIssue();
      throw new Error('Unexpected key');
    });
    gateway.getHistory.mockResolvedValue(jiraHistory());
    const factory = vi.fn().mockResolvedValue(gateway);
    const inputs = await collectJiraInputs({ kind: 'keys', parsed: parseKeyCandidates(['TEST-1','неверный ключ','TEST-2','TEST-3'].join(separator)) }, job(), factory, new AbortController().signal, () => AS_OF);
    expect(inputs.epics.map(epic => epic.key)).toEqual(['TEST-1']);
    expect(jiraInputsSchema.parse(JSON.parse(JSON.stringify(inputs)))).toEqual(inputs);
    expect(jiraInputsSchema.safeParse({...inputs,audit:{...inputs.audit,inputRows:99}}).success).toBe(false);
    expect(inputs.audit.entries.map(entry => [entry.requestedKey, entry.decision])).toEqual([
      ['неверный ключ', 'invalid'], ['TEST-2', 'unresolved'], ['TEST-1', 'included'], ['TEST-3', 'excluded-df'],
    ]);
    expect(inputs.audit.eligibilityCoverage).toBe('partial');
    expect(gateway.getIssue.mock.calls.map(([key]) => key)).not.toContain('неверный ключ');
    expect(buildJiraDataset(inputs, AS_OF).epics[0].ttmMs).toBe(15 * 86400000);
  });
});

async function serviceSetup() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hf-keys-')); dirs.push(dir);
  const gateway = fakeGateway(), factory = vi.fn().mockResolvedValue(gateway), cache = new CacheStore(dir);
  const service = new DatasetService(cache, () => AS_OF, factory);
  await service.initialize();
  return { service, cache, dir, gateway, factory };
}

describe('KEYS-SERVICE: публикация и обновление списка', () => {
  it('AC-021/024: отчёт только об ошибках публикуется и открывается после перезапуска без Jira', async () => {
    const { service, dir, factory } = await serviceSetup();
    const accepted = service.importKeys('неверный ключ\nещё один');
    await service.waitForIdle();
    const finished = service.getJob(accepted.id);
    expect(finished.status).toBe('completed');
    expect(finished.audit?.entries).toHaveLength(2);
    expect(finished.dataset?.epics).toEqual([]);
    expect(factory).not.toHaveBeenCalled();
    const restoredFactory = vi.fn().mockRejectedValue(new Error('Network unavailable'));
    const restored = new DatasetService(new CacheStore(dir), () => AS_OF, restoredFactory);
    await restored.initialize();
    expect(restored.getDataset()).toEqual(finished.dataset);
    expect(restoredFactory).not.toHaveBeenCalled();
    const refreshed = restored.refresh(finished.dataset!.id);
    await restored.waitForIdle();
    expect(restored.getJob(refreshed.id).status).toBe('completed');
    expect(restored.getDataset()?.source).toEqual(finished.dataset?.source);
    expect(restoredFactory).not.toHaveBeenCalled();
  });
  it('AC-021: пустое оформление отклонено до задания и прежний набор не заменён', async () => {
    const { service, factory } = await serviceSetup();
    const first = service.importKeys('неверный ключ'); await service.waitForIdle();
    expect(() => service.importKeys('New grid\n\n| :--- |')).toThrow(/Введите/);
    expect(service.getDataset()?.id).toBe(first.dataset?.id);
    expect(factory).not.toHaveBeenCalled();
  });
  it('AC-023: refresh повторно проверяет исключённые и недоступные ключи, но сохраняет invalid', async () => {
    const { service, gateway } = await serviceSetup();
    let available = false;
    gateway.getIssue.mockImplementation(async key => {
      if (key === 'TEST-2' && !available) throw new AppError('JIRA_NOT_FOUND', 'Не найдена или недоступна', 404);
      if (key === 'TEST-2' || key === '10002') return jiraIssue({ id: '10002', key: 'TEST-2' });
      if (key === 'TEST-3' || key === '10003') return jiraIssue({ id: '10003', key: 'TEST-3', flow: 'DF' });
      if (key === 'TEST-1' || key === '10001') return jiraIssue();
      throw new Error(`Unexpected key: ${key}`);
    });
    const first = service.importKeys('TEST-1\nошибка формата\nTEST-2\nTEST-3');
    await service.waitForIdle();
    expect(first.status).toBe('completed');
    expect(first.dataset?.epics.map(epic => epic.summary.key)).toEqual(['TEST-1']);
    available = true;
    const next = service.refresh(first.dataset!.id); await service.waitForIdle();
    expect(next.status).toBe('completed');
    expect(next.dataset?.epics.map(epic => epic.summary.key)).toEqual(['TEST-1', 'TEST-2']);
    expect(next.audit?.entries.some(entry => entry.requestedKey === 'TEST-2' && entry.decision === 'unresolved')).toBe(false);
    expect(next.audit?.entries.find(entry => entry.decision === 'invalid')).toEqual(first.audit?.entries.find(entry => entry.decision === 'invalid'));
    expect(gateway.getIssue.mock.calls.some(([key]) => key === '10003')).toBe(true);
    expect(next.dataset?.source).toEqual(first.dataset?.source);
  });
  it('AC-024: смешанный набор восстанавливается из кэша без сети вместе с аудитом', async () => {
    const { service, gateway, dir } = await serviceSetup();
    gateway.getIssue.mockImplementation(async key => {
      if (key === 'TEST-2') throw new AppError('JIRA_NOT_FOUND', 'Не найдена или недоступна', 404);
      return jiraIssue();
    });
    const first = service.importKeys('TEST-1\nневерный ключ\nTEST-2'); await service.waitForIdle();
    expect(first.status).toBe('completed');
    const noNetwork = vi.fn().mockRejectedValue(new Error('No network'));
    const restored = new DatasetService(new CacheStore(dir), () => AS_OF, noNetwork);
    await restored.initialize();
    const restoredDataset = restored.getDataset();
    expect(restoredDataset).toEqual(first.dataset);
    if (!isJiraDataset(restoredDataset)) throw new Error('Ожидался набор Jira');
    expect(restoredDataset.audit.entries.map(entry => entry.decision)).toEqual(['invalid', 'unresolved', 'included']);
    expect(noNetwork).not.toHaveBeenCalled();
  });
  it('AC-027: все синтаксически верные, но отдельно недоступные ключи сохраняются как ошибки', async () => {
    const { service, gateway } = await serviceSetup();
    gateway.getIssue.mockImplementation(async key => { throw new AppError(key === 'TEST-1' ? 'JIRA_FORBIDDEN' : 'JIRA_NOT_FOUND', 'Не найдена или недоступна', key === 'TEST-1' ? 403 : 404); });
    const result = service.importKeys('TEST-1\nTEST-2'); await service.waitForIdle();
    expect(result.status).toBe('completed');
    expect(result.dataset?.epics).toEqual([]);
    expect(result.audit?.entries.map(entry => entry.decision)).toEqual(['unresolved', 'unresolved']);
    expect(result.audit?.eligibilityCoverage).toBe('partial');
  });
  it('AC-019: два алиаса одной задачи дают одну историю и одного HF', async () => {
    const { service, gateway } = await serviceSetup();
    gateway.getIssue.mockResolvedValue(jiraIssue({ key: 'TEST-1' }));
    const result = service.importKeys('OLD-1\nTEST-1'); await service.waitForIdle();
    expect(result.status).toBe('completed');
    expect(result.dataset?.epics).toHaveLength(1);
    expect(result.audit?.entries.map(entry => entry.requestedKey)).toEqual(['OLD-1', 'TEST-1']);
    expect(result.audit?.duplicates).toBe(1);
    expect(gateway.getHistory).toHaveBeenCalledTimes(1);
  });
  it('AC-028: неполный impediment не стирает доказанный TTM, начальное Открыто не становится ошибкой', async () => {
    const { service, gateway } = await serviceSetup();
    gateway.getIssue.mockImplementation(async key => key === 'TEST-4' || key === '10004'
      ? jiraIssue({ id: '10004', key: 'TEST-4', currentStatus: '[HF] Открыт' }) : jiraIssue());
    gateway.getHistory.mockImplementation(async issue => issue.key === 'TEST-4'
      ? jiraHistory({ key: 'TEST-4', currentStatus: '[HF] Открыт', statusChanges: [], historyCount: 0,
        proof: { expected: 0, received: 0, terminal: true, adapterVersion: 'fake-v1' } })
      : jiraHistory({ flagCoverage: 'partial', flagAvailable: false }));
    const result = service.importKeys('TEST-1\nTEST-4'); await service.waitForIdle();
    expect(result.status).toBe('completed');
    expect(result.dataset?.epics[0]).toMatchObject({ ttmMs: 15 * 86400000, impedimentMs: null });
    expect(result.dataset?.epics[1].ttmState).toBe('not-started');
    expect(result.audit?.entries.every(entry => entry.decision === 'included')).toBe(true);
  });
  it('глобальный отказ и полная недоступность истории сохраняют прежний набор', async () => {
    const { service, gateway } = await serviceSetup();
    const prior = service.importKeys('неверный ключ'); await service.waitForIdle();
    const oldId = prior.dataset!.id;
    gateway.getIssue.mockRejectedValueOnce(new AppError('JIRA_UNAUTHORIZED', 'PAT не принят', 401));
    const denied = service.importKeys('TEST-1'); await service.waitForIdle();
    expect(denied.status).toBe('failed');
    expect(service.getDataset()?.id).toBe(oldId);
    gateway.getHistory.mockRejectedValue(new AppError('JIRA_FORBIDDEN', 'История недоступна', 403));
    const noHistory = service.importKeys('TEST-1'); await service.waitForIdle();
    expect(noHistory.status).toBe('failed');
    expect(service.getDataset()?.id).toBe(oldId);
  });
  it('локальный отказ записи и отмена до commit не заменяют прежний набор; блокировка освобождается', async () => {
    const { service, cache } = await serviceSetup();
    const prior = service.importKeys('неверный ключ'); await service.waitForIdle();
    const oldId = prior.dataset!.id;
    vi.spyOn(cache, 'write').mockRejectedValueOnce(new AppError('CACHE_WRITE', 'Не удалось сохранить кэш.', 500));
    const failed = service.importKeys('другая ошибка'); await service.waitForIdle();
    expect(failed.status).toBe('failed');
    expect(service.getDataset()?.id).toBe(oldId);
    const cancelled = service.importKeys('ещё ошибка'); service.shutdown(); await service.waitForIdle();
    expect(cancelled.status).toBe('failed');
    expect(service.getDataset()?.id).toBe(oldId);
    const recovered = service.importKeys('новая ошибка'); await service.waitForIdle();
    expect(recovered.status).toBe('completed');
  });
  it('два одновременных запуска не обходят общую блокировку', async () => {
    const { service, gateway } = await serviceSetup();
    let release!: (issue: ReturnType<typeof jiraIssue>) => void;
    gateway.getIssue.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const first = service.importKeys('TEST-1');
    try {
      expect(() => service.importKeys('TEST-2')).toThrow(/Дождитесь/);
      await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    } finally { release?.(jiraIssue()); }
    await service.waitForIdle();
    expect(first.status).toBe('completed');
  });
});

describe('KEYS-CACHE: контракт сохранённого списка', () => {
  it('AC-024: принимает источник keys и только ошибочные строки с физическим номером', () => {
    expect(jiraInputsSchema.safeParse(invalidInput()).success).toBe(true);
  });
  it('отклоняет кандидата без решения и пересекающиеся строки ошибок', () => {
    const missingDecision = invalidInput();
    missingDecision.candidates.push({ requestedKey: 'TEST-1', rows: [5] } as never);
    expect(jiraInputsSchema.safeParse(missingDecision).success).toBe(false);
    const overlapping = invalidInput();
    overlapping.candidates.push({ requestedKey: 'TEST-1', rows: [3] } as never);
    overlapping.audit.entries.push({ requestedKey: 'TEST-1', rows: [3], decision: 'unresolved', reason: 'Нет доступа' });
    expect(jiraInputsSchema.safeParse(overlapping).success).toBe(false);
  });
  it('отклоняет решение для отсутствующего кандидата и неверное число входных строк', () => {
    const extraDecision = invalidInput();
    extraDecision.audit.entries.push({ requestedKey: 'TEST-1', rows: [5], decision: 'unresolved', reason: 'Нет доступа' });
    expect(jiraInputsSchema.safeParse(extraDecision).success).toBe(false);
    const countMismatch = invalidInput();
    countMismatch.audit.inputRows = 2;
    expect(jiraInputsSchema.safeParse(countMismatch).success).toBe(false);
  });
});
