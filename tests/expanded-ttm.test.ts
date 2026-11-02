import { describe, expect, it } from 'vitest';
import { calculateTimeline } from '../server/timeline';
import { calculateJiraTimeline } from '../server/jira/normalize';
import { DAY_MS } from '../shared/statuses';
import { jiraHistory } from './jira-fixtures';
import { modelAt, modelHistory } from './status-model-fixtures';

const calc = (f: ReturnType<typeof modelHistory>) => calculateTimeline(f.summary, f.history, f.asOf);
describe('FR-010/011/013/047: independent calendar, counted TTM and flags', () => {
  it('AC-110: excludes every Deferred interval while retaining the full calendar', () => {
    const r = calc(modelHistory([['[HF] Проверка идей', 5], ['[HF] Отложено', 60], ['[HF] Реализация', 10]]));
    expect(r.ttmMs).toBe(15 * DAY_MS);
    expect(r.durations?.deferred).toBe(60 * DAY_MS);
    expect(r.excludedDeferredMs).toBe(60 * DAY_MS);
    expect(r.intervals.reduce((sum, i) => sum + i.durationMs, 0)).toBe(75 * DAY_MS);
    expect(r.ttmWithoutFlagMs).toBe(15 * DAY_MS);
  });
  it('AC-107/109: uses actual flags, not the planned-status convention', () => {
    const f = modelHistory([['[HF] Запланировано', 10], ['[HF] Проработка решения', 5]], {
      flagChanges: [{ id: 'f', at: modelAt(10), from: true, to: false }], currentFlag: false,
    });
    const r = calc(f);
    expect(r.ttmMs).toBe(15 * DAY_MS); expect(r.ttmWithoutFlagMs).toBe(5 * DAY_MS);
    expect(r.ttmFlaggedMs).toBe(10 * DAY_MS); expect(r.durations?.planned).toBe(10 * DAY_MS);
    expect(calc({ ...f, history: { ...f.history, flagChanges: [] } }).ttmWithoutFlagMs).toBe(15 * DAY_MS);
    const unknown = calc({ ...f, history: { ...f.history, flagAvailable: false } });
    expect(unknown.ttmMs).toBe(15 * DAY_MS); expect(unknown.ttmWithoutFlagMs).toBeNull();
    expect(unknown.ttmFlaggedMs).toBeNull(); expect(unknown.impedimentMs).toBeNull();
  });
  it('AC-108: does not subtract Deferred twice when it overlaps a flag', () => {
    const r = calc(modelHistory([['[HF] Проверка идей', 5], ['[HF] Отложено', 60], ['[HF] Реализация', 10]], {
      flagChanges: [{ id: '1', at: modelAt(5), from: false, to: true }, { id: '2', at: modelAt(69), from: true, to: false }],
    }));
    expect(r.ttmMs).toBe(15 * DAY_MS); expect(r.impedimentMs).toBe(64 * DAY_MS);
    expect(r.ttmFlaggedMs).toBe(4 * DAY_MS); expect(r.ttmWithoutFlagMs).toBe(11 * DAY_MS);
  });
  it('AC-111: starts Decided only for HOTELS, even without a prefix', () => {
    const f = modelHistory([['Открыто', 1], ['Решили делать', 3], ['[HF] Подготовка', 2]]);
    expect(calc(f).ttmMs).toBe(2 * DAY_MS);
    const hotels = calc({ ...f, summary: { ...f.summary, key: 'HOTELS-12351' } });
    expect(hotels.ttmMs).toBe(5 * DAY_MS); expect(hotels.durations?.decided).toBe(3 * DAY_MS);
  });
  it.each(['[HF] Проверка идей', '[HF] Запланировано', 'Тестирование эпика', 'Релиз'])('starts directly in %s', status => {
    expect(calc(modelHistory([[status, 2]])).ttmMs).toBe(2 * DAY_MS);
  });
  it('AC-007/112: Deferred before start has a duration but no TTM; current Deferred freezes TTM', () => {
    const before = calc(modelHistory([['Открыто', 20], ['[HF] Отложено', 60]], { closed: false }));
    expect(before.ttmState).toBe('not-started'); expect(before.ttmMs).toBeNull();
    expect(before.durations?.deferred).toBe(60 * DAY_MS);
    for (const days of [60, 61]) {
      const r = calc(modelHistory([['[HF] Реализация', 5], ['[HF] Отложено', days]], { closed: false }));
      expect(r.ttmMs).toBe(5 * DAY_MS); expect(r.isOpen).toBe(true);
      expect(r.durations?.deferred).toBe(days * DAY_MS);
    }
    const prior = calc(modelHistory([['[HF] Отложено', 60], ['[HF] Реализация', 5]]));
    expect(prior.ttmMs).toBe(5 * DAY_MS); expect(prior.durations?.deferred).toBe(60 * DAY_MS);
  });
  it('AC-113: preserves initial Open and counts only returns in TTM', () => {
    const r = calc(modelHistory([['Открыто', 100], ['[HF] Подготовка', 2], ['Открыто', 3], ['[HF] Реализация', 4]]));
    expect(r.ttmMs).toBe(9 * DAY_MS); expect(r.returnToOpenMs).toBe(3 * DAY_MS);
    expect(r.ttmWithoutFlagMs).toBe(9 * DAY_MS); expect(r.initialOpenIntervals[0].durationMs).toBe(100 * DAY_MS);
  });
  it('handles same-time transitions and a start exactly at the cutoff', () => {
    const r = calc(modelHistory([['Открыто', 1], ['[HF] Отложено', 0], ['[HF] Запланировано', 0]], { closed: false }));
    expect(r.ttmMs).toBe(0); expect(r.ttmWithoutFlagMs).toBe(0); expect(r.durations?.planned).toBe(0);
  });
  it('preserves partial flags independently of complete status proof', () => {
    const f = modelHistory([['[HF] Запланировано', 10], ['[HF] Реализация', 5]]);
    const r = calculateJiraTimeline(f.summary, jiraHistory({ ...f.history, proof: { expected: 2, received: 2, terminal: true, adapterVersion: 'test' }, flagCoverage: 'partial' }), f.asOf);
    expect(r.ttmMs).toBe(15 * DAY_MS); expect(r.ttmWithoutFlagMs).toBeNull();
  });
  it('keeps an actually unknown start unknown, but proves stage numbers in either source', () => {
    const r = calc(modelHistory([['Неизвестный новый процесс', 2], ['Релиз', 3]]));
    expect(r.ttmMs).toBeNull(); expect(r.ttmWithoutFlagMs).toBeNull();
    expect(r.returnToOpenMs).toBeNull(); expect(r.durations?.release).toBe(3 * DAY_MS);
  });
  it('clips flags at exact boundaries across repeated Deferred and intermediate closure', () => {
    const f = modelHistory([['Открыто', 2], ['[HF] Реализация', 2], ['[HF] Отложено', 3], ['[HF] Закрыт', 1], ['[HF] Отложено', 2], ['Релиз', 1]], { currentFlag: true });
    const r = calc(f);
    expect(r.ttmMs).toBe(4 * DAY_MS); expect(r.impedimentMs).toBe(9 * DAY_MS);
    expect(r.ttmWithoutFlagMs).toBe(0); expect(r.excludedDeferredMs).toBe(5 * DAY_MS);
  });
  it('validates all status and flag transitions even after asOf', () => {
    const f = modelHistory([['[HF] Запланировано', 2], ['Релиз', 3]]);
    f.history.statusChanges[1].from = 'Разрыв'; f.asOf = modelAt(1);
    expect(calc(f).durations).toBeNull();
    const g = modelHistory([['[HF] Запланировано', 5]], { flagChanges: [
      { id: '1', at: modelAt(3), from: false, to: true }, { id: '2', at: modelAt(4), from: false, to: false },
    ] });
    g.asOf = modelAt(1);
    expect(calc(g).ttmWithoutFlagMs).toBeNull(); expect(calc(g).ttmMs).toBe(DAY_MS);
  });
});
