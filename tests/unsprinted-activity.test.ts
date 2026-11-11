import {describe,it,expect} from 'vitest';
import {analyzeSprints} from '../server/sprint-analysis';
import {fixture,node,task,at,sprint} from './sprint-fixtures';
import {DAY_MS} from '../shared/statuses';
const I=(a:number,b:number)=>({start:at(a),end:at(b)});
function setup(project='TEXT',windows:number[][]=[[4,7]],mixed=false){
 const f=fixture();f.graph.nodes['3']=node('3','task',windows);f.graph.nodes['3'].key=`${project}-3`;
 f.input.tasks['3']={...task('3',[]),calendarIds:[],calendarCoverage:'partial'};
 if(!mixed){f.graph.edges=f.graph.edges.filter(e=>e.parent!=='4');delete f.input.tasks['5'];}
 else {f.input.sprints={'11':sprint('11',1,15)};f.input.calendars['100'].sprintIds=['11'];f.input.tasks['5'].sprintIds=[];}
 return f;
}
const row=(f:ReturnType<typeof fixture>)=>analyzeSprints(f.graph,f.input).rows['1'];
describe('FR-054 exact activity',()=>{
 it.each(['TEXT','CONTENT','MLE','UX'])('%s covers exact dates and measures the full cycle',project=>{
  const r=row(setup(project));expect(r.focus).toMatchObject({state:'known',totalMs:26*DAY_MS,evaluatedMs:29*DAY_MS,coveredMs:3*DAY_MS,scope:'cycle'});expect(r.segments).toEqual([]);expect(r.focus!.covered).toEqual([I(4,7)]);
 });
 it('AC-139 mixed: 3 active days cover only 3 of 14, including old gaps',()=>{
  const r=row(setup('TEXT',[[4,7]],true));expect(r.focus).toMatchObject({state:'known',totalMs:11*DAY_MS,scope:'sprints'});expect(r.gaps).toEqual([I(1,4),I(7,15)]);expect(r.segments[0].state).toBe('empty');
 });
 it('AC-143 other projects do not fall back on an empty Sprint field',()=>{expect(row(setup('HOTELS')).focus!.state).toBe('unknown');});
 it('AC-140 historical membership prevents fallback even when the current field is empty',()=>{
  const f=setup();f.input.tasks['3'].changes=[{id:'s',at:at(8),fromIds:['11'],toIds:[]}];expect(row(f).focus!.state).toBe('unknown');
 });
 it('AC-141 incomplete or contradictory membership remains unknown',()=>{
  const f=setup();f.input.tasks['3'].membershipCoverage='partial';expect(row(f).focus!.totalMs).toBeNull();
  f.input.tasks['3'].membershipCoverage='complete';f.input.tasks['3'].changes=[{id:'s',at:at(8),fromIds:[],toIds:['11']}];expect(row(f).focus!.totalMs).toBeNull();
 });
 it('future addition is validated but does not invent past membership; cutoff addition counts',()=>{
  const f=setup();f.input.tasks['3'].sprintIds=['11'];f.input.tasks['3'].changes=[{id:'s',at:at(31),fromIds:[],toIds:['11']}];expect(row(f).focus!.totalMs).toBe(26*DAY_MS);
  f.input.tasks['3'].changes[0].at=at(30);expect(row(f).focus!.totalMs).toBeNull();
 });
 it('AC-142 uses subtasks, retains known activity and bounds unknown exactly',()=>{
  const f=setup('TEXT',[[2,20]],true);f.graph.nodes['6']=node('6','subtask',[[8,10]]);f.input.tasks['3'].subtaskIds=['6'];expect(row(f).focus!.totalMs).toBe(12*DAY_MS);
  delete f.graph.nodes['6'].statusCategories['3'];const r=row(f);expect(r.focus!.unknown).toEqual([I(8,10)]);expect(r.gaps).toEqual([I(1,8),I(10,15)]);
 });
 it('AC-153 excludes Deferred and ends at experiment',()=>{
  const f=setup('TEXT',[[11,17]]),n=f.graph.nodes['1'],h=n.history!;
  h.statusChanges=[{id:'a',at:at(3),from:'[HF] Реализация',to:'[HF] Отложено',fromId:'10',toId:'11'},{id:'b',at:at(8),from:'[HF] Отложено',to:'[HF] Реализация',fromId:'11',toId:'10'},{id:'c',at:at(21),from:'[HF] Реализация',to:'[HF] Эксперимент',fromId:'10',toId:'12'}];
  h.currentStatus=n.currentStatus='[HF] Эксперимент';h.currentStatusId=n.currentStatusId='12';if('proof' in h)h.proof={expected:3,received:3,terminal:true,adapterVersion:'fixture'};n.statusCategories['12']='indeterminate';
  expect(row(f).focus).toMatchObject({totalMs:9*DAY_MS,evaluatedMs:15*DAY_MS,deferredMs:5*DAY_MS});
 });
 it('AC-154 unions overlap and shared descendants without counting twice',()=>{
  const f=setup('TEXT',[[1,6]]);f.graph.nodes['5']=node('5','task',[[4,9]]);f.graph.nodes['5'].key='UX-5';f.input.tasks['5']={...task('5',[]),calendarIds:[],calendarCoverage:'partial'};f.graph.edges.push({parent:'4',child:'5'},{parent:'4',child:'3'});f.input.asOf=f.graph.asOf=at(15);expect(row(f).focus!.totalMs).toBe(6*DAY_MS);
 });
 it('AC-155 never turns unknown or empty composition into a full-cycle result',()=>{
  const f=setup();f.graph.nodes['4'].branchCoverage='partial';expect(row(f).focus!.state).toBe('unknown');f.graph.edges=[];expect(row(f).focus!.state).toBe('unknown');
 });
 it('Q4: membership alone is not work; positive sprint work still covers a whole sprint',()=>{
  const f=setup('TEXT',[[4,7]],true);f.input.tasks['5'].sprintIds=['11'];expect(row(f).focus!.totalMs).toBe(11*DAY_MS);expect(row(f).gaps).toEqual([]);
  f.graph.nodes['5']=node('5','task',[[12,13]]);expect(row(f).focus!.totalMs).toBe(0);
 });
});
