import { describe, expect, it } from 'vitest';
import { parseWorkbook } from '../server/import';
import { buildDataset } from '../server/service';
import { compositionFor } from '../shared/composition';
import { metricsFor, metricValue } from '../shared/metrics';
import { DAY_MS } from '../shared/statuses';
import { AS_OF, weeklyWorkbook, workbook } from './fixtures';

function row(key: string, status: string, current: unknown = 56.6, previous: unknown = 49.1): unknown[] {
  return ['В работе', 'Пример', key, '', 'Эпик', 'Бизнес (мастер-фича)', status, '2026-08-01', '2026-08-02', current, previous, true, ''];
}
const imported = (buffer: Buffer) => parseWorkbook(buffer, 'weekly.xlsx', AS_OF);

describe('weekly TTM report import', () => {
  it('uses the explicit HF status prefix, retains the business kind and reports missing resolution', () => {
    const data = imported(weeklyWorkbook());
    expect(data.epics).toHaveLength(1);
    expect(data.epics[0]).toMatchObject({ type: 'HF', resolution: '', sourceMetadata: {
      currentStatus: '[HF] Реализация', epicKind: 'Бизнес (мастер-фича)', reportGroup: 'В работе', product: 'Пример', impedimentSubtracted: 'true',
    } });
    expect(data.warnings.map(w => w.code)).toEqual(expect.arrayContaining(['EPIC_TYPE_FROM_STATUS', 'MISSING_RESOLUTION']));
    const epic = buildDataset(data, AS_OF).epics[0];
    expect(metricValue(epic, 'ttm', 'excel')).toBeCloseTo(56.6 * DAY_MS, 5);
    expect(epic.summary.excelAggregates['ТТМ на начало недели']).toBe(49.1);
    expect(epic.ttmMs).toBeNull(); expect(epic.intervals).toEqual([]);
    expect(compositionFor(epic, metricsFor([epic], 'excel'))).toMatchObject({ totalMs: null, segments: [] });
  });
  it('excludes DF and rejected statuses and skips absent, unprefixed or mixed flow markers', () => {
    const data = imported(weeklyWorkbook([
      row('TEST-1', '[HF] Закрыт'), row('TEST-2', '[DF] Закрыт'), row('TEST-3', '[HF] Отклонено'),
      row('TEST-4', 'Закрыт'), row('TEST-5', ''), row('TEST-6', '[HF] [DF] Реализация'), row('TEST-7', 'HF Реализация'),
    ]));
    expect(data.epics.map(epic => epic.key)).toEqual(['TEST-1']);
    expect(data.epics[0].resolution).toBe('');
    expect(data.source).toMatchObject({ totalRows: 7, excludedDF: 1, excludedRejected: 1, invalidRows: 4 });
    expect(data.warnings.filter(w => w.code === 'INVALID_EPIC_TYPE')).toHaveLength(4);
  });
  it('keeps zero, missing and invalid current TTM distinct without using the previous week as fallback', () => {
    const data = imported(weeklyWorkbook([
      row('TEST-1', '[HF] Реализация', 0, 20), row('TEST-2', '[HF] Реализация', '', 40), row('TEST-3', '[HF] Реализация', 'bad', 60),
    ]));
    const epics = buildDataset(data, AS_OF).epics;
    expect(epics.map(epic => metricValue(epic, 'ttm', 'excel'))).toEqual([0, null, null]);
    expect(data.warnings).toContainEqual(expect.objectContaining({ code: 'INVALID_AGGREGATE', key: 'TEST-3' }));
  });
  it('uses resolution when supplied and does not synthesize one from Closed', () => {
    const data = imported(weeklyWorkbook([
      [...row('TEST-1', '[HF] Закрыт'), 'Готово'], [...row('TEST-2', '[HF] Закрыт'), 'Отклонено'],
    ], ['Резолюция']));
    expect(data.epics).toHaveLength(1); expect(data.epics[0].resolution).toBe('Готово');
    expect(data.source.excludedRejected).toBe(1);
    expect(data.warnings.some(w => w.code === 'MISSING_RESOLUTION')).toBe(false);
  });
  it('does not override a present but invalid explicit epic type from the status', () => {
    const data = imported(weeklyWorkbook([
      [...row('TEST-1', '[HF] Реализация'), 'HF'], [...row('TEST-2', '[HF] Реализация'), 'Бизнес'], [...row('TEST-3', '[HF] Реализация'), ''],
    ], ['Тип эпика']));
    expect(data.epics.map(epic => epic.key)).toEqual(['TEST-1']);
    expect(data.source.invalidRows).toBe(2);
    expect(data.warnings.some(w => w.code === 'EPIC_TYPE_FROM_STATUS')).toBe(false);
  });
  it('rejects duplicate optional type or resolution columns instead of switching to fallback inference', () => {
    expect(() => imported(weeklyWorkbook([[...row('TEST-1', '[HF] Реализация'), 'HF', 'DF']], ['Тип эпика', 'Epic type']))).toThrow(/повторяются колонки/);
    expect(() => imported(weeklyWorkbook([[...row('TEST-1', '[HF] Реализация'), 'Готово', 'Отклонено']], ['Резолюция', 'Resolution']))).toThrow(/повторяются колонки/);
  });
  it('does not import a generic selection with no full or weekly report column set', () => {
    expect(() => imported(workbook([['Ключ эпика', 'Название эпика', 'Вид эпика'], ['TEST-1', 'Эпик', 'Бизнес (мастер-фича)']]))).toThrow(/недельного отчёта/);
    expect(() => imported(workbook([['Ключ эпика', 'Название эпика', 'Статус', 'ТТМ на начало недели'], ['TEST-1', 'Эпик', '[HF] Закрыт', 50]]))).toThrow(/значение ттм/);
  });
  it('accepts normalized weekly headers but does not infer chronology from report dates', () => {
    const data = imported(workbook([
      ['Issue key', 'Название\nэпика', 'Статус', 'Значение\u00a0ТТМ', 'Дата входа в поток'],
      ['TEST-1', 'Эпик', '[HF] Закрыт', '12,5', '2026-08-01'],
    ]));
    const epic = buildDataset(data, AS_OF).epics[0];
    expect(metricValue(epic, 'ttm', 'excel')).toBe(12.5 * DAY_MS);
    expect(epic.start).toBeNull(); expect(epic.end).toBeNull(); expect(epic.intervals).toEqual([]);
  });
});
