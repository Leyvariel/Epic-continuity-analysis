import { describe, expect, it } from 'vitest';
import { heatFor } from '../shared/heatmap';
import type { Heat } from '../shared/heatmap';
import type { Stage } from '../shared/types';

// Explicit source-derived expectations, independent of the implementation's band table.
const thresholds: [Stage | 'ttm', [number, Heat, Heat][]][] = [
  ['ttm', [[60, 'yellow', 'orange'], [100, 'orange', 'red'], [200, 'red', 'burgundy']]],
  ['preparation', [[1, 'blue', 'green'], [10, 'green', 'yellow'], [20, 'yellow', 'orange'], [30, 'orange', 'red'], [50, 'red', 'burgundy']]],
  ['validation', [[1, 'blue', 'green'], [20, 'green', 'orange'], [30, 'orange', 'red'], [50, 'red', 'burgundy']]],
  ['solution', [[1, 'blue', 'green'], [20, 'green', 'yellow'], [40, 'yellow', 'red'], [50, 'red', 'burgundy']]],
  ['ready', [[1, 'blue', 'green'], [10, 'green', 'yellow'], [20, 'yellow', 'orange'], [40, 'orange', 'red'], [50, 'red', 'burgundy']]],
  ['implementation', [[1, 'burgundy', 'green'], [30, 'green', 'yellow'], [50, 'yellow', 'orange'], [80, 'orange', 'red'], [100, 'red', 'burgundy']]],
  ['experiment', [[1, 'blue', 'green'], [20, 'green', 'yellow'], [30, 'yellow', 'orange'], [40, 'orange', 'red'], [50, 'red', 'burgundy']]],
  ['evaluation', [[1, 'blue', 'green'], [10, 'green', 'yellow'], [20, 'yellow', 'orange'], [30, 'orange', 'red'], [40, 'red', 'burgundy']]],
];
describe('heatmap boundaries from the procedure', () => {
  for (const [metric, bands] of thresholds) for (const [threshold, before, at] of bands) {
    it(`${metric} boundary ${threshold}`, () => {
      expect(heatFor(metric, threshold - 1 / 86400)).toBe(before);
      expect(heatFor(metric, threshold)).toBe(at);
      expect(heatFor(metric, threshold + 1 / 86400)).toBe(at);
    });
  }
  it('handles scoring strictly above 30, unknowns, and uncolored Open', () => {
    expect(heatFor('scoring', 30)).toBe('none'); expect(heatFor('scoring', 30.000001)).toBe('orange');
    expect(heatFor('implementation', 0)).toBe('burgundy'); expect(heatFor('ttm', 0)).toBe('yellow');
    for (const value of [null, NaN, -1, Infinity]) expect(heatFor('ttm', value)).toBe('none');
    expect(heatFor('open', 800)).toBe('none');
  });
});
