import { canonical, DAY_MS, normalize, STAGES } from './statuses';
import type { EpicTimeline, Stage } from './types';

export type Metric = Stage | 'ttm' | 'open' | `extra:${string}`;
export type MetricsSource = 'history' | 'excel';
export interface MetricColumn { id: Metric; code: string; name: string }
export const TTM_LABELS = ['[hf] time to market', 'time to market', 'ttm', 'значение ттм'];
export const PREVIOUS_TTM_LABEL = 'ттм на начало недели';
export function isAggregateLabel(label: string): boolean {
  const name = canonical(label);
  return !/\[df\]/i.test(name) && (/cycle time|time to market/i.test(name) || TTM_LABELS.includes(name) || name === PREVIOUS_TTM_LABEL);
}
export const BASE_METRICS: MetricColumn[] = [
  { id: 'ttm', code: 'TTM', name: 'Time to Market' }, { id: 'open', code: '↩О', name: 'Возврат в открыто' }, ...STAGES,
];
export function metricsFor(epics: EpicTimeline[], source: MetricsSource): MetricColumn[] {
  if (source === 'history') return BASE_METRICS;
  const columns = new Map<Metric, MetricColumn>();
  for (const epic of epics) for (const label of epic.summary.excelColumns ?? Object.keys(epic.summary.excelAggregates)) {
    const name = canonical(label);
    if (!name.startsWith('cycle time [hf] ')) continue;
    const status = name.slice('cycle time [hf] '.length);
    if (['открыто', 'открыт', 'open'].includes(status)) continue;
    const stage = STAGES.find(stage => canonical(stage.name) === status);
    const column: MetricColumn = stage ?? { id: `extra:${name}`, code: '?', name: normalize(label).replace(/^cycle time\s*\[hf\]\s*/i, '') };
    if (!columns.has(column.id)) columns.set(column.id, column);
  }
  // The workbook column order is a display order, never a chronological claim.
  return [...BASE_METRICS.slice(0, 2), ...columns.values()];
}
export function metricValue(epic: EpicTimeline, metric: Metric, source: MetricsSource): number | null {
  if (metric.startsWith('extra:')) {
    if (source !== 'excel') return null;
    const values = Object.entries(epic.summary.excelAggregates).filter(([key]) => canonical(key) === metric.slice(6));
    return values.length === 1 ? values[0][1] * DAY_MS : null;
  }
  if (source === 'history') return metric === 'ttm' ? epic.ttmMs : metric === 'open' ? epic.returnToOpenMs : epic.durations?.[metric as Stage] ?? null;
  // Initial Open is inseparable from returns in aggregate exports. Never relabel it ↩О.
  if (metric === 'open') return null;
  const expected = metric === 'ttm' ? TTM_LABELS : [`cycle time [hf] ${canonical(STAGES.find(s => s.id === metric)!.name)}`];
  const values = Object.entries(epic.summary.excelAggregates).filter(([key]) => expected.includes(canonical(key)));
  return values.length === 1 ? values[0][1] * DAY_MS : null;
}
