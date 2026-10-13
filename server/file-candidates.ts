import { hierarchyFormat } from './table-hierarchy';
import * as XLSX from 'xlsx';
import { canonical, normalize } from '../shared/statuses';
import { AppError } from './errors';
import { ISSUE_KEY } from './import';
import { isAggregateLabel } from '../shared/metrics';
import type { Candidate, CandidateControl } from '../shared/contracts';
import type { DataWarning } from '../shared/types';

export type FileCandidate = Candidate;
export interface FileCandidates { candidates: FileCandidate[]; invalidRows: number[]; totalRows: number; sheet: string | null; format: 'xlsx' | 'csv'; warnings: DataWarning[] }
const keyNames = ['ключ', 'ключ эпика', 'ключ проблемы', 'issue key', 'key'];

export function parseFileCandidates(buffer: Buffer, filename: string): FileCandidates {
  if (buffer.length > 20 * 1024 * 1024) throw new AppError('FILE_TOO_LARGE', 'Файл превышает 20 МБ.', 413);
  const format = /\.xlsx$/i.test(filename) ? 'xlsx' : /\.csv$/i.test(filename) ? 'csv' : null;
  if (!format) throw new AppError('INVALID_UPLOAD', 'Нужен CSV или XLSX.');
  if (format === 'xlsx' && (buffer[0] !== 0x50 || buffer[1] !== 0x4b)) throw new AppError('INVALID_XLSX', 'Нужен файл XLSX.');
  let book: XLSX.WorkBook;
  try {
    const data = format === 'csv' ? new TextDecoder('utf-8', { fatal: true }).decode(buffer) : buffer;
    book = XLSX.read(data, { type: format === 'csv' ? 'string' : 'buffer', raw: true, cellFormula: false, cellHTML: false, sheetRows: 20_002 });
  } catch { throw new AppError('INVALID_UPLOAD', 'Не удалось прочитать файл. Для CSV нужна кодировка UTF-8.'); }
  const hierarchyInfo = format === 'xlsx' ? hierarchyFormat(book) : undefined;
  const sheets: { name: string; rows: unknown[][]; first: number; col: number }[] = [];
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name];
    const ref = sheet['!fullref'] ?? sheet['!ref'];
    if (ref) {
      const range = XLSX.utils.decode_range(ref);
      if (range.e.r >= 20_000 || range.e.c >= 500) throw new AppError('SHEET_TOO_LARGE', 'Максимум 20 000 строк и 500 колонок.');
    }
    if (hierarchyInfo?.elements === name) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: true });
    let found = false;
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const header = rows[i].map(canonical);
      const keys = header.flatMap((v, index) => keyNames.includes(v) ? [index] : []);
      // Structural auxiliary sheets: interval boundaries, not the sheet's name.
      if (keys.length === 1 && header.some(v => ['начало', 'start'].includes(v)) && header.some(v => ['окончание', 'конец', 'end'].includes(v))) { found = true; break; }
      if (keys.length > 1) throw new AppError('AMBIGUOUS_COLUMNS', 'Неоднозначные колонки ключей. Оставьте одну.');
      if (keys.length === 1) { sheets.push({ name, rows, first: i + 1, col: keys[0] }); found = true; break; }
    }
    if (!found && rows.every(row => row.slice(1).every(v => !normalize(v)))) {
      const first = rows.findIndex(row => normalize(row[0]));
      if (first >= 0 && ISSUE_KEY.test(normalize(rows[first][0]).toUpperCase())) sheets.push({ name, rows, first, col: 0 });
    }
  }
  if (sheets.length !== 1) throw new AppError(sheets.length ? 'AMBIGUOUS_SHEET' : 'MISSING_KEYS', sheets.length ? `Несколько листов с ключами: ${sheets.map(s => s.name).join(', ')}. Оставьте один.` : 'Не найден лист с ключами Jira.');
  const { name, rows, first, col } = sheets[0];
  const warnings: DataWarning[] = [];
  const labels = first && rows[first - 1].some(v => keyNames.includes(canonical(v))) ? rows[first - 1].map(normalize) : [];
  const optionalNames: Record<keyof CandidateControl['metadata'], string[]> = { title: ['название', 'название эпика', 'summary', 'тема'], type: ['тип эпика', 'epic type'], currentStatus: ['статус', 'status'], resolution: ['resolution', 'резолюция', 'решение'], epicKind: ['вид эпика'] };
  const metadataColumns = Object.entries(optionalNames).flatMap(([name, aliases]) => {
    const indexes = labels.flatMap((label, index) => aliases.includes(canonical(label)) ? [index] : []);
    if (indexes.length > 1) warnings.push({ code: 'OPTIONAL_COLUMN_AMBIGUOUS', message: `Неоднозначное контрольное поле «${name}» пропущено; отбор выполняется по Jira.`, severity: 'warning' });
    return indexes.length === 1 ? [{ name: name as keyof CandidateControl['metadata'], index: indexes[0] }] : [];
  });
  const aggregateColumns = labels.flatMap((label, index) => {
    if (!isAggregateLabel(label)) return [];
    if (labels.filter(other => canonical(other) === canonical(label)).length > 1) {
      warnings.push({ code: 'OPTIONAL_COLUMN_AMBIGUOUS', message: `Повторяющийся агрегат «${label}» пропущен.`, severity: 'warning' }); return [];
    }
    return [{ label, index }];
  });
  const candidates = new Map<string, FileCandidate>();
  const invalidRows: number[] = [];
  let totalRows = 0;
  rows.slice(first).forEach((row, offset) => {
    if (row.every(v => !normalize(v))) return;
    totalRows++;
    const key = normalize(row[col]).toUpperCase(), rowNumber = first + offset + 1;
    if (!ISSUE_KEY.test(key)) { invalidRows.push(rowNumber); return; }
    const existing = candidates.get(key);
    if (existing) existing.rows.push(rowNumber);
    else {
      const control: CandidateControl = { metadata: {}, aggregates: {}, columns: aggregateColumns.map(c => c.label) };
      for (const { name, index } of metadataColumns) if (normalize(row[index])) control.metadata[name] = normalize(row[index]);
      for (const { label, index } of aggregateColumns) {
        const raw = normalize(row[index]);
        if (!raw) continue;
        const value = Number(raw.replace(/ /g, '').replace(',', '.'));
        if (Number.isFinite(value) && value >= 0) control.aggregates[label] = value;
        else warnings.push({ code: 'INVALID_CONTROL_AGGREGATE', message: `Неверный контрольный агрегат «${label}» пропущен.`, key, row: rowNumber, severity: 'warning' });
      }
      candidates.set(key, { requestedKey: key, rows: [rowNumber], ...(Object.keys(control.metadata).length || control.columns.length ? { control } : {}) });
    }
  });
  if (!candidates.size) throw new AppError('NO_VALID_KEYS', 'В файле нет корректных ключей Jira.');
  return { candidates: [...candidates.values()], invalidRows, totalRows, sheet: format === 'csv' ? null : name, format, warnings };
}
