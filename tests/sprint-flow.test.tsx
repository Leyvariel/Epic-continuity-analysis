import {it,expect} from 'vitest';
import {analyzeSprints,observedSprint} from '../server/sprint-analysis';
import {fixture,node,at,task,sprint,history} from './sprint-fixtures';
import type {HierarchyNodeInput} from '../shared/hierarchy';
import {sprintInputsSchema} from '../server/jira/sprint-schema';
import {controlFixture,t} from './sprint-control-fixture';
it('B01/B05: agreed Moscow fixture has exactly 4 gaps, 26 days, separate rhythms and preserved stage history',()=>{
 const {graph,input}=controlFixture();const r=analyzeSprints(graph,input),gaps=r.rows['1'].gaps;
 expect(gaps.map(s=>[s.start,s.end])).toEqual([['2026-06-15','2026-06-22'],['2026-07-13','2026-07-18'],['2026-08-17','2026-08-24'],['2026-09-07','2026-09-14']].map(([a,b])=>[new Date(t(a)).toISOString(),new Date(t(b)).toISOString()]));
 expect(gaps.reduce((v,s)=>v+Date.parse(s.end)-Date.parse(s.start),0)/86400000).toBe(26);
 expect(r.rows['1'].segments.filter(s=>s.state==='work').map(s=>s.name).sort()).toEqual(['A1','A3','A5','A7','B1']);expect(r.rows['1'].segments).toHaveLength(10);
 expect(r.rows['1'].phases.map(s=>s.status)).toContain('[HF] Отложено');
});
it('B04/B17: carry-over, removed before start, renamed key, identical names and zero-duration touch use IDs',()=>{
 const {graph,input}=fixture();input.sprints['12'].name=input.sprints['11'].name;graph.nodes['3']=node('3','task',[[2,3],[9,10]]);graph.nodes['3'].key='NEW-3';
 input.tasks['3'].changes=[{id:'a',at:at(1),fromIds:[],toIds:['11']},{id:'b',at:at(8),fromIds:['11'],toIds:['12']},{id:'c',at:at(14),fromIds:['12'],toIds:[]}];input.tasks['3'].sprintIds=[];
 let r=analyzeSprints(graph,input);expect(r.rows['3'].segments.map(s=>s.state)).toEqual(['work','work','empty']);expect(r.rows['1'].segments[0].taskKeys).toEqual(['NEW-3']);
 graph.nodes['3']=node('3','task',[[8,9]]);r=analyzeSprints(graph,input);expect(r.rows['3'].segments[0].state).toBe('empty');
});
it('B22: closed-empty, active-empty and later observed closure have precise precedence',()=>{
 const {graph,input}=fixture();graph.nodes['3']=node('3');graph.asOf=input.asOf=at(10);input.sprints={'11':sprint('11',1,8),'12':sprint('12',5,19,'active')};input.calendars['100'].sprintIds=['11','12'];for(const v of Object.values(input.tasks))v.sprintIds=[];
 let r=analyzeSprints(graph,input).rows['1'];expect(r.gaps).toEqual([{start:at(1),end:at(5)}]);expect(r.preliminary).toEqual([{start:at(5),end:at(10)}]);
 graph.asOf=input.asOf=at(12);graph.nodes['3']=node('3','task',[[11,12]]);input.tasks['3'].sprintIds=['12'];r=analyzeSprints(graph,input).rows['1'];expect(r.gaps).toEqual([{start:at(1),end:at(5)}]);expect(r.preliminary).toEqual([]);
 graph.nodes['3']=node('3');input.tasks['3'].sprintIds=[];graph.asOf=input.asOf=at(20);input.sprints['12']=sprint('12',5,19);r=analyzeSprints(graph,input).rows['1'];expect(r.gaps).toEqual([{start:at(1),end:at(19)}]);
 const s={...sprint('99',1,10),completeDate:'2026-09-10T10:01:00Z'};expect(observedSprint(s,Date.parse('2026-09-10T10:00:00Z')).kind).toBe('active');
});
it('B23: membership added after cutoff is not retroactive; broken later chain invalidates; exactly cutoff has no time',()=>{
 const {graph,input}=fixture();graph.asOf=input.asOf=at(10);graph.nodes['3']=node('3','task',[[2,11]]);
 input.tasks['3'].changes=[{id:'a',at:at(11),fromIds:[],toIds:['11','12','13']}];expect(analyzeSprints(graph,input).rows['3'].segments.every(s=>s.state==='empty'||s.state==='active-empty')).toBe(true);
 input.tasks['3'].changes=[];graph.nodes['3']=node('3','task',[[10,11]]);expect(analyzeSprints(graph,input).rows['3'].segments.some(s=>s.state==='work')).toBe(false);
 input.tasks['3'].changes=[{id:'a',at:at(11),fromIds:[],toIds:['11']},{id:'b',at:at(12),fromIds:['12'],toIds:['11','12','13']}];graph.nodes['3']=node('3','task',[[2,11]]);expect(analyzeSprints(graph,input).rows['3'].segments[0].state).toBe('unknown');
});
it('B25: one unknown interval makes whole possible sprint unknown; another positive interval takes precedence in time union',()=>{
 const {graph,input}=fixture();input.sprints={'11':sprint('11',1,15),'12':sprint('12',4,12)};input.calendars['100'].sprintIds=['11','12'];input.tasks['3'].sprintIds=['11'];input.tasks['5'].sprintIds=['12'];delete graph.nodes['3'].statusCategories['3'];graph.nodes['5']=node('5','task',[[6,7]]);
 const r=analyzeSprints(graph,input).rows['1'];expect(r.unknown).toEqual([{start:at(1),end:at(4)},{start:at(12),end:at(15)}]);expect(r.gaps).toEqual([]);
});
it('B26/B28/B29: incomplete root cannot contaminate independent root, calendar holes remain holes after serialization',()=>{
 const {graph,input}=fixture();graph.nodes['3']=node('3');graph.nodes['4'].history=history('A-4',[],'[HF] Реализация');graph.roots['A-4']='4';graph.edges=graph.edges.filter(e=>e.child!=='4');graph.nodes['1'].branchCoverage='partial';
 input.sprints={'11':sprint('11',1,8),'12':sprint('12',10,15)};input.calendars['100'].sprintIds=['11','12'];for(const x of Object.values(input.tasks))x.sprintIds=[];
 const r=analyzeSprints(graph,input);expect(r.rows['1'].gaps).toEqual([]);expect(r.rows['4'].gaps).toEqual([{start:at(1),end:at(8)},{start:at(10),end:at(15)}]);
 expect(analyzeSprints(structuredClone(graph),sprintInputsSchema.parse(JSON.parse(JSON.stringify(input))))).toEqual(r);
 graph.edges.push({parent:'4',child:'1'},{parent:'1',child:'4'});expect(analyzeSprints(graph,input).rows['4'].gaps).toEqual([]);
});
it('B27: unknown child, absent edge and hidden rejected partial epic each block false negatives',()=>{
 for(const mode of ['unknown','missing-edge','rejected']){
  const {graph,input}=fixture();graph.nodes['3']=node('3');
  if(mode==='unknown'){graph.nodes['4'].type='unknown';graph.nodes['4'].resolution=null;}
  else{graph.nodes['4'].branchCoverage='partial';if(mode==='rejected')graph.nodes['4'].resolution='Отклонено';}
  const r=analyzeSprints(graph,input).rows['1'];expect(r.gaps).toEqual([]);expect(r.unknown).toEqual([{start:at(1),end:at(30)}]);expect(r.warnings.join(' ')).toContain('Состав');
 }
});
it('B30/B32/B34: own sprint segments across three levels survive restore even when another branch covers same time',()=>{
 const {graph,input}=fixture();graph.nodes['3']=node('3');graph.nodes['5']=node('5','task',[[9,10]]);input.tasks['3'].sprintIds=['11'];input.tasks['5'].sprintIds=['12'];input.sprints={'11':sprint('11',1,15),'12':sprint('12',8,22)};input.calendars['100'].sprintIds=['11','12'];
 graph.nodes['2'].history=history('A-2',[],'[DF] Выполнение');const r=analyzeSprints(graph,input);expect(r.rows['2'].segments.every(s=>s.state==='empty')).toBe(true);expect(r.rows['1'].segments.map(s=>s.state)).toEqual(['empty','work']);expect(r.rows['1'].gaps).toEqual([]);
 expect(analyzeSprints(graph,sprintInputsSchema.parse(JSON.parse(JSON.stringify(input))))).toEqual(r);
});
