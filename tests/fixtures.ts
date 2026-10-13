import * as XLSX from 'xlsx';
import type { EpicSummary, TableHistory } from '../shared/types';

export const AS_OF = '2026-09-18T09:00:00.000Z';
export const summary: EpicSummary = { key: 'TEST-1', title: 'Тестовый HF-эпик', type: 'HF', resolution: '', sourceRow: 2, excelAggregates: { '[HF] Time To Market': 999 } };
export function snapshot(overrides: Partial<TableHistory> = {}): TableHistory {
  return { key: 'TEST-1', title: 'Тестовый HF-эпик', historyStart: '2026-09-01T09:00:00.000Z', updated: '2026-09-17T09:00:00.000Z',
    currentStatus: '[HF] Закрыт', resolution: 'Готово', assignee: 'Тест', issueType: 'Большая задача', importedAt: AS_OF,
    statusChanges: [
      { id: '1', at: '2026-09-02T09:00:00.000Z', from: '[HF] Открыт', to: '[HF] Подготовка' },
      { id: '2', at: '2026-09-05T09:00:00.000Z', from: '[HF] Подготовка', to: '[HF] Реализация' },
      { id: '3', at: '2026-09-17T09:00:00.000Z', from: '[HF] Реализация', to: '[HF] Закрыт' },
    ], flagChanges: [], currentFlag: false, flagAvailable: true, historyCount: 3, warnings: [], ...overrides };
}
export function workbook(rows: unknown[][] = [
  ['Ключ эпика', 'Тип эпика', 'Summary', 'Резолюция', '[HF] Time To Market'],
  ['TEST-1', 'HF', 'Тестовый HF-эпик', '', 999],
], extras?: Record<string, unknown[][]>): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Данные');
  for (const [name, cells] of Object.entries(extras ?? {})) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(cells), name);
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function historyWorkbook(intervals: unknown[][] = [
  ['TEST-1', '[HF] Открыт', '2026-09-01T09:00:00Z', '2026-09-02T09:00:00Z'],
  ['TEST-1', '[HF] Подготовка', '2026-09-02T09:00:00Z', '2026-09-05T09:00:00Z'],
  ['TEST-1', '[HF] Реализация', '2026-09-05T09:00:00Z', '2026-09-17T09:00:00Z'],
  ['TEST-1', '[HF] Закрыт', '2026-09-17T09:00:00Z', ''],
], flags: unknown[][] = [], parameters: unknown[][] = [['asOf', AS_OF]]) {
  return workbook(undefined, {
    История: [['Ключ эпика', 'Статус', 'Начало', 'Окончание'], ...intervals],
    Impediment: [['Ключ эпика', 'Начало', 'Окончание'], ...flags],
    Параметры: [['Параметр', 'Значение'], ...parameters],
  });
}

// Anonymized weekly report shape, independent of private files in temp_imports.
export function weeklyWorkbook(rows: unknown[][] = [
  ['В работе', 'Пример', 'TEST-1', 'https://example.test/TEST-1', 'Недельный эпик', 'Бизнес (мастер-фича)', '[HF]\u00a0Реализация', '2026-08-01', '2026-08-02', 56.6, 49.1, true, ''],
], extraHeaders: string[] = []) {
  return workbook([
    ['Группа', 'Продукт', 'Ключ эпика', 'Ссылка', 'Название эпика', 'Вид эпика', 'Статус', 'Дата создания эпика', 'Дата входа в поток', 'Значение ТТМ', 'ТТМ на начало недели', 'Вычитать время, проведенное с флагом impediment', 'Описание', ...extraHeaders],
    ...rows,
  ]);
}
