import { AppError } from '../errors';
export async function collectPages<T extends { id: string }>(load: (startAt: number) => Promise<{ startAt: number; total: number; values: T[] }>, limits: { maxItems: number; maxPages: number }): Promise<T[]> {
  const all: T[] = [], seen = new Set<string>();
  let expected: number | undefined;
  for (let pageIndex = 0; pageIndex < limits.maxPages; pageIndex++) {
    const page = await load(all.length);
    if (!Number.isInteger(page.total) || page.total < 0 || page.startAt !== all.length || (expected !== undefined && expected !== page.total)) throw new AppError('PAGINATION_CHANGED', 'Состав или порядок страниц изменился во время чтения.');
    expected = page.total;
    if (expected > limits.maxItems || all.length + page.values.length > limits.maxItems) throw new AppError('SELECTION_TOO_LARGE', 'Выборка превышает предел; усечение не выполнено.');
    if ((!page.values.length && all.length < expected) || all.length + page.values.length > expected) throw new AppError('PAGINATION_INCOMPLETE', 'Получены не все заявленные записи.');
    for (const value of page.values) {
      if (seen.has(value.id)) throw new AppError('PAGINATION_DUPLICATE', 'На страницах повторяется задача; полнота не подтверждена.');
      seen.add(value.id); all.push(value);
    }
    if (all.length === expected) return all;
  }
  throw new AppError('PAGINATION_LIMIT', 'Достигнут предел страниц; полнота не подтверждена.');
}
