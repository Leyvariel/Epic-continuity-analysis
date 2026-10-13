import { describe, expect, it } from 'vitest';
import { parseWorkbook } from '../server/import';
import { buildDataset } from '../server/service';
import { tableTimestamp } from '../server/table-history';
import { metricsFor, metricValue } from '../shared/metrics';
import { AS_OF, historyWorkbook, workbook } from './fixtures';

describe('history provided in a local table', () => {
  it('calculates contiguous interval rows and preserves the aggregate separately', () => {
    const imported = parseWorkbook(historyWorkbook(), 'local.xlsx', AS_OF);
    const epic = buildDataset(imported, AS_OF).epics[0];
    expect(epic.quality).toBe('complete'); expect(epic.ttmMs).toBe(15 * 86400000);
    expect(metricValue(epic, 'ttm', 'history')).toBe(15 * 86400000);
    expect(metricValue(epic, 'ttm', 'excel')).toBe(999 * 86400000);
    expect(metricValue(epic, 'open', 'excel')).toBeNull();
  });
  it('does not assume sequence from aggregate values or per-stage dates', () => {
    const imported = parseWorkbook(workbook(), 'local.xlsx', AS_OF);
    const epic = buildDataset(imported, AS_OF).epics[0];
    expect(epic.ttmMs).toBeNull(); expect(epic.intervals).toEqual([]);
    expect(metricValue(epic, 'ttm', 'excel')).toBe(999 * 86400000);
  });
  it('retains new HF stage names without mapping them to old stages', () => {
    const input = workbook([
      ['Ключ эпика', 'Тип эпика', 'Summary', 'Резолюция', '[HF] Time To Market', 'Cycle Time [HF] Отложено', 'Cycle Time [HF] Проверка идей', 'Cycle Time [HF] Запланировано', 'Cycle Time [HF] Реализация', 'assignee_display_name', 'assignee_email'],
      ['TEST-1', 'HF', 'Эпик', '', 100, 10, 20, 30, 40, 'Исполнитель', 'private@example.test'],
    ]);
    const epic = buildDataset(parseWorkbook(input, 'local.xlsx', AS_OF), AS_OF).epics[0];
    const metrics = metricsFor([epic], 'excel');
    expect(metrics.filter(metric => metric.id.startsWith('extra:')).map(metric => metric.name)).toEqual(['Отложено', 'Проверка идей', 'Запланировано']);
    expect(metrics.some(metric => metric.id === 'preparation')).toBe(false);
    expect(metricValue(epic, 'extra:cycle time [hf] проверка идей', 'excel')).toBe(20 * 86400000);
    expect(metricValue(epic, 'extra:cycle time [hf] проверка идей', 'history')).toBeNull();
    expect(epic.summary.sourceMetadata?.assignee).toBe('Исполнитель');
    expect(JSON.stringify(epic)).not.toContain('private@example.test');
  });
  it('requires one explicit asOf for history and rejects future snapshots', () => {
    const noAsOf = parseWorkbook(historyWorkbook(undefined, [], []), 'local.xlsx', AS_OF);
    expect(noAsOf.historyWarnings['TEST-1'][0].code).toBe('MISSING_ASOF');
    expect(() => parseWorkbook(historyWorkbook(undefined, [], [['asOf', '2027-01-01T00:00:00Z']]), 'local.xlsx', AS_OF)).toThrow(/позже/);
    expect(() => parseWorkbook(historyWorkbook(undefined, [], [['asOf', AS_OF], ['Срез', AS_OF]]), 'local.xlsx', AS_OF)).toThrow(/одно/);
  });
  it('rejects gaps, overlaps, open intervals in the middle and incomplete terminal intervals', () => {
    for (const end of ['2026-09-03T09:00:00Z', '2026-09-06T09:00:00Z', '']) {
      const imported = parseWorkbook(historyWorkbook([
        ['TEST-1', '[HF] Подготовка', '2026-09-02T09:00:00Z', end],
        ['TEST-1', '[HF] Реализация', '2026-09-05T09:00:00Z', ''],
      ]), 'local.xlsx', AS_OF);
      expect(imported.histories['TEST-1']).toBeUndefined();
      expect(imported.historyWarnings['TEST-1'][0].code).toBe('HISTORY_GAP');
    }
    const incomplete = parseWorkbook(historyWorkbook([['TEST-1', '[HF] Подготовка', '2026-09-02T09:00:00Z', '2026-09-03T09:00:00Z']]), 'local.xlsx', AS_OF);
    expect(incomplete.historyWarnings['TEST-1'][0].code).toBe('HISTORY_END');
  });
  it('preserves simultaneous / repeated status entries and terminal Open', () => {
    const imported = parseWorkbook(historyWorkbook([
      ['TEST-1', '[HF] Подготовка', '2026-09-02T09:00:00Z', '2026-09-02T09:00:00Z'],
      ['TEST-1', '[HF] Подготовка', '2026-09-02T09:00:00Z', '2026-09-03T09:00:00Z'],
      ['TEST-1', '[HF] Открыт', '2026-09-03T09:00:00Z', ''],
    ]), 'local.xlsx', AS_OF);
    const epic = buildDataset(imported, AS_OF).epics[0];
    expect(epic.intervals.map(s => s.code)).toEqual(['П', 'П', '↩О']);
    expect(epic.intervals[0].durationMs).toBe(0);
    expect(epic.isOpen).toBe(true); expect(epic.end).toBe(AS_OF);
  });
  it('preserves a short impediment and clips an older flag to TTM', () => {
    const imported = parseWorkbook(historyWorkbook(undefined, [
      ['TEST-1', '2026-08-01T00:00:00Z', '2026-09-02T09:00:01Z'],
      ['TEST-1', '2026-09-06T00:00:00Z', '2026-09-06T00:00:00.125Z'],
    ]), 'local.xlsx', AS_OF);
    const epic = buildDataset(imported, AS_OF).epics[0];
    expect(epic.impedimentMs).toBe(1125); expect(epic.impediments).toHaveLength(2);
    expect(epic.ttmMs).toBe(15 * 86400000);
  });
  it('supports adjacent flag intervals even when table rows are reversed', () => {
    const imported = parseWorkbook(historyWorkbook(undefined, [
      ['TEST-1', '2026-09-04T09:00:00Z', '2026-09-05T09:00:00Z'],
      ['TEST-1', '2026-09-03T09:00:00Z', '2026-09-04T09:00:00Z'],
    ]), 'local.xlsx', AS_OF);
    expect(buildDataset(imported, AS_OF).epics[0].impedimentMs).toBe(2 * 86400000);
  });
  it('keeps a flag event whose on/off timestamps coincide', () => {
    const input = historyWorkbook(undefined, [['TEST-1', '2026-09-04T09:00:00Z', '2026-09-04T09:00:00Z']]);
    const epic = buildDataset(parseWorkbook(input, 'local.xlsx', AS_OF), AS_OF).epics[0];
    expect(epic.impedimentMs).toBe(0); expect(epic.impediments).toHaveLength(1);
  });
  it('does not silently discard an unknown stage before the first known active stage', () => {
    const input = historyWorkbook([
      ['TEST-1', '[HF] Проверка идей', '2026-09-02T09:00:00Z', '2026-09-03T09:00:00Z'],
      ['TEST-1', '[HF] Реализация', '2026-09-03T09:00:00Z', ''],
    ]);
    const epic = buildDataset(parseWorkbook(input, 'local.xlsx', AS_OF), AS_OF).epics[0];
    expect(epic.ttmMs).toBeNull(); expect(epic.warnings.some(w => w.code === 'AMBIGUOUS_TTM_START')).toBe(true);
  });
  it('flags invalid status timestamps and overlapping impediments', () => {
    const invalid = parseWorkbook(historyWorkbook([['TEST-1', '[HF] Реализация', 'yesterday', '']]), 'local.xlsx', AS_OF);
    expect(buildDataset(invalid, AS_OF).epics[0].ttmMs).toBeNull();
    const overlap = parseWorkbook(historyWorkbook(undefined, [
      ['TEST-1', '2026-09-03T09:00:00Z', '2026-09-05T09:00:00Z'],
      ['TEST-1', '2026-09-04T09:00:00Z', ''],
    ]), 'local.xlsx', AS_OF);
    expect(buildDataset(overlap, AS_OF).epics[0].impedimentMs).toBeNull();
  });
  it('distinguishes a missing impediment sheet from an explicitly empty one', () => {
    const input = workbook(undefined, { История: [['Ключ эпика', 'Статус', 'Начало', 'Окончание'], ['TEST-1', '[HF] Реализация', '2026-09-02T09:00:00Z', '']], Параметры: [['asOf', AS_OF]] });
    const epic = buildDataset(parseWorkbook(input, 'local.xlsx', AS_OF), AS_OF).epics[0];
    expect(epic.ttmMs).not.toBeNull(); expect(epic.impedimentMs).toBeNull(); expect(epic.quality).toBe('partial');
    expect(buildDataset(parseWorkbook(historyWorkbook(), 'local.xlsx', AS_OF), AS_OF).epics[0].impedimentMs).toBe(0);
  });
  it('parses Excel 1900/1904, explicit offsets and Moscow wall times consistently', () => {
    const expected = Date.parse('2026-09-02T09:00:00.123Z');
    expect(tableTimestamp('02.09.2026 12:00:00.123')).toBe(expected);
    expect(tableTimestamp('2026-09-02 12:00:00.123')).toBe(expected);
    expect(tableTimestamp('2026-09-02T12:00:00.123+0300')).toBe(expected);
    const serial = (Date.UTC(2026, 8, 2, 12, 0, 0, 123) - Date.UTC(1899, 11, 30)) / 86400000;
    expect(tableTimestamp(serial)).toBe(expected); expect(tableTimestamp(serial - 1462, true)).toBe(expected);
    for (const invalid of ['2026-02-30T12:00:00Z', '31.02.2026 12:00:00', '02.09.2026', '2026-09-02T24:00:00Z']) expect(() => tableTimestamp(invalid)).toThrow();
  });
});
