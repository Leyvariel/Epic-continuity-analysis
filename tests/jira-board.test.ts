import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ServerJiraAdapter, type JiraProfile } from '../server/jira/adapter';

const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const config = { id: 1482, name: 'Доска', type: 'kanban', filter: { id: '33407' }, subQuery: { query: 'fixVersion is EMPTY' }, columnConfig: { columns: [{ name: 'В работе', statuses: [{ id: '2' }] }, { name: 'Завершено', statuses: [{ id: '3' }] }] } };
const filter = { id: '33407', jql: 'project = TEST ORDER BY Rank ASC' };
const profile = { version: '9.12.10', epicTypeIds: ['6'], flagFieldId: 'customfield_10000', flagOptionId: '10000', historyMode: 'issue-expand', flowRule: 'status-prefix', boards: [{ id: '1482', completedVisibility: 'all', configurationFingerprint: fingerprint(config), filterFingerprint: fingerprint(filter) }] } as JiraProfile;
const item = (id: string, status: string) => ({ id, key: `TEST-${id}`, fields: { status: { id: status } } });
const signal = () => new AbortController().signal;
describe('BDD: постоянная видимость Kanban-доски', () => {
  it('читает все страницы, применяет подфильтр и колонки, сохраняет завершённые; не читает истории', async () => {
    const get = vi.fn(async (path: string, params: Record<string, string>) => {
      if (path.endsWith('/configuration')) return config;
      if (path.includes('/filter/')) return filter;
      expect(params.jql).toBe('(fixVersion is EMPTY) ORDER BY key ASC');
      const startAt = Number(params.startAt);
      return { startAt, total: 3, issues: startAt === 0 ? [item('1', '2'), item('2', 'unmapped')] : [item('3', '3')] };
    });
    const board = await new ServerJiraAdapter({ get }, profile).readBoard('1482', signal());
    expect(board.complete).toBe(true);
    expect(board.candidates.map(c => c.requestedKey)).toEqual(['TEST-1', 'TEST-3']);
    expect(get.mock.calls.filter(([path]) => path.endsWith('/issue'))).toHaveLength(2);
    expect(get.mock.calls.some(([path]) => path.startsWith('/rest/api/2/issue/'))).toBe(false);
  });
  it('изменившаяся постоянная конфигурация требует новой проверки и не читается как прежняя', async () => {
    const get = vi.fn().mockResolvedValue({ ...config, subQuery: { query: '' } });
    await expect(new ServerJiraAdapter({ get }, profile).readBoard('1482', signal())).rejects.toMatchObject({ code: 'BOARD_PROFILE_CHANGED' });
    expect(get).toHaveBeenCalledTimes(1);
  });
  it('смена фильтра между страницами не публикует набор', async () => {
    let reads = 0;
    const get = vi.fn(async (path: string) => {
      if (path.endsWith('/configuration')) return config;
      if (path.includes('/filter/')) return ++reads === 1 ? filter : { ...filter, jql: 'project = OTHER' };
      return { startAt: 0, total: 0, issues: [] };
    });
    await expect(new ServerJiraAdapter({ get }, profile).readBoard('1482', signal())).rejects.toMatchObject({ code: 'BOARD_PROFILE_CHANGED' });
  });
});
