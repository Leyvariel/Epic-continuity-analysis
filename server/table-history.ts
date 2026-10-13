import * as XLSX from 'xlsx';
import { canonical, DAY_MS, normalize, statusInfo } from '../shared/statuses';
import { moscowMidnight } from '../shared/calendar';
import type { DataWarning, EpicSummary, ImportedSelection, TableHistory } from '../shared/types';
import { AppError } from './errors';

type ParsedInterval = { status: string; start: number; end: number | null; row: number };

// Excel dates and zone-less full timestamps are wall-clock times in Moscow.
export function tableTimestamp(value: unknown, date1904 = false): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 2958466) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round((value + (date1904 ? 1462 : 0)) * DAY_MS));
    return moscowMidnight(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()) + date.getUTCHours() * 3600000 + date.getUTCMinutes() * 60000 + date.getUTCSeconds() * 1000 + date.getUTCMilliseconds();
  }
  const text = normalize(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/i.exec(text);
  if (iso) {
    const date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    const result = Date.parse(text);
    if (Number.isFinite(result) && date.getUTCFullYear() === Number(iso[1]) && date.getUTCMonth() + 1 === Number(iso[2]) && date.getUTCDate() === Number(iso[3]) && Number(iso[4]) < 24 && Number(iso[5]) < 60 && Number(iso[6]) < 60) return result;
  }
  const local = /^(?:(\d{4})-(\d{2})-(\d{2})|(\d{2})\.(\d{2})\.(\d{4}))[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(text);
  if (local) {
    const year = Number(local[1] || local[6]), month = Number(local[2] || local[5]), day = Number(local[3] || local[4]);
    const hour = Number(local[7]), minute = Number(local[8]), second = Number(local[9]), ms = Number((local[10] ?? '').padEnd(3, '0'));
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day && hour < 24 && minute < 60 && second < 60) return moscowMidnight(year, month, day) + hour * 3600000 + minute * 60000 + second * 1000 + ms;
  }
  throw new AppError('INVALID_TIMESTAMP', 'Нужны точные дата и время с секундами: ISO с часовым поясом, ДД.ММ.ГГГГ ЧЧ:ММ:СС (МСК) или дата-время Excel.');
}

