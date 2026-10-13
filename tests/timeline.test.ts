import { describe, expect, it } from 'vitest';
import { calculateTimeline } from '../server/timeline';
import { DAY_MS, statusInfo } from '../shared/statuses';
import { AS_OF, snapshot, summary } from './fixtures';
import type { TableHistory } from '../shared/types';

function assertCoverage(data: TableHistory) {
  const epic = calculateTimeline(summary, data, AS_OF);
  expect(epic.ttmMs).not.toBeNull();
  expect(epic.intervals.reduce((sum, s) => sum + s.durationMs, 0)).toBe(epic.ttmMs);
  for (let i = 1; i < epic.intervals.length; i++) expect(epic.intervals[i].start).toBe(epic.intervals[i - 1].end);
  expect(epic.intervals[0].start).toBe(epic.start);
  expect(epic.intervals.at(-1)!.end).toBe(epic.end);
  return epic;
}

describe('TTM intervals', () => {
  it('excludes initial Open, preserves skipped stages and ignores Excel totals', () => {
    const epic = assertCoverage(snapshot());
    expect(epic.ttmMs).toBe(15 * DAY_MS);
    expect(epic.returnToOpenMs).toBe(0);
    expect(epic.durations?.validation).toBe(0);
    expect(epic.quality).toBe('complete');
    expect(epic.isOpen).toBe(false);
  });
  it('retains repeated entries and active → Open → active separately', () => {
    const data = snapshot();
    data.statusChanges.splice(1, 0,
      { id: '1a', at: '2026-09-03T09:00:00Z', from: '[HF] Подготовка', to: '[HF] Открыт' },
      { id: '1b', at: '2026-09-04T09:00:00Z', from: '[HF] Открыт', to: '[HF] Подготовка' });
    const epic = assertCoverage(data);
    expect(epic.intervals.map(i => i.code)).toEqual(['П', '↩О', 'П', 'Р']);
    expect(epic.returnToOpenMs).toBe(DAY_MS);
    expect(epic.durations?.preparation).toBe(2 * DAY_MS);
  });
  it('retains terminal Open and ends exactly at asOf', () => {
    const data = snapshot({ currentStatus: '[HF] Открыт' });
    data.statusChanges[2].to = '[HF] Открыт';
    const epic = assertCoverage(data);
    expect(epic.returnToOpenMs).toBe(DAY_MS);
    expect(epic.end).toBe(AS_OF);
    expect(epic.intervals.at(-1)?.openEnded).toBe(true);
    expect(epic.warnings.some(w => w.code === 'OPEN_RETURN_PENDING')).toBe(true);
  });
  it('includes intermediate closure on reopening and uses final closure', () => {
    const data = snapshot({ currentStatus: '[HF] Закрыт' });
    data.statusChanges[2].at = '2026-09-06T09:00:00Z';
    data.statusChanges.push(
      { id: '4', at: '2026-09-09T09:00:00Z', from: '[HF] Закрыт', to: '[HF] Реализация' },
      { id: '5', at: '2026-09-17T09:00:00Z', from: '[HF] Реализация', to: '[HF] Закрыт' });
    const epic = assertCoverage(data);
    expect(epic.ttmMs).toBe(15 * DAY_MS);
    expect(epic.intervals.find(i => i.kind === 'closed')?.durationMs).toBe(3 * DAY_MS);
    expect(epic.warnings.some(w => w.code === 'REOPENED')).toBe(true);
  });
  it('keeps reopened ongoing epic open, including closed dwell', () => {
    const data = snapshot({ currentStatus: '[HF] Реализация' });
    data.statusChanges.push({ id: '4', at: '2026-09-18T08:00:00Z', from: '[HF] Закрыт', to: '[HF] Реализация' });
    const epic = assertCoverage(data);
    expect(epic.isOpen).toBe(true);
    expect(epic.ttmMs).toBe(16 * DAY_MS);
  });
  it('uses last final closed transition, including same-state transitions', () => {
    const data = snapshot();
    data.statusChanges.push({ id: '4', at: '2026-09-17T10:00:00Z', from: '[HF] Закрыт', to: '[HF] Закрыт' });
    expect(assertCoverage(data).end).toBe('2026-09-17T10:00:00.000Z');
  });
  it('keeps unknown / DF / mixed states as duration-bearing segments', () => {
    const data = snapshot();
    data.statusChanges.splice(2, 0,
      { id: '2a', at: '2026-09-06T09:00:00Z', from: '[HF] Реализация', to: '[DF] Разработка' },
      { id: '2b', at: '2026-09-07T09:00:00Z', from: '[DF] Разработка', to: '[HF] Реализация' });
    const epic = assertCoverage(data);
    expect(epic.intervals.find(i => i.kind === 'unknown')?.durationMs).toBe(DAY_MS);
    expect(epic.warnings.some(w => w.code === 'UNKNOWN_STATUS')).toBe(true);
    expect(statusInfo('[HF] / [DF] Реализация').kind).toBe('unknown');
    expect(statusInfo('[HF]\u00a0Подготовка ').kind).toBe('preparation');
  });
  it('preserves subsecond timestamps and several changes in one day', () => {
    const data = snapshot({ currentStatus: '[HF] Реализация', statusChanges: [
      { id: '1', at: '2026-09-02T12:00:00.123+0300', from: '[HF] Открыт', to: '[HF] Подготовка' },
      { id: '2', at: '2026-09-02T12:00:00.456+0300', from: '[HF] Подготовка', to: '[HF] Валидация' },
      { id: '3', at: '2026-09-02T12:00:00.456+0300', from: '[HF] Валидация', to: '[HF] Реализация' },
    ] });
    const epic = assertCoverage(data);
    expect(epic.intervals[0].durationMs).toBe(333);
    expect(epic.intervals[1].durationMs).toBe(0);
    expect(epic.start).toBe('2026-09-02T09:00:00.123Z');
  });
  it('reconstructs status asOf when the fetch contains later transitions', () => {
    const data = snapshot();
    data.statusChanges[2].at = '2026-09-19T09:00:00Z';
    const epic = assertCoverage(data);
    expect(epic.isOpen).toBe(true);
    expect(epic.end).toBe(AS_OF);
    expect(epic.intervals.at(-1)?.kind).toBe('implementation');
  });
  it('starts at creation for a task created directly in an active stage', () => {
    const data = snapshot({ currentStatus: '[HF] Реализация', statusChanges: [] });
    expect(assertCoverage(data).start).toBe(data.historyStart);
  });
  it('does not invent TTM for never-active or broken histories', () => {
    expect(calculateTimeline(summary, snapshot({ currentStatus: '[HF] Открыт', statusChanges: [] }), AS_OF).ttmMs).toBeNull();
    const data = snapshot(); data.statusChanges[1].from = '[HF] Валидация';
    const epic = calculateTimeline(summary, data, AS_OF);
    expect(epic.quality).toBe('partial'); expect(epic.ttmMs).toBeNull();
    expect(epic.transitions).toHaveLength(3);
  });
  it('marks mismatched current status and missing flag data incomplete', () => {
    expect(calculateTimeline(summary, snapshot({ currentStatus: 'Открыто' }), AS_OF).ttmMs).toBeNull();
    const epic = assertCoverage(snapshot({ flagAvailable: false }));
    expect(epic.quality).toBe('partial'); expect(epic.impedimentMs).toBeNull();
  });
  it('keeps short impediments without subtracting or rounding TTM', () => {
    const data = snapshot({ flagChanges: [
      { id: 'f1', at: '2026-09-04T09:00:00.000Z', from: false, to: true },
      { id: 'f2', at: '2026-09-04T09:00:00.125Z', from: true, to: false },
    ] });
    const epic = assertCoverage(data);
    expect(epic.impedimentMs).toBe(125); expect(epic.impediments).toHaveLength(1);
    expect(epic.ttmMs).toBe(15 * DAY_MS);
  });
  it('clips flags to TTM, keeps open flags and rejects broken flag chains', () => {
    const data = snapshot({ currentFlag: true });
    const epic = assertCoverage(data);
    expect(epic.impedimentMs).toBe(epic.ttmMs);
    expect(epic.impediments[0].end).toBe(epic.end);
    data.flagChanges = [{ id: 'f1', at: '2026-09-05T09:00:00Z', from: true, to: false }];
    const broken = assertCoverage(data);
    expect(broken.quality).toBe('partial'); expect(broken.impedimentMs).toBeNull();
  });
  it('covers generated reentry sequences exactly', () => {
    for (let length = 1; length < 50; length++) {
      const statuses = ['[HF] Подготовка', '[HF] Открыт', '[HF] Реализация', 'Новый статус', '[HF] Закрыт'];
      let from = '[HF] Открыт';
      const changes = Array.from({ length }, (_, index) => {
        const to = statuses[index % statuses.length];
        const entry = { id: String(index), at: new Date(Date.parse('2026-09-02T00:00:00Z') + index * 123_457).toISOString(), from, to };
        from = to; return entry;
      });
      assertCoverage(snapshot({ statusChanges: changes, currentStatus: from }));
    }
  });
});
