import { DAY_MS, TIME_ZONE } from './statuses';
import type { EpicTimeline } from './types';
import { displayIntervals } from './display';

const formatter = new Intl.DateTimeFormat('ru-RU', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
export function moscowDate(ms: number): { year: number; month: number; day: number } {
  const parts = formatter.formatToParts(ms);
  const get = (type: string) => Number(parts.find(p => p.type === type)!.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}
export function moscowMidnight(year: number, month: number, day: number): number {
  const utc = Date.UTC(year, month - 1, day);
  const offsetName = new Intl.DateTimeFormat('en', { timeZone: TIME_ZONE, timeZoneName: 'shortOffset' }).formatToParts(utc).find(p => p.type === 'timeZoneName')!.value;
  const hours = Number(offsetName.replace('GMT', '') || 0);
  return utc - hours * 3_600_000;
}
export interface CalendarCell { start: number; end: number; label: string; weekend?: boolean }
export interface CalendarRange { start: number; end: number; days: CalendarCell[]; months: CalendarCell[]; quarters: CalendarCell[] }
export function calendarRange(epics: EpicTimeline[], asOf: string, additionalBounds: { start: string | null; end: string | null }[] = []): CalendarRange {
  const starts = epics.flatMap(e => displayIntervals(e).length ? [Date.parse(displayIntervals(e)[0].start)] : e.start ? [Date.parse(e.start)] : []);
  const ends = epics.flatMap(e => displayIntervals(e).length ? [Date.parse(displayIntervals(e).at(-1)!.end)] : e.end ? [Date.parse(e.end)] : []);
  starts.push(...additionalBounds.flatMap(b => b.start ? [Date.parse(b.start)] : []));
  ends.push(...additionalBounds.flatMap(b => b.end ? [Date.parse(b.end)] : []));
  const low = moscowDate(starts.length ? Math.min(...starts) : Date.parse(asOf));
  const high = moscowDate(ends.length ? Math.max(...ends) : Date.parse(asOf));
  const start = moscowMidnight(low.year, low.month, low.day - 1);
  const end = moscowMidnight(high.year, high.month, high.day + 3);
  const days: CalendarCell[] = [], months: CalendarCell[] = [], quarters: CalendarCell[] = [];
  let lastMonth = '', lastQuarter = '';
  for (let cursor = start; cursor < end;) {
    const date = moscowDate(cursor);
    const next = moscowMidnight(date.year, date.month, date.day + 1);
    const dayOfWeek = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
    days.push({ start: cursor, end: next, label: String(date.day), weekend: [0, 6].includes(dayOfWeek) });
    const monthKey = `${date.year}-${date.month}`, quarterKey = `${date.year}-${Math.ceil(date.month / 3)}`;
    if (monthKey !== lastMonth) {
      months.push({ start: cursor, end: next, label: new Intl.DateTimeFormat('ru-RU', { timeZone: TIME_ZONE, month: 'long', year: 'numeric' }).format(cursor) });
      lastMonth = monthKey;
    } else months[months.length - 1].end = next;
    if (quarterKey !== lastQuarter) {
      quarters.push({ start: cursor, end: next, label: `Q${Math.ceil(date.month / 3)} · ${date.year}` }); lastQuarter = quarterKey;
    } else quarters[quarters.length - 1].end = next;
    cursor = next;
  }
  return { start, end, days, months, quarters };
}
export const position = (ms: number, start: number, pixelsPerDay: number) => (ms - start) / DAY_MS * pixelsPerDay;

export function dateTime(value: string | null): string {
  if (!value) return '—';
  const ms = Date.parse(value);
  return new Intl.DateTimeFormat('ru-RU', { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', ...(ms % 1000 ? { fractionalSecondDigits: 3 as const } : {}) }).format(ms);
}
export function preciseDuration(ms: number): string {
  const seconds = ms / 1000;
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 6 }).format(ms / DAY_MS)} дн. (${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(seconds)} с)`;
}
