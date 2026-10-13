import { describe, expect, it } from 'vitest';
import { parseFileCandidates } from '../server/file-candidates';
import { workbook } from './fixtures';

describe('AC-02: Дано CSV/XLSX с ключами → получаем кандидатов без отбора по файлу', () => {
  it.each(['Ключ', 'Ключ проблемы', 'Issue key', 'Key'])('достаточно колонки %s', header => {
    const result = parseFileCandidates(workbook([[header], ['TEST-1'], ['TEST-2']]), 'keys.xlsx');
    expect(result.candidates.map(c => c.requestedKey)).toEqual(['TEST-1', 'TEST-2']);
  });
  it('список без заголовка сохраняет первый ключ, дубликаты и неверные строки отражены', () => {
    const result = parseFileCandidates(Buffer.from('TEST-1\nTEST-2\nTEST-1\nне ключ\n'), 'keys.csv');
    expect(result.candidates.map(c => c.requestedKey)).toEqual(['TEST-1', 'TEST-2']);
    expect(result.candidates[0].rows).toEqual([1, 3]);
    expect(result.invalidRows).toEqual([4]);
  });
  it.each([',', ';', '\t'])('UTF-8 BOM, кавычки и перенос строки с разделителем %s', sep => {
    const result = parseFileCandidates(Buffer.from(`\uFEFFКлюч${sep}Название\r\nTEST-1${sep}"строка\nпродолжение"\r\nTEST-2${sep}текст`), 'keys.csv');
    expect(result.candidates.map(c => c.requestedKey)).toEqual(['TEST-1', 'TEST-2']);
  });
  it('устаревшие DF и resolution не исключают кандидата', () => {
    const result = parseFileCandidates(workbook([['Ключ', 'Тип эпика', 'resolution'], ['TEST-1', 'DF', 'Отклонено']]), 'keys.xlsx');
    expect(result.candidates).toHaveLength(1);
  });
  it('контрольные поля и агрегаты сохраняются отдельно; дубли и ошибки необязательных колонок не блокируют ключ', () => {
    const result = parseFileCandidates(Buffer.from('Ключ;Тип эпика;Решение;Название;Описание;TTM;Cycle Time [HF] Реализация;Статус;Статус\nTEST-1;DF;Отклонено;Тест;private-marker;12,5;не число;a;b'), 'keys.csv');
    expect(result.candidates[0].control).toEqual({ metadata: { type: 'DF', resolution: 'Отклонено', title: 'Тест' }, aggregates: { TTM: 12.5 }, columns: ['TTM', 'Cycle Time [HF] Реализация'] });
    expect(JSON.stringify(result)).not.toContain('private-marker');
    expect(result.warnings.map(w => w.code)).toEqual(expect.arrayContaining(['OPTIONAL_COLUMN_AMBIGUOUS', 'INVALID_CONTROL_AGGREGATE']));
  });
  it('структурный лист истории не подменяет выборку; имя само по себе не исключает лист', () => {
    const result = parseFileCandidates(workbook([['Ключ'], ['TEST-1']], { История: [['Ключ', 'Статус', 'Начало', 'Окончание'], ['TEST-2', 'Открыт', 'a', 'b']] }), 'keys.xlsx');
    expect(result.candidates.map(c => c.requestedKey)).toEqual(['TEST-1']);
    expect(() => parseFileCandidates(workbook([['Ключ'], ['TEST-1']], { История: [['Ключ'], ['TEST-2']] }), 'keys.xlsx')).toThrow(/лист/i);
  });
  it('неоднозначные ключевые колонки и файл без ключей дают ошибку', () => {
    expect(() => parseFileCandidates(Buffer.from('Ключ;Key\nTEST-1;TEST-2'), 'a.csv')).toThrow(/колон/i);
    expect(() => parseFileCandidates(Buffer.from('Ключ\nпусто'), 'a.csv')).toThrow(/ключ/i);
  });
});
