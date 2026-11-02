import type { TableHistory } from '../shared/types';
import { DAY_MS } from '../shared/statuses';
import { snapshot, summary } from './fixtures';

export const modelAt = (day: number) => new Date(Date.UTC(2026, 0, 1) + day * DAY_MS).toISOString();
export function modelHistory(steps: [string, number][], options: Partial<TableHistory> & { closed?: boolean } = {}) {
  const { closed = true, ...overrides } = options;
  let day = 0;
  const statusChanges: TableHistory['statusChanges'] = [];
  steps.forEach(([status, days], index) => {
    day += days;
    const next = steps[index + 1]?.[0] ?? (closed ? '[HF] Закрыт' : undefined);
    if (next) statusChanges.push({ id: String(index + 1), order: index, at: modelAt(day), from: status, to: next });
  });
  const asOf = modelAt(day);
  const history = snapshot({ historyStart: modelAt(0), updated: asOf, importedAt: asOf,
    currentStatus: closed ? '[HF] Закрыт' : steps.at(-1)![0], statusChanges,
    historyCount: statusChanges.length, ...overrides });
  return { history, asOf, summary: { ...summary, key: history.key } };
}