export function readTableHistories(book: XLSX.WorkBook, epics: Pick<EpicSummary, 'key' | 'title' | 'resolution' | 'sourceMetadata'>[], importedAt: string, globalWarnings: DataWarning[] = [], finalClosed: (key: string, status: string) => boolean = (_key, status) => statusInfo(status).kind === 'closed'): Pick<ImportedSelection, 'asOf' | 'histories' | 'historyWarnings'> {
  const histories: Record<string, TableHistory> = {}, historyWarnings: Record<string, DataWarning[]> = {};
  const date1904 = !!book.Workbook?.WBProps?.date1904;
  const findSheet = (names: string[]) => {
    const matches = book.SheetNames.filter(name => names.includes(canonical(name)));
    if (matches.length > 1) throw new AppError('AMBIGUOUS_HISTORY_SHEET', `Несколько листов одного назначения: ${matches.join(', ')}.`);
    return matches[0];
  };
  const read = (name: string) => XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, defval: '', blankrows: true });
  const settings = findSheet(['параметры', 'settings']);
  const asOfRows = settings ? read(settings).filter(row => ['asof', 'срез', 'момент среза'].includes(canonical(row[0]))) : [];
  if (asOfRows.length > 1) throw new AppError('AMBIGUOUS_ASOF', 'В Параметрах должно быть одно значение asOf.');
  const asOf = asOfRows.length ? new Date(tableTimestamp(asOfRows[0][1], date1904)).toISOString() : importedAt;
  if (Date.parse(asOf) > Date.parse(importedAt)) throw new AppError('FUTURE_ASOF', 'Момент среза не может быть позже момента импорта.');
  const historySheet = findSheet(['история', 'history', 'интервалы', 'intervals']);
  const flagsSheet = findSheet(['impediment', 'препятствия']);
  const addWarning = (key: string, code: string, message: string, row?: number) => {
    (historyWarnings[key] ??= []).push({ key, code, message, row, severity: 'error' });
  };
  if (!historySheet || !asOfRows.length) {
    for (const epic of epics) addWarning(epic.key, historySheet ? 'MISSING_ASOF' : 'NO_HISTORY_TABLE', historySheet ? 'Для истории нужен лист Параметры со значением asOf (момент среза). Расчёт не выполнен.' : 'В файле нет листа История. Доступны только предоставленные агрегаты; последовательность этапов неизвестна.');
    return { asOf, histories, historyWarnings };
  }
  const eligible = new Set(epics.map(e => e.key));
  const collect = (sheet: string, withStatus: boolean) => {
    const rows = read(sheet), headers = (rows[0] ?? []).map(canonical);
    const index = (aliases: string[]) => {
      const matches = headers.flatMap((name, i) => aliases.includes(name) ? [i] : []);
      if (matches.length !== 1) throw new AppError('HISTORY_COLUMNS', `Лист ${sheet}: нужна ровно одна колонка ${aliases[0]}.`);
      return matches[0];
    };
    const keyCol = index(['ключ эпика', 'ключ', 'key', 'issue key']);
    const startCol = index(['начало', 'start']), endCol = index(['окончание', 'конец', 'end']);
    const statusCol = withStatus ? index(['статус', 'status']) : -1;
    const byKey = new Map<string, ParsedInterval[]>();
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.every(cell => !normalize(cell))) continue;
      const key = normalize(row[keyCol]).toUpperCase();
      if (!eligible.has(key)) {
        globalWarnings.push({ code: 'HISTORY_KEY_NOT_SELECTED', severity: 'warning', row: i + 1, message: `Лист ${sheet}, строка ${i + 1}: ключ отсутствует в отобранной HF-выборке; строка истории пропущена.` });
        continue;
      }
      try {
        const status = withStatus ? normalize(row[statusCol]) : 'Impediment';
        if (!status) throw new AppError('EMPTY_STATUS', 'Пустой статус.');
        const interval = { status, start: tableTimestamp(row[startCol], date1904), end: normalize(row[endCol]) ? tableTimestamp(row[endCol], date1904) : null, row: i + 1 };
        if (interval.start > Date.parse(asOf) || (interval.end !== null && (interval.end < interval.start || interval.end > Date.parse(asOf)))) throw new AppError('INTERVAL_BOUNDS', 'Некорректные границы интервала или дата позже asOf.');
        const values = byKey.get(key) ?? []; values.push(interval); byKey.set(key, values);
      } catch (error) { addWarning(key, withStatus ? 'INVALID_HISTORY_ROW' : 'INVALID_FLAG_ROW', `Лист ${sheet}, строка ${i + 1}: ${error instanceof AppError ? error.message : 'Ошибка формата.'}`, i + 1); }
    }
    for (const values of byKey.values()) values.sort((a, b) => a.start - b.start || a.row - b.row);
    return byKey;
  };
  let intervals: Map<string, ParsedInterval[]>;
  try { intervals = collect(historySheet, true); }
  catch (error) {
    for (const epic of epics) addWarning(epic.key, 'HISTORY_COLUMNS', (error as AppError).message);
    return { asOf, histories, historyWarnings };
  }
  let flags: Map<string, ParsedInterval[]> | null = null;
  if (flagsSheet) {
    try { flags = collect(flagsSheet, false); }
    catch (error) { for (const epic of epics) addWarning(epic.key, 'FLAG_COLUMNS', (error as AppError).message); }
  }
  for (const epic of epics) {
    const values = intervals.get(epic.key) ?? [];
    if (!values.length) { addWarning(epic.key, 'NO_EPIC_HISTORY', 'Нет строк истории для этого эпика.'); continue; }
    if (historyWarnings[epic.key]?.some(w => w.code === 'INVALID_HISTORY_ROW')) continue;
    let valid = true;
    for (let i = 0; i < values.length - 1; i++) {
      if (values[i].end !== values[i + 1].start) {
        addWarning(epic.key, 'HISTORY_GAP', `Разрыв или пересечение интервалов в строках ${values[i].row} и ${values[i + 1].row}. TTM не рассчитан.`); valid = false;
      }
    }
    const last = values.at(-1)!;
    if (!finalClosed(epic.key, last.status) && last.end !== null && last.end !== Date.parse(asOf)) {
      addWarning(epic.key, 'HISTORY_END', 'Последний незакрытый статус должен заканчиваться в asOf или иметь пустое окончание.'); valid = false;
    }
    if (!valid) continue;
    const history: TableHistory = { key: epic.key, title: epic.title, historyStart: new Date(values[0].start).toISOString(),
      updated: asOf, currentStatus: last.status, resolution: epic.resolution, assignee: epic.sourceMetadata?.assignee ?? '', issueType: epic.sourceMetadata?.issueType ?? '', importedAt,
      currentFlag: false, flagAvailable: flags !== null && !historyWarnings[epic.key]?.some(w => ['FLAG_COLUMNS', 'INVALID_FLAG_ROW'].includes(w.code)),
      historyCount: values.length, warnings: [], flagChanges: [],
      statusChanges: values.slice(1).map((interval, i) => ({ id: String(i + 1), at: new Date(interval.start).toISOString(), from: values[i].status, to: interval.status })),
    };
    const epicFlags = flags?.get(epic.key) ?? [];
    let previousEnd = -Infinity;
    for (const interval of epicFlags) {
      if (interval.start < previousEnd) { history.flagAvailable = false; addWarning(epic.key, 'FLAG_OVERLAP', 'Интервалы impediment пересекаются.'); break; }
      previousEnd = interval.end ?? Infinity;
      if (interval.end !== null && (interval.end < values[0].start || (interval.end === values[0].start && interval.start < interval.end))) continue;
      history.flagChanges.push({ id: String(history.flagChanges.length), at: new Date(Math.max(interval.start, values[0].start)).toISOString(), from: false, to: true });
      if (interval.end !== null) history.flagChanges.push({ id: String(history.flagChanges.length), at: new Date(interval.end).toISOString(), from: true, to: false });
      else history.currentFlag = true;
    }
    history.warnings = historyWarnings[epic.key] ?? [];
    histories[epic.key] = history;
  }
  return { asOf, histories, historyWarnings };
}
