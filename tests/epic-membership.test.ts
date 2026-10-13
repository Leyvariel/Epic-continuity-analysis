import { describe, expect, it, vi } from 'vitest';
import { ServerJiraAdapter } from '../server/jira/adapter';
import { AppError } from '../server/errors';
const profile = { version: '9.12.10' as const, epicTypeIds: ['6'], flagFieldId: 'customfield_10000', flagOptionId: '10000', historyMode: 'issue-expand' as const, flowRule: 'status-prefix' as const };
const signal = () => new AbortController().signal;
const raw = (epic = true) => ({ id: '2375238', key: 'RAIL-11361', fields: { summary: 'Тестовый эпик', issuetype: { id: epic ? '6' : '3', name: epic ? 'Эпик' : 'Задача', subtask: false }, status: { id: '1', name: '[DF] Закрыт' }, resolution: null, created: '2026-01-01T00:00:00Z', updated: '2026-02-01T00:00:00Z', issuelinks: [{ type: { outward: 'contains', inward: 'is contained in' }, outwardIssue: { id: '2496542', key: 'ANL-19960' } }] } });
const member = (id: number) => ({ id: String(id), key: `RAIL-${id}` });
const page = (startAt: number, total: number, issues: ReturnType<typeof member>[]) => ({ startAt, total, maxResults: 2, issues });

describe('Epic Link: полный состав эпика вместе с contains', () => {
  it('объединяет все страницы, убирает дубли с contains, не отфильтровывает закрытые задачи', async () => {
    const get = vi.fn(async (url: string, params: Record<string, string>) => {
      if (url.startsWith('/rest/api/2/issue/')) return raw();
      expect(url).toBe('/rest/agile/1.0/epic/2375238/issue');
      expect(params.jql).not.toMatch(/status|resolution|project|assignee/i);
      return params.startAt === '0' ? page(0, 3, [{ id: '2496542', key: 'ANL-19960' }, member(12909)]) : page(2, 3, [member(12559)]);
    });
    const issue = await new ServerJiraAdapter({ get }, profile).getIssue('RAIL-11361', signal());
    expect(issue.links?.map(edge => edge.childKey)).toEqual(['ANL-19960', 'RAIL-12909', 'RAIL-12559']);
    expect(issue.linksKnown).toBe(true);
    expect(get.mock.calls.filter(([url]) => url.includes('/epic/')).map(([, p]) => p.startAt)).toEqual(['0', '2']);
  });
  it.each(['forbidden', 'duplicate', 'empty', 'total-changed', 'limit', 'schema'])('%s: неизвестный состав не считается пустым, contains сохраняется', async mode => {
    const get = vi.fn(async (url: string, params: Record<string, string>) => {
      if (url.startsWith('/rest/api/2/issue/')) return raw();
      if (mode === 'forbidden') throw new AppError('JIRA_FORBIDDEN', 'Недостаточно прав', 403);
      if (mode === 'schema') return { issues: [] };
      if (mode === 'limit') return page(0, 10001, [member(12909)]);
      if (params.startAt === '0') return page(0, 2, [member(12909)]);
      return mode === 'duplicate' ? page(1, 2, [member(12909)]) : mode === 'empty' ? page(1, 2, []) : page(1, 1, []);
    });
    const issue = await new ServerJiraAdapter({ get }, profile).getIssue('RAIL-11361', signal());
    expect(issue.linksKnown).toBe(false);
    expect(issue.links).toEqual([{ parent: '2375238', child: '2496542', childKey: 'ANL-19960' }]);
    expect(issue.hierarchyWarnings?.some(w => w.code === 'EPIC_MEMBERSHIP_UNAVAILABLE')).toBe(true);
  });
  it.each(['JIRA_UNAUTHORIZED', 'JIRA_NETWORK', 'RATE_LIMITED', 'ABORTED'])('%s: глобальный отказ не маскируется частичным результатом', async code => {
    const get = vi.fn(async (url: string) => { if (url.startsWith('/rest/api/2/issue/')) return raw(); throw new AppError(code, 'Глобальный отказ'); });
    await expect(new ServerJiraAdapter({ get }, profile).getIssue('RAIL-11361', signal())).rejects.toMatchObject({ code });
  });
  it('обычная задача не обходит свой Epic Link или подзадачи', async () => {
    const get = vi.fn().mockResolvedValue(raw(false));
    await new ServerJiraAdapter({ get }, profile).getIssue('RAIL-11361', signal());
    expect(get).toHaveBeenCalledTimes(1);
  });
});
