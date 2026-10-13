import { hierarchyFormat, readTableHierarchy } from './table-hierarchy';
import * as XLSX from 'xlsx';
import { canonical, DAY_MS, isRejected, normalize } from '../shared/statuses';
import { isAggregateLabel } from '../shared/metrics';
import type { DataWarning, EpicSummary, ImportedSelection } from '../shared/types';
import { AppError } from './errors';
import { readTableHistories } from './table-history';

export const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;
const ALIASES = {
  key: ['ключ эпика', 'ключ', 'issue key', 'key'],
  type: ['тип эпика', 'epic type'],
  title: ['summary', 'название', 'название эпика', 'тема'],
  resolution: ['resolution', 'резолюция'],
  status: ['статус', 'текущий статус', 'current status'],
  weeklyTtm: ['значение ттм'],
} as const;
type Column = keyof typeof ALIASES;
const PROFILES: readonly (readonly Column[])[] = [
  ['key', 'title', 'type', 'resolution'],
  ['key', 'title', 'status', 'weeklyTtm'],
];
type ResolvedColumns = Pick<Record<Column, number>, 'key' | 'title'> & Partial<Record<Column, number>>;

function columns(row: unknown[]): Partial<Record<Column, number>> {
  const result: Partial<Record<Column, number>> = {};
  for (const field of Object.keys(ALIASES) as Column[]) {
    const indices = row.flatMap((cell, index) => (ALIASES[field] as readonly string[]).includes(canonical(cell)) ? [index] : []);
    if (indices.length === 1) result[field] = indices[0];
  }
  return result;
}

function statusFlow(status: string): 'hf' | 'df' | undefined {
  const name = canonical(status);
  const prefix = /^\[(hf|df)\]/.exec(name)?.[1];
  // A weekly report has no explicit HF/DF column: only an unambiguous status prefix is evidence.
  return prefix && [...name.matchAll(/\[(?:hf|df)\]/g)].length === 1 ? prefix as 'hf' | 'df' : undefined;
}

