import {describe,it,expect} from 'vitest';
import {analyzeSprints} from '../server/sprint-analysis';
import {fixture,node,sprint,at} from './sprint-fixtures';
import {DAY_MS} from '../shared/statuses';
import type {SprintInputs} from '../shared/sprints';
import type {HierarchyNodeInput} from '../shared/hierarchy';

function statuses(n:HierarchyNodeInput, entries:[number,string][]) {
 const h=n.history!;h.statusChanges=entries.slice(1).map(([day,to],i)=>({id:`c${i}`,at:at(day),from:entries[i][1],to,fromId:`s${i}`,toId:`s${i+1}`,order:i}));
 h.currentStatus=n.currentStatus=entries.at(-1)![1];h.currentStatusId=n.currentStatusId=`s${entries.length-1}`;
 n.statusCategories=Object.fromEntries(entries.map(([,s],i)=>[`s${i}`,s==='[HF] Закрыт'?'done':s==='Открыто'?'new':'indeterminate']));
 h.historyCount=h.statusChanges.length;if('source' in h)h.proof={expected:h.historyCount,received:h.historyCount,terminal:true,adapterVersion:'fixture'};
}
function calendar(input:SprintInputs, spans:[number,number,boolean?][]) {
 input.sprints=Object.fromEntries(spans.map(([a,b,active],i)=>[`${i+11}`,sprint(`${i+11}`,a,b,active?'active':'closed')]));
 input.calendars['100'].sprintIds=Object.keys(input.sprints);
 for(const t of Object.values(input.tasks))t.sprintIds=Object.keys(input.sprints);
}
const result=(f:ReturnType<typeof fixture>)=>analyzeSprints(f.graph,f.input).rows['1'].focus!;
const I=(a:number,b:number)=>({start:at(a),end:at(b)});
const days=(n:number|null)=>n===null?null:n/DAY_MS;
describe('FR-049: implementation cycles',()=>{
 it('AC-121: includes testing/release, excludes Deferred and experiment',()=>{
  const f=fixture();statuses(f.graph.nodes['1'],[[1,'[HF] Реализация'],[6,'[HF] Отложено'],[10,'Тестирование эпика'],[13,'Релиз'],[15,'[HF] Эксперимент']]);
  const r=result(f);expect(r.cycles).toEqual([I(1,15)]);expect(r.window).toEqual([I(1,6),I(10,15)]);expect(days(r.windowMs)).toBe(10);expect(days(r.deferredMs)).toBe(4);
 });
 it('AC-122: repeat implementation does not duplicate cycles; reentry after experiment counts to cutoff',()=>{
  const f=fixture();statuses(f.graph.nodes['1'],[[1,'Открыто'],[3,'[HF] Реализация'],[6,'[HF] Валидация'],[8,'[HF] Реализация'],[10,'[HF] Эксперимент'],[20,'[HF] Реализация']]);
  expect(result(f).cycles).toEqual([I(3,10),I(20,30)]);
 });
 it('AC-123: distinguishes no implementation, broken history and unknown early TTM',()=>{
  const f=fixture();statuses(f.graph.nodes['1'],[[1,'Открыто']]);expect(result(f).state).toBe('not-started');expect(result(f).totalMs).toBeNull();
  statuses(f.graph.nodes['1'],[[1,'Discovery'],[5,'[HF] Реализация'],[15,'[HF] Эксперимент']]);expect(result(f).cycles).toEqual([I(5,15)]);
  f.graph.nodes['1'].history!.statusChanges[1].fromId='broken';expect(result(f).state).toBe('unknown');
 });
 it('AC-124: final closure ends the window but intermediate closure does not',()=>{
  const f=fixture();statuses(f.graph.nodes['1'],[[1,'[HF] Реализация'],[8,'[HF] Закрыт'],[12,'[HF] Реализация'],[18,'[HF] Закрыт']]);
  expect(result(f).cycles).toEqual([I(1,18)]);
 });
 it('AC-124: zero-length and cutoff transitions are observed without inventing a day',()=>{
  const f=fixture();statuses(f.graph.nodes['1'],[[1,'Открыто'],[5,'[HF] Реализация'],[5,'[HF] Эксперимент']]);
  expect(result(f).state).toBe('not-applicable');expect(result(f).cycles).toEqual([I(5,5)]);
  statuses(f.graph.nodes['1'],[[1,'Открыто'],[30,'[HF] Реализация']]);expect(result(f).state).toBe('not-applicable');
 });
 it('validates events after cutoff without adding future time',()=>{
  const f=fixture();statuses(f.graph.nodes['1'],[[1,'[HF] Реализация'],[35,'[HF] Эксперимент']]);expect(result(f).cycles).toEqual([I(1,30)]);
  f.graph.nodes['1'].history!.statusChanges[0].toId='broken';expect(result(f).state).toBe('unknown');
 });
});
describe('FR-050/051: whole sprint work and negative time',()=>{
 it('AC-125/126: includes idle assigned sprints although old membership gap is absent',()=>{
  const f=fixture();f.input.asOf=f.graph.asOf=at(31);calendar(f.input,[[1,11],[11,21],[21,31]]);f.graph.nodes['3']=node('3','task',[[2,3],[22,23]]);
  const row=analyzeSprints(f.graph,f.input).rows['1'];expect(days(row.focus!.totalMs)).toBe(10);expect(row.gaps).toEqual([]);expect(row.focus!.withoutWork).toEqual([I(11,21)]);
 });
 it('AC-127: one active day covers all six days of the cycle inside a 14-day sprint',()=>{
  const f=fixture();calendar(f.input,[[1,15]]);statuses(f.graph.nodes['1'],[[1,'Открыто'],[5,'[HF] Реализация'],[11,'[HF] Эксперимент']]);f.graph.nodes['3']=node('3','task',[[13,14]]);
  expect(result(f)).toMatchObject({totalMs:0,evaluatedMs:6*DAY_MS,coveredMs:6*DAY_MS,state:'known'});
 });
 it('AC-128: any team covers overlaps, shared tasks cannot double-count',()=>{
  const f=fixture();calendar(f.input,[[1,15],[8,22]]);f.graph.nodes['3']=node('3','task',[[9,10]]);f.input.tasks['3'].sprintIds=['12'];f.graph.edges.push({parent:'4',child:'3'});
  expect(days(result(f).totalMs)).toBe(7);expect(days(result(f).evaluatedMs)).toBe(21);
 });
 it('AC-129: excludes calendar gaps, Deferred, and ignores flag',()=>{
  const f=fixture();f.input.asOf=at(31);calendar(f.input,[[1,11],[21,31]]);statuses(f.graph.nodes['1'],[[1,'[HF] Реализация'],[21,'[HF] Отложено'],[25,'[HF] Реализация']]);f.graph.nodes['3']=node('3','task',[[26,27]]);
  expect(result(f)).toMatchObject({totalMs:10*DAY_MS,evaluatedMs:16*DAY_MS,outsideSprintMs:10*DAY_MS,coveredMs:6*DAY_MS});
  f.graph.nodes['1'].history!.currentFlag=true;expect(days(result(f).totalMs)).toBe(10);
 });
 it('AC-130: active absence is provisional until work covers the whole observed sprint',()=>{
  const f=fixture();calendar(f.input,[[1,15,true]]);f.input.asOf=at(6);f.graph.nodes['3']=node('3');expect(result(f)).toMatchObject({state:'preliminary',totalMs:5*DAY_MS,preliminaryMs:5*DAY_MS});
  f.graph.nodes['3']=node('3','task',[[6,7]]);f.input.asOf=at(7);expect(result(f)).toMatchObject({state:'known',totalMs:0});
 });
 it('AC-131: active overlap makes negative time provisional once',()=>{
  const f=fixture();calendar(f.input,[[1,8],[5,19,true]]);f.input.asOf=at(10);f.graph.nodes['3']=node('3');
  expect(result(f)).toMatchObject({totalMs:9*DAY_MS,closedMs:4*DAY_MS,preliminaryMs:5*DAY_MS});
 });
 it('AC-132: possible work covers the whole unknown sprint, positive coverage takes priority',()=>{
  const f=fixture();calendar(f.input,[[1,15],[4,12]]);f.graph.nodes['3']=node('3','task',[[6,7]]);delete f.graph.nodes['3'].statusCategories['3'];f.input.tasks['3'].sprintIds=['11'];
  f.graph.nodes['5']=node('5','task',[[5,6]]);f.input.tasks['5'].sprintIds=['12'];
  expect(result(f)).toMatchObject({state:'unknown',totalMs:null,unknown:[I(1,4),I(12,15)],coveredMs:8*DAY_MS});
 });
 it('AC-133: incomplete calendar is not a gap; independent roots remain measurable',()=>{
  const f=fixture();f.input.tasks['3'].calendarCoverage='partial';f.graph.roots['A-4']='4';
  const r=analyzeSprints(f.graph,f.input);expect(r.rows['1'].focus!.state).toBe('unknown');expect(days(r.rows['4'].focus!.totalMs)).toBe(21);
 });
 it('unbounded unknown includes testing/release outside the old four gap stages',()=>{
  const f=fixture();statuses(f.graph.nodes['1'],[[1,'[HF] Реализация'],[8,'Тестирование эпика']]);f.input.tasks['3'].calendarCoverage='partial';
  expect(result(f).unknown).toEqual([I(8,30)]);
 });
 it('empty proven calendar is not a successful zero, and absent rhythm is unknown',()=>{
  const f=fixture();calendar(f.input,[]);expect(result(f).state).toBe('not-applicable');f.graph.edges=[];expect(result(f).state).toBe('unknown');
 });
 it('work without historical membership does not cover the sprint',()=>{
  const f=fixture();calendar(f.input,[[1,11]]);f.input.tasks['3'].changes=[{id:'x',at:at(5),fromIds:[],toIds:['11']}];expect(days(result(f).totalMs)).toBe(10);
 });
 it('current subtask rule overrides parent work; unknown roster never falls back',()=>{
  const f=fixture();calendar(f.input,[[1,11]]);f.graph.nodes['6']=node('6','subtask');f.input.tasks['3'].subtaskIds=['6'];expect(days(result(f).totalMs)).toBe(10);
  f.input.tasks['3'].subtaskIds=[];f.input.tasks['3'].rosterCoverage='partial';expect(result(f).state).toBe('unknown');
 });
 it('future sprints without dates do not add unknown time',()=>{
  const f=fixture();f.input.sprints.future={...sprint('future',31,40),state:'future',startDate:null,completeDate:null,activatedDate:null};f.input.calendars['100'].sprintIds.push('future');
  expect(days(result(f).totalMs)).toBe(14);
 });
 it('root work survives unknown subbranches, and numerical values are deterministic on restore',()=>{
  const f=fixture();calendar(f.input,[[1,8]]);statuses(f.graph.nodes['1'],[[1,'[HF] Реализация'],[8,'[HF] Эксперимент']]);f.graph.nodes['4'].branchCoverage='partial';
  expect(result(f)).toMatchObject({state:'known',totalMs:0});expect(result(structuredClone(f))).toEqual(result(f));
 });
});

it('FR-049/051: an unrecognized terminal closure cannot extend an unfinished cycle as certain work time',()=>{
 const f=fixture();statuses(f.graph.nodes['1'],[[1,'[HF] Реализация'],[8,'Неизвестное окончание']]);delete f.graph.nodes['1'].statusCategories.s1;
 expect(result(f)).toMatchObject({state:'unknown',totalMs:null});
 // Known experiment already bounds the cycle independently of subsequent closure ambiguity.
 statuses(f.graph.nodes['1'],[[1,'[HF] Реализация'],[8,'[HF] Эксперимент'],[15,'Неизвестное окончание']]);delete f.graph.nodes['1'].statusCategories.s2;
 expect(result(f)).toMatchObject({state:'known',totalMs:0});
});
it('FR-051: full positive coverage proves zero outside-sprint time despite another unknown calendar',()=>{
 const f=fixture();calendar(f.input,[[1,8]]);statuses(f.graph.nodes['1'],[[1,'[HF] Реализация'],[8,'[HF] Эксперимент']]);f.input.tasks['5'].calendarCoverage='partial';
 expect(result(f)).toMatchObject({state:'known',totalMs:0,outsideSprintMs:0});
});
