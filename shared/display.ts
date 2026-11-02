import type { EpicTimeline, StatusInterval } from './types';
export function displayIntervals(epic: EpicTimeline): (StatusInterval & { role: 'initial-open' | 'before-ttm' | 'ttm' | 'excluded' | 'unknown-ttm' })[] {
  if (epic.ttmState === 'indeterminate' && epic.provenIntervals) return epic.provenIntervals.map(interval => ({ ...interval, role: 'unknown-ttm' as const }));
  return [
    ...(epic.initialOpenIntervals ?? []).map(interval => ({ ...interval, code: 'Открыто', openEnded: false, role: 'initial-open' as const })),
    ...(epic.preTtmIntervals ?? []).map(interval => ({ ...interval, code: interval.status, openEnded: false, role: 'before-ttm' as const })),
    ...epic.intervals.map(interval => ({ ...interval, role: interval.kind === 'deferred' ? 'excluded' as const : 'ttm' as const })),
  ].sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || (a.order ?? 0) - (b.order ?? 0));
}