export function parseWorkbook(buffer: Buffer, filename: string, importedAt = new Date().toISOString()): ImportedSelection {
  if (buffer.length > 20 * 1024 * 1024) throw new AppError('FILE_TOO_LARGE', 'Файл превышает 20 МБ.', 413);
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new AppError('INVALID_XLSX', 'Нужен файл Excel в формате .xlsx.');
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellFormula: false, cellHTML: false, cellStyles: false, sheetRows: 20_002 });
  } catch { throw new AppError('INVALID_XLSX', 'Не удалось прочитать XLSX. Проверьте формат и целостность файла.'); }
  if (!workbook.SheetNames.length) throw new AppError('EMPTY_WORKBOOK', 'В книге нет листов.');

  const hierarchyInfo = hierarchyFormat(workbook);
  const candidates: { name: string; rows: unknown[][]; header: number; cols: ResolvedColumns }[] = [];
  const summaries: string[] = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const range = sheet['!fullref'] ?? sheet['!ref'];
    if (range && (XLSX.utils.decode_range(range).e.r > 20_000 || XLSX.utils.decode_range(range).e.c > 500)) {
      throw new AppError('SHEET_TOO_LARGE', 'Максимум 20 000 строк и 500 столбцов на листе.');
    }
    if (hierarchyInfo?.elements === name) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: true });
    let best: Partial<Record<Column, number>> = {};
    for (let header = 0; header < Math.min(rows.length, 30); header++) {
      const cols = columns(rows[header]);
      if (Object.keys(cols).length > Object.keys(best).length) best = cols;
      if (PROFILES.some(required => required.every(field => cols[field] !== undefined))) {
        const ambiguous = (Object.keys(ALIASES) as Column[]).filter(field => rows[header].filter(cell => (ALIASES[field] as readonly string[]).includes(canonical(cell))).length > 1);
        if (ambiguous.length) throw new AppError('AMBIGUOUS_COLUMNS', `Лист «${normalize(name)}»: повторяются колонки ${ambiguous.map(field => ALIASES[field][0]).join(', ')}.`);
        candidates.push({ name, rows, header, cols: cols as ResolvedColumns });
        break;
      }
    }
    summaries.push(`${normalize(name)}: для полной выгрузки отсутствуют или неоднозначны ${PROFILES[0].filter(field => best[field] === undefined).map(field => ALIASES[field][0]).join(', ') || '—'}; для недельного отчёта — ${PROFILES[1].filter(field => best[field] === undefined).map(field => ALIASES[field][0]).join(', ') || '—'}`);
  }
  if (!candidates.length) throw new AppError('MISSING_COLUMNS', `Не найден лист с обязательными колонками. ${summaries.join('; ')}`);
  // Never guess between two complete but different selections, even if one is larger.
  if (candidates.length > 1) throw new AppError('AMBIGUOUS_SHEET', `Несколько подходящих листов: ${candidates.map(c => c.name).join(', ')}. Оставьте в файле один полный лист для импорта.`);

  const { name, rows, header, cols } = candidates[0];
  const warnings: DataWarning[] = [];
  if (cols.type === undefined) warnings.push({ code: 'EPIC_TYPE_FROM_STATUS', severity: 'warning', message: 'Колонки «Тип эпика» нет. HF/DF определяется по явной метке [HF]/[DF] в начале статуса; строки без однозначной метки пропускаются. «Вид эпика» не используется как тип потока.' });
  if (cols.resolution === undefined) warnings.push({ code: 'MISSING_RESOLUTION', severity: 'warning', message: 'В файле нет колонки «Резолюция»: отклонённые эпики исключаются только по статусу «Отклонено». Проверка резолюции недоступна; статус «Закрыт» не определяет резолюцию.' });
  const epics: EpicSummary[] = [];
  const seen = new Set<string>();
  const source = { filename: normalize(filename).split(/[\\/]/).pop() || 'import.xlsx', sheet: name, importedAt, totalRows: 0, excludedDF: 0, excludedRejected: 0, invalidRows: 0, duplicates: 0 };
  const headers = rows[header].map(normalize);
  const excelColumns = headers.filter(isAggregateLabel);
  if (new Set(excelColumns.map(canonical)).size !== excelColumns.length) throw new AppError('AMBIGUOUS_AGGREGATE_COLUMNS', 'Повторяются названия колонок длительностей. Оставьте по одной колонке для каждого показателя.');
  for (let i = header + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.every(cell => !normalize(cell))) continue;
    source.totalRows++;
    const key = normalize(row[cols.key]).toUpperCase();
    const currentStatus = cols.status === undefined ? '' : normalize(row[cols.status]);
    const type = cols.type === undefined ? statusFlow(currentStatus) : canonical(row[cols.type]);
    const resolution = cols.resolution === undefined ? '' : normalize(row[cols.resolution]);
    const warn = (code: string, message: string) => warnings.push({ code, message, severity: 'warning', row: i + 1, key: ISSUE_KEY.test(key) ? key : undefined });
    if (type && ['df', 'delivery (df)', 'деливери (df)'].includes(type)) { source.excludedDF++; continue; }
    if (!type || !['hf', 'гипотеза (hf)'].includes(type)) {
      source.invalidRows++; warn('INVALID_EPIC_TYPE', cols.type === undefined ? 'Строка пропущена: в начале статуса нет однозначной метки [HF] или [DF].' : 'Строка пропущена: тип эпика не HF и не DF.'); continue;
    }
    if (isRejected(resolution) || isRejected(currentStatus)) { source.excludedRejected++; continue; }
    if (!ISSUE_KEY.test(key)) { source.invalidRows++; warn('INVALID_KEY', 'Строка пропущена: некорректный или пустой ключ Jira.'); continue; }
    if (seen.has(key)) { source.duplicates++; warn('DUPLICATE_KEY', 'Дубликат ключа пропущен; используется первая подходящая строка.'); continue; }
    seen.add(key);
    const title = normalize(row[cols.title]);
    if (!title) warn('MISSING_TITLE', 'Нет названия; вместо него показан ключ эпика.');
    const excelAggregates: Record<string, number> = {};
    headers.forEach((label, index) => {
      if (!isAggregateLabel(label)) return;
      const text = normalize(row[index]);
      if (!text) return;
      const value = Number(text.replace(/ /g, '').replace(',', '.'));
      if (!Number.isFinite(value * DAY_MS) || value < 0) warn('INVALID_AGGREGATE', `Некорректный контрольный агрегат: ${label}.`);
      else excelAggregates[label] = value;
    });
    const sourceMetadata: Record<string, string> = {};
    const metadataColumns: Record<string, readonly string[]> = {
      currentStatus: ALIASES.status, issueType: ['тип задачи', 'issue type'],
      epicKind: ['вид эпика'], reportGroup: ['группа'],
      assignee: ['assignee_display_name', 'исполнитель'], product: ['product', 'продукт'],
      impedimentSubtracted: ['вычитать время, проведенное с флагом impediment'],
    };
    for (const [field, aliases] of Object.entries(metadataColumns)) {
      const index = headers.findIndex(header => aliases.includes(canonical(header)));
      if (index >= 0 && normalize(row[index])) sourceMetadata[field] = normalize(row[index]);
    }
    epics.push({ key, title: title || key, type: 'HF', resolution, sourceRow: i + 1, excelAggregates, excelColumns, sourceMetadata });
  }
  if (!epics.length) throw new AppError('NO_HF_EPICS', 'После фильтрации не осталось HF-эпиков с корректными ключами.');
  if (epics.length > 1000) throw new AppError('TOO_MANY_EPICS', 'За один импорт можно обработать не более 1000 HF-эпиков.');
  const linked = readTableHierarchy(workbook, epics, importedAt, warnings);
  if (linked) return { source, epics, warnings, ...linked, histories: Object.fromEntries(Object.entries(linked.histories).filter(([key]) => seen.has(key))) };
  return { source, epics, warnings, ...readTableHistories(workbook, epics, importedAt, warnings) };
}
