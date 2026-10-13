import { describe, expect, it, vi } from 'vitest';
import { verifyJira } from '../scripts/verify-jira';
describe('G0: диагностика без неявного доступа', () => {
  it('по умолчанию только план, ни PAT, ни сети, ни сохранения', async () => {
    const credentials = vi.fn(), get = vi.fn(), save = vi.fn();
    const result = await verifyJira(false, { credentials, get, save });
    expect(result.mode).toBe('dry-run');
    expect(credentials).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  });
  it('execute делает только перечисленные GET и сохраняет проекцию без PAT/сырых ответов', async () => {
    const credentials = vi.fn().mockResolvedValue('secret-marker');
    const get = vi.fn().mockImplementation(async (path: string) => {
      if (path.endsWith('/field')) return [{ id: 'customfield_1', name: 'Тип эпика', schema: { type: 'string' }, other: 'secret-marker' }];
      return { version: 'test', deploymentType: 'test', id: 1482, name: 'Board', type: 'kanban', key: 'user', raw: 'secret-marker' };
    });
    const save = vi.fn();
    const result = await verifyJira(true, { credentials, get, save });
    expect(get.mock.calls.map(c => c[0])).toEqual(['/rest/api/2/serverInfo', '/rest/api/2/myself', '/rest/api/2/field', '/rest/agile/1.0/board/1482/configuration']);
    expect(credentials).toHaveBeenCalledTimes(1); expect(save).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('secret-marker'); expect(JSON.stringify(save.mock.calls)).not.toContain('secret-marker');
    expect(result.mode).toBe('metadata-only');
  });
});
