import { describe, expect, it } from 'vitest';
import { parseKeyCandidates } from '../server/key-candidates';
import { readFileSync } from 'node:fs';
import { AppError } from '../server/errors';

const examples = readFileSync(new URL('../docs/sdd/changes/archive/2026/LOCAL-20260924-01-multi-epic-keys/examples.md', import.meta.url), 'utf8');
const [plain, grid] = [...examples.matchAll(/```text\n([\s\S]*?)\n```/g)].map(match => match[1]);

describe('KEYS-PARSER: прямой ввод ключей', () => {
  it('AC-018: первая ячейка Markdown-таблицы является ключом', () => {
    const result = parseKeyCandidates('New grid\n\n| CARSDIS-6 |\n| :--- |\n| BUSDIS-9 |');
    expect(result.candidates.map(candidate => candidate.requestedKey)).toEqual(['CARSDIS-6', 'BUSDIS-9']);
    expect(result.candidates.map(candidate => candidate.rows)).toEqual([[3], [5]]);
    expect(result.invalid).toEqual([]);
  });
  it('AC-018: оба точных образца дают одинаковые 24 ключа в исходном порядке', () => {
    const lists = [plain, grid].map(parseKeyCandidates);
    expect(lists.map(list => list.candidates.length)).toEqual([24, 24]);
    expect(lists[0].candidates.map(item => item.requestedKey)).toEqual(lists[1].candidates.map(item => item.requestedKey));
    expect(lists[0].candidates[0].requestedKey).toBe('CARSDIS-6');
    expect(lists[0].candidates.at(-1)?.requestedKey).toBe('ETRAINDIS-5');
    expect(lists.every(list => list.invalid.length === 0 && list.inputRows === 24)).toBe(true);
  });
  it('AC-019/020: объединяет регистр, сохраняет физические номера и две одинаковые ошибки отдельно', () => {
    const parsed = parseKeyCandidates('test-1\r\n\r\nTEST-1\r\nневерный ключ\r\n| TEST-2 |\r\nневерный ключ');
    expect(parsed.candidates).toEqual([{ requestedKey: 'TEST-1', rows: [1, 3] }, { requestedKey: 'TEST-2', rows: [5] }]);
    expect(parsed.invalid.map(entry => [entry.requestedKey, entry.rows])).toEqual([['неверный ключ', [4]], ['неверный ключ', [6]]]);
    expect(parsed.invalid.every(entry => entry.reason.length > 0)).toBe(true);
    expect(parsed.inputRows).toBe(5);
  });
  it('AC-020: многостолбцовую строку не дробит и не отправляет в Jira', () => {
    const parsed = parseKeyCandidates('TEST-1\n| TEST-2 | TEST-3 |');
    expect(parsed.candidates.map(entry => entry.requestedKey)).toEqual(['TEST-1']);
    expect(parsed.invalid[0]).toMatchObject({ requestedKey: '| TEST-2 | TEST-3 |', rows: [2], decision: 'invalid' });
    expect(parsed.invalid[0].reason).toMatch(/несколько|столб/);
  });
  it('AC-021: принимает только ошибки, отвергает пустое оформление', () => {
    expect(parseKeyCandidates('плохой ключ\n| :--- |\nещё один').invalid).toHaveLength(2);
    expect(() => parseKeyCandidates('\nNew grid\n\n| :--- |\n')).toThrowError(AppError);
    expect(() => parseKeyCandidates('\nNew grid\n\n| :--- |\n')).toThrow(/Введите/);
  });
  it('не усекает список после предела 1000 уникальных кандидатов', () => {
    expect(parseKeyCandidates(Array.from({ length: 1000 }, (_, i) => `TEST-${i + 1}`).join('\n')).candidates).toHaveLength(1000);
    expect(() => parseKeyCandidates(Array.from({ length: 1001 }, (_, i) => `TEST-${i + 1}`).join('\n'))).toThrow(/1000/);
    expect(parseKeyCandidates(Array.from({ length: 1001 }, () => 'TEST-1').join('\n')).candidates).toEqual([{ requestedKey: 'TEST-1', rows: Array.from({ length: 1001 }, (_, i) => i + 1) }]);
  });
});

it('AC-094: exact comma-separated user example produces 17 independent candidates',()=>{
 const text='RAILDIS-376, RAILDIS-353, RAILDIS-352, RAILDIS-351, RAILDIS-346, RAILDIS-345, RAILDIS-342, RAILDIS-267, RAILDIS-210, RAILDIS-199, RAILDIS-195, RAILDIS-188, RAILDIS-187, RAILDIS-183, RAILDIS-174, RAILDIS-138, RAILDIS-83';
 const r=parseKeyCandidates(text);
 expect(r.candidates.map(c=>c.requestedKey)).toEqual([376,353,352,351,346,345,342,267,210,199,195,188,187,183,174,138,83].map(n=>`RAILDIS-${n}`));
 expect(r.inputRows).toBe(17);expect(r.invalid).toEqual([]);expect(r.candidates.every(c=>c.rows.length===1&&c.rows[0]===1)).toBe(true);
});
it('AC-094: mixed separators preserve occurrences and individual errors without splitting multi-column tables',()=>{
 const r=parseKeyCandidates('test-1, TEST-2, test-1, bad\r\n, ,\r\n| TEST-3, TEST-4 |\n| TEST-5, TEST-6 | TEST-7 |');
 expect(r.candidates).toEqual([{requestedKey:'TEST-1',rows:[1,1]},{requestedKey:'TEST-2',rows:[1]},{requestedKey:'TEST-3',rows:[3]},{requestedKey:'TEST-4',rows:[3]}]);
 expect(r.invalid.map(e=>[e.requestedKey,e.rows])).toEqual([[' bad',[1]],['| TEST-5, TEST-6 | TEST-7 |',[4]]]);expect(r.inputRows).toBe(7);
 expect(()=>parseKeyCandidates(' , ,\n,')).toThrow(/Введите/);
});
it('AC-094: unique-key limit applies across comma-separated input without truncation',()=>{
 expect(parseKeyCandidates(Array.from({length:1000},(_,i)=>`TEST-${i+1}`).join(', ')).candidates).toHaveLength(1000);
 expect(()=>parseKeyCandidates(Array.from({length:1001},(_,i)=>`TEST-${i+1}`).join(', '))).toThrow(/1000/);
});
