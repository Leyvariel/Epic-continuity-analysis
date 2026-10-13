import { describe, expect, it, vi } from 'vitest';
import { collectPages } from '../server/jira/pagination';
describe('Дано несколько страниц → полный набор либо явная ошибка', () => {
  it('следует фактическому размеру страницы, а не запрошенному', async () => {
    const load = vi.fn().mockResolvedValueOnce({ startAt: 0, total: 3, values: [{ id: '1' }, { id: '2' }] }).mockResolvedValueOnce({ startAt: 2, total: 3, values: [{ id: '3' }] });
    expect((await collectPages(load, { maxItems: 10, maxPages: 10 })).map(v => v.id)).toEqual(['1', '2', '3']);
    expect(load.mock.calls.map(c => c[0])).toEqual([0, 2]);
  });
  it('изменённый total, повтор, ложный offset, ранняя пустая страница и лимит не дают успешное усечение', async () => {
    for (const page of [{ startAt: 1, total: 3, values: [{ id: '2' }] }, { startAt: 1, total: 2, values: [{ id: '1' }] }, { startAt: 0, total: 2, values: [{ id: '2' }] }, { startAt: 1, total: 2, values: [] }]) {
      const load = vi.fn().mockResolvedValueOnce({ startAt: 0, total: 2, values: [{ id: '1' }] }).mockResolvedValue(page);
      await expect(collectPages(load, { maxItems: 10, maxPages: 10 })).rejects.toThrow();
    }
    await expect(collectPages(async () => ({ startAt: 0, total: 100, values: [{ id: '1' }] }), { maxItems: 10, maxPages: 10 })).rejects.toThrow();
  });
});
