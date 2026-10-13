import { describe,it,expect } from 'vitest';
import { parseWorkbook } from '../server/import';
import { parseFileCandidates } from '../server/file-candidates';
import { workbook } from './fixtures';
import { CUT,at } from './hierarchy-fixtures';
import { linkedWorkbook } from './linked-workbook';
import * as XLSX from 'xlsx';

describe('T006: автономный XLSX',()=>{
 it('AC-045: неизвестная версия и противоречивые метаданные отклоняют книгу',()=>{
  const book=XLSX.read(linkedWorkbook(),{type:'buffer'});
  book.Sheets['Параметры']['B2'].v=2;
  expect(()=>parseWorkbook(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),'version.xlsx',CUT)).toThrow('версия');
  book.Sheets['Параметры']['B2'].v=1;
  XLSX.utils.sheet_add_aoa(book.Sheets['Элементы'],[['C-1','Иное название','Задача','',at(1),'Готово']],{origin:-1});
  expect(()=>parseWorkbook(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),'conflict.xlsx',CUT)).toThrow('Противоречивые');
 });
 it('AC-037/045: отсутствующий лист связей не равен подтверждённо пустому',()=>{
  const book=XLSX.read(linkedWorkbook(),{type:'buffer'});
  book.Sheets['Связи']=XLSX.utils.aoa_to_sheet([['Откуда','Связь','Куда']]);
  let g=parseWorkbook(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),'empty.xlsx',CUT).hierarchy!;
  expect(g.nodes['A-1'].branchCoverage).toBe('complete');expect(g.edges).toHaveLength(0);
  delete book.Sheets['Связи'];book.SheetNames=book.SheetNames.filter(n=>n!=='Связи');
  g=parseWorkbook(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),'unknown.xlsx',CUT).hierarchy!;
  expect(g.nodes['A-1'].branchCoverage).toBe('unavailable');expect(g.coverage).toBe('partial');
 });
 it('сохраняет граф, DF и точную историю обычной задачи',()=>{const s=parseWorkbook(linkedWorkbook(),'linked.xlsx',CUT);expect(s.hierarchy?.nodes['B-1'].type).toBe('epic');expect(s.hierarchy?.nodes['C-1'].historyCoverage).toBe('complete');expect(s.epics).toHaveLength(1);});
 it('ошибка одной истории сохраняет другие; Jira-файл не считает вспомогательный лист вторым основным',()=>{const s=parseWorkbook(linkedWorkbook(true),'linked.xlsx',CUT);expect(s.hierarchy?.nodes['C-1'].historyCoverage).toBe('unavailable');expect(s.hierarchy?.nodes['B-1'].history).toBeDefined();expect(parseFileCandidates(linkedWorkbook(),'linked.xlsx').candidates.map(x=>x.requestedKey)).toEqual(['A-1']);});
});
