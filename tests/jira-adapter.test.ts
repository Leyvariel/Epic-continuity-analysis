import { describe, expect, it, vi } from 'vitest';
import { ServerJiraAdapter } from '../server/jira/adapter';
const profile = { version: '9.12.10' as const, epicTypeIds: ['6'], flagFieldId: 'customfield_10000', flagOptionId: '10000', historyMode: 'issue-expand' as const, flowRule: 'status-prefix' as const };
const raw = () => ({ id: '10001', key: 'TEST-1', fields: { summary: 'Тест', issuetype: { id: '6', name: 'Большая задача' }, status: { id: '2', name: '[HF] Подготовка' }, resolution: null, created: '2026-09-01T00:00:00+0300', updated: '2026-09-02T00:00:00+0300', assignee: null, customfield_10000: [{ id: '10000', value: 'Impediment' }] }, changelog: { startAt: 0, total: 2, maxResults: 2, histories: [
  { id: '10', created: '2026-09-02T00:00:00+0300', items: [{ field: 'status', from: '1', to: '2', fromString: '[HF] Открыт', toString: '[HF] Подготовка' }] },
  { id: '11', created: '2026-09-02T00:00:00+0300', items: [{ field: 'Flagged', from: null, to: '[10000]', fromString: null, toString: 'Impediment' }] },
] } });
describe('Jira Server: фактическая схема метаданных и expand=changelog', () => {
  it('сохраняет стабильные id, порядок, flags и доказательство полной истории', async () => {
    const get = vi.fn().mockResolvedValue(raw()), adapter = new ServerJiraAdapter({ get }, profile);
    const issue = await adapter.getIssue('TEST-1', new AbortController().signal);
    expect(issue).toMatchObject({ isEpic: true, flow: 'HF', id: '10001' });
    const history = await adapter.getHistory(issue, new AbortController().signal);
    expect(history.statusCoverage).toBe('complete'); expect(history.flagCoverage).toBe('complete');
    expect(history.statusChanges[0]).toMatchObject({ fromId: '1', toId: '2', order: 0 });
    expect(history.flagChanges[0]).toMatchObject({ from: false, to: true });
    expect(get.mock.calls.find(([, params]) => params.expand)?.[1].expand).toBe('changelog');
  });
  it('обрезанная или повторяющаяся история никогда не объявляется полной', async () => {
    for (const mode of ['truncated', 'duplicate']) {
      const value = raw(); if (mode === 'truncated') value.changelog.total = 100; else value.changelog.histories[1].id = '10';
      const adapter = new ServerJiraAdapter({ get: vi.fn().mockResolvedValue(value) }, profile);
      const issue = await adapter.getIssue('TEST-1', new AbortController().signal);
      expect((await adapter.getHistory(issue, new AbortController().signal)).statusCoverage).toBe('partial');
    }
  });
  it('тип Большая задача и Вид эпика не делают задачу HF без однозначного признака Jira', async () => {
    const value = raw(); value.fields.status.name = 'Решили делать';
    const adapter = new ServerJiraAdapter({ get: vi.fn().mockResolvedValue(value) }, profile);
    expect((await adapter.getIssue('TEST-1', new AbortController().signal)).flow).toBe('unknown');
  });
  it('доска без доказанной постоянной видимости недоступна независимо от работающих issue-запросов', async () => {
    const get = vi.fn(), adapter = new ServerJiraAdapter({ get }, profile);
    await expect(adapter.readBoard('1482', new AbortController().signal)).rejects.toMatchObject({ code: 'BOARD_PROFILE_UNVERIFIED' });
    expect(get).not.toHaveBeenCalled();
  });
});
