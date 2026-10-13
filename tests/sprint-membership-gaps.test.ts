import {it,expect} from 'vitest';
import {fixture,node,at,sprint,task} from './sprint-fixtures';
import {analyzeSprints} from '../server/sprint-analysis';
const gaps=(f:ReturnType<typeof fixture>)=>analyzeSprints(f.graph,f.input).rows['1'].gaps;
it('05.10: included but idle tasks prevent epic gaps, although sprint work stays empty',()=>{
 const f=fixture();f.graph.nodes['3']=node('3');expect(gaps(f)).toEqual([]);expect(analyzeSprints(f.graph,f.input).rows['1'].segments.every(s=>s.state==='empty')).toBe(true);
});
it('05.10: proven no membership creates closed-sprint gaps even if statuses and Sub-task roster are unavailable',()=>{
 const f=fixture();for(const id of ['3','5']){f.input.tasks[id].sprintIds=[];f.input.tasks[id].rosterCoverage='unavailable';f.graph.nodes[id].historyCoverage='unavailable';}
 expect(gaps(f)).toEqual([{start:at(1),end:at(22)}]);
});
it('05.10: unknown membership never becomes a gap, even when task was provably idle',()=>{
 const f=fixture();f.graph.nodes['3']=node('3');f.input.tasks['3'].membershipCoverage='unavailable';f.input.tasks['5'].sprintIds=[];expect(gaps(f)).toEqual([]);
});
it('05.10: inclusion of any descendant covers entire overlapping sprint without requiring work',()=>{
 const f=fixture();f.graph.nodes['3']=node('3');f.graph.nodes['5']=node('5');f.input.sprints={'11':sprint('11',1,15),'12':sprint('12',8,22)};f.input.calendars['100'].sprintIds=['11','12'];f.input.tasks['3']=task('3',[]);f.input.tasks['5']=task('5',['12']);
 expect(gaps(f)).toEqual([{start:at(1),end:at(8)}]);expect(analyzeSprints(f.graph,f.input).rows['1'].segments.every(s=>s.state==='empty')).toBe(true);
});
it('05.10: incomplete graph or calendar cannot prove a gap, and open sprints are not final negatives',()=>{
 const f=fixture();for(const t of Object.values(f.input.tasks))t.sprintIds=[];
 f.graph.nodes['2'].branchCoverage='partial';expect(gaps(f)).toEqual([]);f.graph.nodes['2'].branchCoverage='complete';f.input.tasks['3'].calendarCoverage='partial';expect(gaps(f)).toEqual([]);
 f.input.tasks['3'].calendarCoverage='complete';f.input.sprints['13']={...f.input.sprints['13'],state:'active',completeDate:null};expect(gaps(f)).toEqual([{start:at(1),end:at(15)}]);
});
it('05.10: membership after closing is not retroactive, while inclusion inside the sprint removes its whole gap',()=>{
 const f=fixture();f.input.tasks['5'].sprintIds=[];f.input.tasks['3'].sprintIds=['11'];f.input.tasks['3'].changes=[{id:'add',at:at(9),fromIds:[],toIds:['11']}];
 expect(gaps(f)).toEqual([{start:at(1),end:at(22)}]);f.input.tasks['3'].changes[0].at=at(7);expect(gaps(f)).toEqual([{start:at(8),end:at(22)}]);
});
