import type { Stage } from './types';

export type Heat = 'none' | 'blue' | 'green' | 'yellow' | 'orange' | 'red' | 'burgundy';
export const HEAT_COLORS: Record<Heat, string> = {
  none: 'transparent', blue: '#c6d9fa', green: '#a3e1c7', yellow: '#fff0a8',
  orange: '#ffd6ad', red: '#eda4a4', burgundy: '#8c2845',
};

// Lower bounds are inclusive, except scoring, whose 30-day boundary is explicit.
export const HEAT_BANDS: Record<Exclude<Stage, 'scoring'> | 'ttm', readonly (readonly [number, Heat])[]> = {
  ttm: [[0, 'yellow'], [60, 'orange'], [100, 'red'], [200, 'burgundy']],
  preparation: [[0, 'blue'], [1, 'green'], [10, 'yellow'], [20, 'orange'], [30, 'red'], [50, 'burgundy']],
  validation: [[0, 'blue'], [1, 'green'], [20, 'orange'], [30, 'red'], [50, 'burgundy']],
  solution: [[0, 'blue'], [1, 'green'], [20, 'yellow'], [40, 'red'], [50, 'burgundy']],
  ready: [[0, 'blue'], [1, 'green'], [10, 'yellow'], [20, 'orange'], [40, 'red'], [50, 'burgundy']],
  implementation: [[0, 'burgundy'], [1, 'green'], [30, 'yellow'], [50, 'orange'], [80, 'red'], [100, 'burgundy']],
  experiment: [[0, 'blue'], [1, 'green'], [20, 'yellow'], [30, 'orange'], [40, 'red'], [50, 'burgundy']],
  evaluation: [[0, 'blue'], [1, 'green'], [10, 'yellow'], [20, 'orange'], [30, 'red'], [40, 'burgundy']],
};

export function heatFor(metric: Stage | 'ttm' | 'open', days: number | null): Heat {
  if (days === null || !Number.isFinite(days) || days < 0 || metric === 'open') return 'none';
  if (metric === 'scoring') return days > 30 ? 'orange' : 'none';
  return HEAT_BANDS[metric].findLast(([lower]) => days >= lower)?.[1] ?? 'none';
}
