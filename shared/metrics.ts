import { canonical, DAY_MS, isStage, normalize, STAGES, statusInfo } from './statuses';
import type { EpicTimeline, Stage, StatusChange } from './types';
import type { Hierarchy, HierarchyNode } from './hierarchy';
import { eligibleHierarchyIds } from './hierarchy-view';

export type Metric = Stage | 'ttm' | 'ttmWithoutFlag' | 'open' | `extra:${string}` | `status:${string}`;
export type MetricsSource = 'history' | 'excel';
export interface MetricColumn { id: Metric; code: string; name: string }
export const TTM_LABELS = ['[hf] time to market', 'time to market', 'ttm', 'значение ттм'];
export const PREVIOUS_TTM_LABEL = 'ттм на начало недели';
export function isAggregateLabel(label: string): boolean {
  const name = canonical(label);
  return !/\[df\]/i.test(name) && (/cycle time|time to market/i.test(name) || TTM_LABELS.includes(name) || name === PREVIOUS_TTM_LABEL);
}
export const BASE_METRICS: MetricColumn[] = [
  { id: 'ttm', code: 'TTM', name: 'Time to Market' },
  { id: 'ttmWithoutFlag', code: 'TTM−⚑', name: 'TTM без флага' },
  { id: 'open', code: '↩О', name: 'Возврат в открыто' }, ...STAGES,
];
export const isOpenStatus = (status: string) => ['открыт', 'открыто', 'открыта', 'open'].includes(canonical(status).replace(/^\[(hf|df)\]\s*/, ''));
/** Names observed by the cutoff, not later destinations or zero-filled duration records. */
export function observedStatuses(changes: StatusChange[], current: string | undefined, asOf: string): string[] {
  const sorted = [...changes].sort((a,b) => Date.parse(a.at)-Date.parse(b.at) || (a.order ?? 0)-(b.order ?? 0));
  return [sorted[0]?.from ?? current, ...sorted.filter(c => Date.parse(c.at) <= Date.parse(asOf)).flatMap(c => [c.from,c.to])].filter((s): s is string => !!s);
}
function hasReturn(statuses: string[]): boolean {
  let leftOpen = false;
  for (const status of statuses) { if (isOpenStatus(status) && leftOpen) return true; if (!isOpenStatus(status)) leftOpen = true; }
  return false;
}
function statusColumn(status: string, allowRaw: boolean): MetricColumn | undefined {
  const kind = statusInfo(status).kind;
  if (isStage(kind)) return STAGES.find(s => s.id === kind);
  if (kind === 'closed' || isOpenStatus(status) || !allowRaw) return undefined;
  return { id: `status:${canonical(status)}`, name: normalize(status), code: '·' };
}
function aggregateColumn(label: string): MetricColumn | undefined {
  const name = canonical(label);
  if (!name.startsWith('cycle time [hf] ')) return undefined;
  const status = name.slice('cycle time [hf] '.length);
  if (isOpenStatus(status)) return undefined;
  return STAGES.find(s => canonical(s.name) === status) ?? { id: `extra:${name}`, code: '?', name: normalize(label).replace(/^cycle time\s*\[hf\]\s*/i, '') };
}
export function metricsFor(epics: EpicTimeline[], source: MetricsSource, hierarchy?: Hierarchy): MetricColumn[] {
  const columns = new Map<Metric, MetricColumn>();
  const add = (column: MetricColumn | undefined) => { if (column && !columns.has(column.id)) columns.set(column.id,column); };
  if (source === 'history') {
    for (const epic of epics) {
      if (epic.ttmState === 'not-present') continue;
      const statuses = observedStatuses(epic.transitions,epic.metadata?.currentStatus,epic.asOf);
      for (const status of statuses) add(statusColumn(status,false));
      if (epic.intervals.some(i => i.kind === 'open') || epic.returnToOpenMs !== null && epic.returnToOpenMs > 0 ||
        epic.ttmState === 'indeterminate' && hasReturn(statuses)) add(BASE_METRICS[2]);
    }
    if (hierarchy) {
      const roots = new Set(Object.values(hierarchy.roots)), children = new Set(hierarchy.edges.map(e => e.child));
      // Root histories already have the stricter root TTM/return policy above.
      for (const id of eligibleHierarchyIds(hierarchy)) {
        if (roots.has(id) && !children.has(id)) continue;
        const node=hierarchy.nodes[id];
        if (node.timeline.state === 'not-present') continue;
        const statuses = node.timeline.state === 'complete' ? node.timeline.intervals.map(i=>i.status)
          : observedStatuses(node.history?.statusChanges ?? [],node.currentStatus,hierarchy.asOf);
        for (const status of statuses) add(statusColumn(status,true));
        if (hasReturn(statuses)) add(BASE_METRICS[2]);
      }
    }
  } else {
    for (const epic of epics) for (const label of epic.summary.excelColumns ?? Object.keys(epic.summary.excelAggregates)) {
      const column=aggregateColumn(label);
      if (column && (metricValue(epic,column.id,'excel') ?? 0) > 0) add(column);
    }
  }
  const known = BASE_METRICS.slice(2).filter(c=>columns.has(c.id));
  const extra = [...columns.values()].filter(c=>c.id.startsWith('extra:') || c.id.startsWith('status:'));
  if(source==='history')extra.sort((a,b)=>a.id.localeCompare(b.id,'ru'));
  return [...BASE_METRICS.slice(0,2),...known,...extra];
}
export function metricValue(epic: EpicTimeline, metric: Metric, source: MetricsSource): number | null {
  if (metric.startsWith('status:')) return source==='history' && epic.provenIntervals
    ? epic.provenIntervals.filter(i=>canonical(i.status)===metric.slice(7)).reduce((sum,i)=>sum+i.durationMs,0) : null;
  if (metric.startsWith('extra:')) {
    if (source !== 'excel') return null;
    const values = Object.entries(epic.summary.excelAggregates).filter(([key]) => canonical(key) === metric.slice(6));
    return values.length === 1 ? values[0][1] * DAY_MS : null;
  }
  if (source === 'history') return metric === 'ttm' ? epic.ttmMs : metric === 'ttmWithoutFlag' ? epic.ttmWithoutFlagMs ?? null
    : metric === 'open' ? epic.returnToOpenMs : epic.durations?.[metric as Stage] ?? null;
  if (metric === 'open' || metric === 'ttmWithoutFlag') return null;
  const stage = STAGES.find(s => s.id === metric);
  const expected = metric === 'ttm' ? TTM_LABELS : stage ? [`cycle time [hf] ${canonical(stage.name)}`] : [];
  const values = Object.entries(epic.summary.excelAggregates).filter(([key]) => expected.includes(canonical(key)));
  return values.length === 1 ? values[0][1] * DAY_MS : null;
}
export function relatedMetricValue(node: HierarchyNode, metric: Metric): number | null {
  if (node.timeline.state !== 'complete' || metric==='ttm' || metric==='ttmWithoutFlag' || metric.startsWith('extra:')) return null;
  let leftOpen=false, total=0;
  for(const interval of node.timeline.intervals) {
    const open=isOpenStatus(interval.status);
    if(metric==='open') { if(open && leftOpen)total+=interval.durationMs; }
    else if(metric.startsWith('status:') ? canonical(interval.status)===metric.slice(7) : statusInfo(interval.status).kind===metric) total+=interval.durationMs;
    if(!open)leftOpen=true;
  }
  return total;
}
export function metricUnavailableReason(epic: EpicTimeline, metric: Metric, source: MetricsSource): string {
  if(source==='excel')return metric==='ttmWithoutFlag' ? 'Нет точной истории флага в агрегатах Excel; выберите «История»' : 'Нет исходного значения в Excel';
  if(metric==='ttmWithoutFlag' && epic.ttmMs!==null)return 'История флага не подтверждена';
  if(epic.ttmState==='not-started' && (metric==='ttm' || metric==='ttmWithoutFlag'))return 'TTM ещё не начат';
  return epic.warnings.find(w=>w.severity==='error')?.message ?? 'Нет доказанных данных для расчёта';
}
