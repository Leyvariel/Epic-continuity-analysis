import { canonical, emptyDurations, isActive, isStage, statusInfo } from '../shared/statuses';
import type { DataWarning, EpicSummary, EpicTimeline, TableHistory, StatusInterval } from '../shared/types';

export function unavailableTimeline(summary: EpicSummary, asOf: string, warnings: DataWarning[]): EpicTimeline {
  return { summary, ttmState: 'indeterminate', initialOpenIntervals: [], metadata: null, quality: 'partial', asOf, lastImportedAt: null, start: null, end: null,
    ttmMs: null, ttmWithoutFlagMs: null, ttmFlaggedMs: null, excludedDeferredMs: null,
    isOpen: false, returnToOpenMs: null, durations: null, provenIntervals: null, intervals: [], impediments: [],
    impedimentMs: null, transitions: [], warnings };
}

export function calculateTimeline(summary: EpicSummary, snapshot: TableHistory, asOf: string): EpicTimeline {
  const { statusChanges, flagChanges, warnings: snapshotWarnings, ...metadata } = snapshot;
  const warnings: DataWarning[] = [...snapshotWarnings];
  const warn = (code: string, message: string, severity: 'warning' | 'error' = 'warning') => warnings.push({ code, message, severity, key: summary.key });
  const cutoff = Date.parse(asOf);
  const created = Date.parse(snapshot.historyStart);
  const sorted = [...statusChanges].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.order !== undefined && b.order !== undefined ? a.order - b.order : a.id.localeCompare(b.id, 'en', { numeric: true })));
  const result: EpicTimeline = { ...unavailableTimeline(summary, asOf, warnings), metadata, transitions: sorted, lastImportedAt: snapshot.importedAt };
  if (!Number.isFinite(cutoff) || !Number.isFinite(created) || created > cutoff) {
    warn('INVALID_DATES', 'Нет корректного интервала между началом предоставленной истории и asOf.', 'error'); return result;
  }
  let current = sorted[0]?.from ?? snapshot.currentStatus;
  let currentId = sorted[0]?.fromId;
  let cursor = created;
  // Prove the complete supplied chain before taking a historical slice.
  const seen = new Set<string>();
  for (const change of sorted) {
    const at = Date.parse(change.at);
    if (!Number.isFinite(at) || at < cursor || seen.has(change.id) ||
      (currentId && change.fromId ? currentId !== change.fromId : canonical(current) !== canonical(change.from))) {
      warn('BROKEN_STATUS_HISTORY', 'История статусов содержит разрыв, повтор или некорректную дату. TTM не рассчитан.', 'error'); return result;
    }
    seen.add(change.id); current = change.to; currentId = change.toId; cursor = at;
  }
  if (currentId && snapshot.currentStatusId ? currentId !== snapshot.currentStatusId : canonical(current) !== canonical(snapshot.currentStatus)) {
    warn('STATUS_MISMATCH', 'Последний переход не совпадает с последним статусом таблицы. TTM не рассчитан.', 'error'); return result;
  }
  current = sorted[0]?.from ?? snapshot.currentStatus;
  currentId = sorted[0]?.fromId; cursor = created;
  const all: StatusInterval[] = [];
  const append = (status: string, start: number, end: number) => {
    const info = statusInfo(status);
    all.push({ order: all.length, status, kind: info.kind, code: info.code, start: new Date(start).toISOString(), end: new Date(end).toISOString(), durationMs: end - start, openEnded: false });
  };
  for (const change of sorted) {
    const at = Date.parse(change.at);
    if (!Number.isFinite(at) || at < cursor || (currentId && change.fromId ? currentId !== change.fromId : canonical(change.from) !== canonical(current))) {
      warn('BROKEN_STATUS_HISTORY', 'История статусов содержит разрыв или некорректную дату. TTM не рассчитан.', 'error'); return result;
    }
    if (at > cutoff) break;
    append(current, cursor, at);
    cursor = at;
    current = change.to;
    currentId = change.toId;
  }
  // A snapshot may contain later transitions. Reconstruct at asOf, never extend into the future.
  if (!sorted.some(change => Date.parse(change.at) > cutoff) && (currentId && snapshot.currentStatusId ? currentId !== snapshot.currentStatusId : canonical(current) !== canonical(snapshot.currentStatus))) {
    warn('STATUS_MISMATCH', 'Последний переход не совпадает с последним статусом таблицы. TTM не рассчитан.', 'error'); return result;
  }
  append(current, cursor, cutoff);
  const project = summary.key.split('-')[0].toUpperCase();
  const startIndex = all.findIndex(segment => isActive(segment.kind, project));
  const isPreTtm = (segment: StatusInterval) => segment.kind === 'deferred' || (segment.kind === 'decided' && project !== 'HOTELS');
  const isOpen = statusInfo(current).kind !== 'closed';
  const provenIntervals = all.slice(0, isOpen ? undefined : -1);
  result.provenIntervals = provenIntervals;
  const durations = emptyDurations();
  for (const interval of provenIntervals) if (isStage(interval.kind)) durations[interval.kind] += interval.durationMs;
  result.durations = durations;
  if (startIndex < 0) {
    if (all.every(segment => segment.kind === 'open' || isPreTtm(segment))) {
      result.initialOpenIntervals = all.filter(segment => segment.kind === 'open');
      result.preTtmIntervals = all.filter(isPreTtm);
      result.ttmState = 'not-started';
      result.quality = warnings.some(w => w.severity === 'error') ? 'partial' : 'complete';
      return result;
    }
    warn('NO_ACTIVE_STATUS', 'В истории нет активного HF-статуса; начало TTM неизвестно.');
    return result;
  }
  if (all.slice(0, startIndex).some(segment => segment.kind !== 'open' && !isPreTtm(segment) && segment.durationMs > 0)) {
    // Full status proof is independent of whether the TTM boundary is known.
    warn('AMBIGUOUS_TTM_START', 'До первого известного активного HF-статуса есть неизвестный статус или закрытие. Начало TTM нельзя определить надёжно.', 'error');
    return result;
  }
  result.initialOpenIntervals = all.slice(0, startIndex).filter(segment => segment.kind === 'open');
  result.preTtmIntervals = all.slice(0, startIndex).filter(isPreTtm);
  // Consecutive closed-to-closed entries end at the LAST explicit entry into closed.
  const end = isOpen ? cutoff : cursor;
  const start = Date.parse(all[startIndex].start);
  const intervals = all.slice(startIndex, isOpen ? undefined : -1);
  if (!intervals.length || end < start) {
    warn('INVALID_TTM', 'Невозможно определить границы TTM.', 'error'); return result;
  }
  intervals.forEach((segment, index) => {
    segment.openEnded = isOpen && index === intervals.length - 1;
    if (segment.kind === 'unknown') warn('UNKNOWN_STATUS', `Неизвестный или смешанный статус сохранён: ${segment.status}.`);
    if (segment.kind === 'closed') warn('REOPENED', 'Внутри TTM есть промежуточное закрытие; его длительность сохранена.');
    if (segment.kind === 'open' && segment.openEnded) warn('OPEN_RETURN_PENDING', 'Эпик вернулся в Открыто и пока не вернулся в активный статус.');
  });
  const excludedDeferredMs = intervals.filter(s => s.kind === 'deferred').reduce((sum, s) => sum + s.durationMs, 0);
  Object.assign(result, { start: new Date(start).toISOString(), end: new Date(end).toISOString(), ttmMs: end - start - excludedDeferredMs, excludedDeferredMs,
    isOpen, ttmState: isOpen ? 'running' : 'finished', intervals, durations, returnToOpenMs: intervals.filter(s => s.kind === 'open').reduce((sum, s) => sum + s.durationMs, 0) });
  if (intervals.reduce((sum, interval) => sum + interval.durationMs, 0) !== end - start) {
    warn('COVERAGE_ERROR', 'Сегменты не покрывают TTM полностью.', 'error');
    return { ...unavailableTimeline(summary, asOf, warnings), metadata, transitions: sorted, lastImportedAt: snapshot.importedAt };
  }

  if (!snapshot.flagAvailable) {
    warn('MISSING_IMPEDIMENT_FIELD', 'Поле impediment недоступно. Длительность флага неизвестна.', 'error');
  } else {
    const flags = [...flagChanges].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id, 'en', { numeric: true }));
    let flagged = flags[0]?.from ?? snapshot.currentFlag;
    let flagCursor = created;
    let valid = true;
    const flagIds = new Set<string>();
    for (const change of flags) {
      const at = Date.parse(change.at);
      if (!Number.isFinite(at) || at < flagCursor || flagIds.has(change.id) || change.from !== flagged) { valid = false; break; }
      flagIds.add(change.id); flagged = change.to; flagCursor = at;
    }
    if (flagged !== snapshot.currentFlag) valid = false;
    flagged = flags[0]?.from ?? snapshot.currentFlag; flagCursor = created;
    const addFlag = (from: number, to: number, ongoing: boolean) => {
      const clippedStart = Math.max(from, start), clippedEnd = Math.min(to, end);
      if (clippedEnd > clippedStart || (from === to && from >= start && from <= end)) result.impediments.push({ start: new Date(clippedStart).toISOString(), end: new Date(clippedEnd).toISOString(), durationMs: clippedEnd - clippedStart, openEnded: ongoing && isOpen && clippedEnd === end });
    };
    for (const change of flags) {
      const at = Date.parse(change.at);
      if (!Number.isFinite(at) || at < flagCursor || change.from !== flagged) { valid = false; break; }
      if (at > cutoff) break;
      if (flagged) addFlag(flagCursor, at, false);
      flagged = change.to;
      flagCursor = at;
    }
    if (!flags.some(f => Date.parse(f.at) > cutoff) && flagged !== snapshot.currentFlag) valid = false;
    if (valid) {
      if (flagged) addFlag(flagCursor, cutoff, true);
      result.impedimentMs = result.impediments.reduce((sum, interval) => sum + interval.durationMs, 0);
      // Valid status and flag chains are disjoint partitions; intersections cannot double count.
      result.ttmFlaggedMs = intervals.filter(s => s.kind !== 'deferred').reduce((sum, segment) => sum +
        result.impediments.reduce((flagSum, flag) => flagSum + Math.max(0,
          Math.min(Date.parse(segment.end), Date.parse(flag.end)) - Math.max(Date.parse(segment.start), Date.parse(flag.start))), 0), 0);
      result.ttmWithoutFlagMs = result.ttmMs! - result.ttmFlaggedMs;
    } else {
      result.impediments = [];
      warn('BROKEN_IMPEDIMENT_HISTORY', 'История impediment неполна; длительность флага неизвестна.', 'error');
    }
  }
  result.quality = warnings.some(w => w.severity === 'error') ? 'partial' : 'complete';
  return result;
}
