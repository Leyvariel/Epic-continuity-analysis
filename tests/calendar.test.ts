import { describe, expect, it } from 'vitest';
import { calendarRange, dateTime, moscowDate, position } from '../shared/calendar';
import { calculateTimeline } from '../server/timeline';
import { AS_OF, snapshot, summary } from './fixtures';

describe('calendar coordinates', () => {
  it('uses Moscow dates around UTC midnight and exact subday positions', () => {
    expect(moscowDate(Date.parse('2026-09-01T22:00:00Z'))).toEqual({ year: 2026, month: 9, day: 2 });
    expect(dateTime('2026-09-01T22:00:00Z')).toContain('01:00:00');
    expect(position(43200000, 0, 26)).toBe(13);
    expect(position(1000, 0, 26)).toBeCloseTo(26 / 86400, 12);
  });
  it('covers the full selection with contiguous calendar tiers', () => {
    const epic = calculateTimeline(summary, snapshot(), AS_OF);
    const range = calendarRange([epic], AS_OF);
    expect(range.start).toBeLessThan(Date.parse(epic.start!)); expect(range.end).toBeGreaterThan(Date.parse(epic.end!));
    for (const tier of [range.days, range.months, range.quarters]) {
      expect(tier[0].start).toBe(range.start); expect(tier.at(-1)!.end).toBe(range.end);
      for (let i = 1; i < tier.length; i++) expect(tier[i].start).toBe(tier[i - 1].end);
    }
  });
});
