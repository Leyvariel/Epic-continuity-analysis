import { describe, expect, it, vi } from 'vitest';
import { verifyBoardSample } from '../scripts/verify-jira-sample';
describe('G0: ограниченная выборка и очищенная история', () => {
  it('dry-run не вызывает сеть и Keychain', async () => {
    const credentials = vi.fn(), get = vi.fn(), save = vi.fn();
    expect((await verifyBoardSample(false, { credentials, get, save })).mode).toBe('dry-run');
    expect(credentials).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
  });
  it('не читает больше трёх историй и не сохраняет авторов или произвольные изменения', async () => {
    const issue = (i: number) => ({ id: String(i), key: `TEST-${i}`, fields: { summary: 'Тест', status: { id: '1', name: '[HF] Открыт' }, issuetype: { id: '2', name: 'Эпик' }, resolution: null, created: '2026-09-01T00:00:00Z', updated: '2026-09-01T00:00:00Z', customfield_10000: [] } });
    const get = vi.fn().mockImplementation(async (url: string) => url.includes('/filter/') ? { id: '33407', name: 'Filter', jql: 'project = TEST' } : url.includes('/board/') ? { startAt: 0, total: 4, maxResults: 50, issues: [1, 2, 3, 4].map(issue) } : { ...issue(Number(url.split('/').at(-1))), changelog: { startAt: 0, total: 1, maxResults: 1, histories: [{ id: '1', created: '2026-09-01T00:00:00Z', author: 'secret-marker', items: [{ field: 'description', fromString: 'secret-marker', toString: 'secret-marker' }] }] } });
    const save = vi.fn();
    const result = await verifyBoardSample(true, { credentials: async () => 'secret-marker', get, save });
    expect(get.mock.calls.filter(c => c[0].startsWith('/rest/api/2/issue/'))).toHaveLength(3);
    expect(JSON.stringify(result)).not.toContain('secret-marker'); expect(JSON.stringify(save.mock.calls)).not.toContain('secret-marker');
  });
});
