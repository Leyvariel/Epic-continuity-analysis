import { describe, expect, it } from 'vitest';
import { calculateTimeline } from '../server/timeline';
import { calendarRange } from '../shared/calendar';
import { displayIntervals } from '../shared/display';
import { DAY_MS } from '../shared/statuses';
import { AS_OF, snapshot, summary } from './fixtures';

describe('AC-06: Дано первоначальное Открыто → при расчёте оно видно вне TTM', () => {
  it('только Открыто: календарь есть, TTM ещё не начат', () => {
    const epic = calculateTimeline(summary, snapshot({ currentStatus: '[HF] Открыт', statusChanges: [] }), AS_OF);
    expect(epic.ttmState).toBe('not-started');
    expect(epic.ttmMs).toBeNull();
    expect(epic.durations).toBeNull();
    expect(epic.isOpen).toBe(false);
    expect(epic.initialOpenIntervals).toHaveLength(1);
    expect(displayIntervals(epic)[0]).toMatchObject({ role: 'initial-open', code: 'Открыто', durationMs: 17 * DAY_MS, openEnded: false });
    expect(calendarRange([epic], AS_OF).start).toBeLessThan(Date.parse(snapshot().historyStart));
  });
  it('Открыто перед работой не меняет прежние метрики', () => {
    const epic = calculateTimeline(summary, snapshot(), AS_OF);
    expect(epic.ttmState).toBe('finished');
    expect(epic.initialOpenIntervals[0].durationMs).toBe(DAY_MS);
    expect(epic.ttmMs).toBe(15 * DAY_MS);
    expect(displayIntervals(epic).map(i => i.role)).toEqual(['initial-open', 'ttm', 'ttm']);
  });
  it('первый активный переход ровно на срезе даёт running и числовой ноль', () => {
    const epic = calculateTimeline(summary, snapshot({ currentStatus: '[HF] Подготовка', statusChanges: [
      { id: '1', at: AS_OF, from: '[HF] Открыт', to: '[HF] Подготовка' },
    ] }), AS_OF);
    expect(epic.ttmState).toBe('running');
    expect(epic.ttmMs).toBe(0);
  });
  it('неизвестное начало и разрыв не превращаются в первоначальное Открыто', () => {
    const epic = calculateTimeline(summary, snapshot({ currentStatus: '[HF] Открыт', statusChanges: [
      { id: '1', at: AS_OF, from: 'Неизвестно', to: '[HF] Открыт' },
    ] }), AS_OF);
    expect(epic.ttmState).toBe('indeterminate');
    expect(epic.initialOpenIntervals).toEqual([]);
  });
});
