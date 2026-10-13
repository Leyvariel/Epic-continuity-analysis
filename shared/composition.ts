import { metricValue, type MetricColumn } from './metrics';
import { DAY_MS, STAGES } from './statuses';
import type { EpicTimeline } from './types';

export interface CompositionSegment extends MetricColumn {
  durationMs: number;
  offsetMs: number;
  color: string;
  text: string;
  unknown: boolean;
}
export interface Composition {
  segments: CompositionSegment[];
  totalMs: number | null;
  ttmMs: number | null;
  missing: MetricColumn[];
}

/** A sum of provided aggregates. Deliberately has no dates or status intervals. */
export function compositionFor(epic: EpicTimeline, columns: MetricColumn[]): Composition {
  const segments: CompositionSegment[] = [], missing: MetricColumn[] = [];
  let offsetMs = 0;
  for (const column of columns) {
    if (column.id === 'ttm' || column.id === 'open') continue;
    const value = metricValue(epic, column.id, 'excel');
    if (value === null || !Number.isFinite(value) || value < 0) { missing.push(column); continue; }
    const stage = STAGES.find(stage => stage.id === column.id);
    segments.push({ ...column, durationMs: value, offsetMs, color: stage?.color ?? '#d1d5db', text: stage?.text ?? '#374151', unknown: !stage });
    offsetMs += value;
  }
  return { segments, missing, totalMs: segments.length ? offsetMs : null, ttmMs: metricValue(epic, 'ttm', 'excel') };
}

/** Shared absolute scale for the whole dataset, retained when filtering rows. */
export function compositionScale(compositions: Composition[]): { maxMs: number; ticks: number[] } {
  const maximum = Math.max(0, ...compositions.flatMap(item => [item.totalMs ?? 0, item.ttmMs ?? 0]));
  if (!Number.isFinite(maximum) || maximum === 0) return { maxMs: DAY_MS, ticks: [0, DAY_MS / 2, DAY_MS] };
  const roughStep = maximum / DAY_MS / 5;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const step = [1, 2, 5, 10].find(n => n * magnitude >= roughStep)! * magnitude * DAY_MS;
  const count = Math.ceil(maximum / step);
  return { maxMs: count * step, ticks: Array.from({ length: count + 1 }, (_, i) => i * step) };
}
