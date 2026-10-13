import { describe, it, expect } from 'vitest';
import { relatedTimeline } from '../server/related-timeline';
import { node, history, CUT, at } from './hierarchy-fixtures';
describe('T004: полный жизненный цикл', () => {
  it('обычная задача даёт точные 2+4 дня и конечный маркер', () => { const n={...node('C-1','task'),history:history()}; const t=relatedTimeline(n,CUT);expect(t.intervals.map(x=>x.durationMs)).toEqual([172800000,345600000]);expect(t.end).toBe(new Date(at(7)).toISOString());expect(t.closed).toBe(true); });
  it('переоткрытие сохраняет промежуточное закрытие и продолжается до среза', () => {const t=relatedTimeline({...node('C-1','task'),history:history('C-1',true)},CUT);expect(t.intervals.map(x=>x.durationMs)).toEqual([172800000,345600000,86400000,172800000]);expect(t.closed).toBe(false);});
  it('категория имеет приоритет над именем', () => {const n={...node('C-1','task'),history:history(),statusCategories:{'Готово':'indeterminate'}};expect(relatedTimeline(n,CUT).end).toBe(new Date(CUT).toISOString());expect(relatedTimeline(n,CUT).warnings.length).toBeGreaterThan(0);});
  it('после среза нет отрицательной полосы, ровно на срезе нет длительности', () => {const n={...node('C-1','task'),created:at(11)};expect(relatedTimeline(n,CUT).state).toBe('not-present');expect(relatedTimeline(n,CUT).intervals).toEqual([]);});
  it('не угадывает неизвестное имя и не принимает разрыв', () => {const h=history();h.currentStatus='Архив';h.statusChanges[1].to='Архив';expect(relatedTimeline({...node('C-1','task'),history:h},CUT).state).toBe('unavailable');h.currentStatus='Готово';h.statusChanges[1].to='Готово';h.statusChanges[1].from='Несогласованный';expect(relatedTimeline({...node('C-1','task'),history:h},CUT).state).toBe('unavailable');});
});

it.each(['Закрыт','Закрыто','Закрыта','Готово','Выполнен','Выполнено','Выполнена','Завершён','Завершено','Завершена','Решён','Решено','Решена','Closed','Done','Completed','Resolved'])('закрытие задачи по названию %s',status=>{const h=history();h.currentStatus=status;h.statusChanges[1].to=status;const t=relatedTimeline({...node('C-1','task'),history:h},CUT);expect(t.closed).toBe(true);expect(t.end).toBe(new Date(at(7)).toISOString());});
it.each(['[HF] Закрыт','[DF] Закрыт'])('закрытие эпика без категории %s',status=>{const h=history();h.currentStatus=status;h.statusChanges[1].to=status;expect(relatedTimeline({...node('C-1','epic'),history:h},CUT).closed).toBe(true);});
it.each(['Открыт','Открыто','Открыта','Новый','Новая','Новое','В работе','В процессе','Переоткрыт','Переоткрыто','Переоткрыта','Open','New','To Do','In Progress','Reopened'])('незакрывающий статус задачи %s',status=>{
 const h=history();h.currentStatus=status;h.statusChanges[1].to=status;
 const t=relatedTimeline({...node('C-1','task'),history:h},CUT);
 expect(t.closed).toBe(false);expect(t.end).toBe(new Date(CUT).toISOString());expect(t.intervals.at(-1)?.durationMs).toBe(259200000);
});
it.each([
 ['Архив команды','done',true],['Архив команды','completed',true],['В работе','new',false],['В работе','indeterminate',false],['В работе','in-flight',false],['Готово','undefined',true],['Готово','неизвестная',true],['В работе','done',true],
] as const)('категория %s / %s определяет закрытие %s', (status,category,closed)=>{
 const h=history();h.currentStatus=status;h.statusChanges[1].to=status;
 const t=relatedTimeline({...node('C-1','task'),history:h,statusCategories:{[status]:category}},CUT);
 expect(t.closed).toBe(closed);expect(t.end).toBe(new Date(closed?at(7):CUT).toISOString());
});
it('флаги не меняют полосы; последовательное закрытие заканчивается последним входом',()=>{
 const h=history();h.statusChanges.push({id:'3',at:at(8),from:'Готово',to:'Закрыто'});h.currentStatus='Закрыто';
 const value={...node('C-1','task'),history:h},t=relatedTimeline(value,CUT);
 expect(t.end).toBe(new Date(at(8)).toISOString());expect(t.intervals.at(-1)?.status).toBe('Готово');
 const changed=relatedTimeline({...value,history:{...h,currentFlag:true,flagAvailable:true,flagChanges:[{id:'f',at:at(2),from:false,to:true}]}},CUT);
 expect(changed).toEqual(t);
});
it('нулевая история и закрытие с создания имеют корректные границы',()=>{const h={...history(),historyStart:CUT,currentStatus:'Готово',statusChanges:[]};const t=relatedTimeline({...node('C-1','task'),created:CUT,history:h},CUT);expect(t.intervals).toEqual([]);expect(t.start).toBe(new Date(CUT).toISOString());expect(t.end).toBe(t.start);});
