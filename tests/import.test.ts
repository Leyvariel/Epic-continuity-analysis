import { describe, expect, it } from 'vitest';
import { parseWorkbook } from '../server/import';
import { workbook } from './fixtures';

describe('XLSX selection', () => {
  it('selects the complete worksheet rather than the auxiliary sheet', () => {
    const rows = [['Issue ID', ' Summary ', 'Тип\u00a0эпика', 'Ключ\nэпика', 'Resolution', '[HF] Time To Market'],
      ...Array.from({ length: 19 }, (_, i) => [i, 'Эпик', i < 9 ? 'HF' : 'DF', `TEST-${i + 1}`, 'Готово', i])];
    const data = parseWorkbook(workbook(rows, { 'Активный вспомогательный': [['Тип эпика', 'Ключ эпика', 'TTM'], ['HF', 'TEST-1', 1]] }), 'source.xlsx');
    expect(data.source.totalRows).toBe(19); expect(data.source.excludedDF).toBe(10);
    expect(data.source.sheet).toBe('Данные'); expect(data.epics).toHaveLength(9);
  });
  it('excludes rejected, malformed and duplicate rows, reports missing values', () => {
    const data = parseWorkbook(workbook([
      ['Summary', 'Ключ эпика', 'Тип эпика', 'Резолюция', '[HF] Time To Market'],
      ['', ' test-1 ', 'HF', '', '12,5'], ['Duplicate', 'TEST-1', 'HF', '', 12],
      ['Rejected', 'TEST-2', 'HF', ' Отклонено ', 1], ['No key', 'bad', 'HF', '', 1],
      ['Unknown type', 'TEST-3', '', '', 1], ['DF', 'TEST-4', 'DF', '', 1],
      ['Bad aggregate', 'TEST-5', 'Гипотеза (HF)', '', 'bad'],
    ]), 'source.xlsx');
    expect(data.epics.map(e => e.key)).toEqual(['TEST-1', 'TEST-5']);
    expect(data.epics[0].excelAggregates['[HF] Time To Market']).toBe(12.5);
    expect(data.source).toMatchObject({ invalidRows: 2, duplicates: 1, excludedDF: 1, excludedRejected: 1 });
    expect(data.warnings.map(w => w.code)).toEqual(expect.arrayContaining(['MISSING_TITLE', 'DUPLICATE_KEY', 'INVALID_KEY', 'INVALID_EPIC_TYPE', 'INVALID_AGGREGATE']));
  });
  it('rejects ambiguous complete sheets instead of choosing the largest', () => {
    const rows = [['Summary', 'Ключ эпика', 'Тип эпика', 'Резолюция'], ['Test', 'TEST-1', 'HF', '']];
    expect(() => parseWorkbook(workbook(rows, { 'Второй': rows }), 'source.xlsx')).toThrow(/Несколько/);
  });
  it('rejects missing required fields and duplicate header aliases', () => {
    expect(() => parseWorkbook(workbook([['Ключ эпика', 'Тип эпика'], ['TEST-1', 'HF']]), 'test.xlsx')).toThrow(/Summary|summary/);
    expect(() => parseWorkbook(workbook([['Ключ эпика', 'Key', 'Тип эпика', 'Summary', 'Резолюция']]), 'test.xlsx')).toThrow(/обязательными/);
  });
  it('rejects non-XLSX, oversized input, and zero eligible epics', () => {
    expect(() => parseWorkbook(Buffer.from('csv'), 'test.xlsx')).toThrow(/формате/);
    expect(() => parseWorkbook(Buffer.alloc(20 * 1024 * 1024 + 1), 'test.xlsx')).toThrow(/20 МБ/);
    expect(() => parseWorkbook(workbook([['Ключ эпика', 'Тип эпика', 'Summary', 'Резолюция']]), 'test.xlsx')).toThrow(/не осталось/);
  });
});
