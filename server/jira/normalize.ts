import { canonical } from '../../shared/statuses';
import type { HistorySnapshot } from '../../shared/contracts';
import type { EpicSummary, EpicTimeline, StatusChange } from '../../shared/types';
import { calculateTimeline, unavailableTimeline } from '../timeline';

export function orderedChanges(changes: StatusChange[]): StatusChange[] {
  return [...changes].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.order !== undefined && b.order !== undefined ? a.order - b.order : a.id.localeCompare(b.id, 'en', { numeric: true })));
}
export function sameStatus(a: string, b: string, aId?: string, bId?: string) {
  return aId && bId ? aId === bId : canonical(a) === canonical(b);
}
export function calculateJiraTimeline(summary: EpicSummary, history: HistorySnapshot, asOf: string): EpicTimeline {
  const { statusChanges, flagChanges: _flags, warnings, ...metadata } = history;
  const unavailable = (code: string, message: string): EpicTimeline => ({
    ...unavailableTimeline(summary, asOf, [...warnings, { code, message, severity: 'error', key: summary.key }]), metadata,
    statusCoverage: history.statusCoverage === 'unavailable' ? 'unavailable' : 'partial', flagCoverage: history.flagCoverage,
    transitions: orderedChanges(statusChanges), lastImportedAt: history.importedAt,
  });
  if (Date.parse(history.historyStart) > Date.parse(asOf)) return { ...unavailable('AFTER_CUTOFF', 'Эпик создан после момента среза.'), ttmState: 'not-present' };
  if (history.statusCoverage !== 'complete' || !history.initialStateProven || !history.proof.terminal || history.proof.expected !== history.proof.received || !history.proof.adapterVersion) return unavailable('INCOMPLETE_HISTORY', 'Полная история и её начальное состояние не подтверждены.');
  const changes = orderedChanges(statusChanges);
  let status = changes[0]?.from ?? history.currentStatus, statusId = changes[0]?.fromId;
  let cursor = Date.parse(history.historyStart);
  const seen = new Set<string>();
  for (const change of changes) {
    const time = Date.parse(change.at);
    if (!Number.isFinite(time) || time < cursor || seen.has(change.id) || !sameStatus(status, change.from, statusId, change.fromId)) return unavailable('BROKEN_STATUS_HISTORY', 'В полной цепочке переходов обнаружен разрыв или дубликат.');
    seen.add(change.id); status = change.to; statusId = change.toId; cursor = time;
  }
  if (!sameStatus(status, history.currentStatus, statusId, history.currentStatusId)) return unavailable('STATUS_MISMATCH', 'История не согласуется с наблюдавшимся последним статусом.');
  const flags = [...history.flagChanges].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id, 'en', { numeric: true }));
  let flag = flags[0]?.from ?? history.currentFlag, flagCursor = Date.parse(history.historyStart), flagValid = true;
  const flagIds = new Set<string>();
  for (const change of flags) {
    const time = Date.parse(change.at);
    if (!Number.isFinite(time) || time < flagCursor || flagIds.has(change.id) || change.from !== flag) flagValid = false;
    flagIds.add(change.id); flag = change.to; flagCursor = time;
  }
  if (flag !== history.currentFlag) flagValid = false;
  const flagCoverage = history.flagCoverage === 'complete' && !flagValid ? 'partial' : history.flagCoverage;
  const epic = calculateTimeline(summary, { ...history, statusChanges: changes, flagAvailable: history.flagAvailable && flagCoverage === 'complete' }, asOf, { preTtmStatuses: ['Решили делать'], independentStageDurations: true });
  if (flagCoverage !== 'complete') {
    epic.quality = 'partial';
    epic.warnings.push({ code: 'FLAG_HISTORY_INCOMPLETE', message: 'Полнота истории impediment не подтверждена; история статусов оценена отдельно.', key: summary.key, severity: 'error' });
  }
  return { ...epic, statusCoverage: 'complete', flagCoverage };
}
