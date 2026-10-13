import { expect, it } from 'vitest';
import { segmentLabels } from '../shared/layout';
import { dateTime } from '../shared/calendar';
import type { StatusInterval } from '../shared/types';

it('keeps exact widths and separates labels for simultaneous narrow segments', () => {
  const start = Date.parse('2026-09-02T09:00:00Z');
  const intervals: StatusInterval[] = Array.from({ length: 40 }, (_, i) => ({
    start: new Date(start + i * 125).toISOString(), end: new Date(start + (i + 1) * 125).toISOString(),
    status: '[HF] Реализация', kind: 'implementation', code: 'Р', durationMs: 125, openEnded: false,
  }));
  const labels = segmentLabels(intervals, start, 26);
  expect(labels[0].width).toBeCloseTo(125 / 86400000 * 26, 12);
  expect(labels.every(label => label.narrow)).toBe(true);
  for (const lane of [0, 1, 2]) {
    const members = labels.filter(label => label.lane === lane);
    for (let i = 1; i < members.length; i++) expect(members[i].labelLeft).toBeGreaterThanOrEqual(members[i - 1].labelLeft + 31);
  }
  expect(dateTime('2026-09-02T09:00:00.125Z')).toContain('12:00:00,125');
});

it('выносит длинное Открыто, сохраняя точную ширину короткого интервала', () => {
  const interval: StatusInterval = { status: 'Открыто', kind: 'open', code: 'Открыто', start: '2026-09-01T00:00:00Z', end: '2026-09-02T00:00:00Z', durationMs: 86400000, openEnded: false };
  const label = segmentLabels([interval], Date.parse(interval.start), 30)[0];
  expect(label.narrow).toBe(true); expect(label.width).toBe(30);
});
