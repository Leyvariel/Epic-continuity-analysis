import {it,expect} from 'vitest';
import {analyzeSprints} from '../server/sprint-analysis';
import {fixture,node,sprint,at} from './sprint-fixtures';
import type {SprintRow} from '../shared/sprints';
const hidden=(r:SprintRow)=>(r as SprintRow & {hiddenSprintIds?:string[]}).hiddenSprintIds??[];
import {visibilityFixture} from './sprint-visibility-fixture';
it('AC-088: hide boundary/outer empty sprints, keep inner empty and full membership sprints; epic calculation is independent',()=>{
 const f=visibilityFixture(),r=analyzeSprints(f.graph,f.input);
 expect(hidden(r.rows['3'])).toEqual(['15','16','13','14']);
 expect(r.rows['3'].segments).toHaveLength(7);expect(r.rows['3'].segments.find(s=>s.sprintId==='17')!.end).toBe(at(25));
 expect(hidden(r.rows['2'])).toEqual([]);expect(hidden(r.rows['1'])).toEqual([]);
 const before=r.rows['1'];f.graph.nodes['3'].created=f.graph.nodes['3'].history!.historyStart=at(1);
 expect(analyzeSprints(f.graph,f.input).rows['1']).toEqual(before);
});
it('AC-089: reopening does not bridge a closed interval, consecutive open statuses do merge',()=>{
 const f=fixture();f.graph.nodes['3']=node('3','task',[[2,8],[15,22]]);f.input.tasks['3'].sprintIds=[];
 const r=analyzeSprints(f.graph,f.input);expect(hidden(r.rows['3'])).toEqual(['12']);
 expect(analyzeSprints(structuredClone(f.graph),JSON.parse(JSON.stringify(f.input)))).toEqual(r);
});
it('AC-089: included idle sprint is retained even across closure',()=>{
 const f=visibilityFixture();f.input.tasks['3'].sprintIds=['14'];const r=analyzeSprints(f.graph,f.input).rows['3'];
 expect(r.segments.find(s=>s.sprintId==='14')!.state).toBe('empty');expect(hidden(r)).not.toContain('14');
});
it('AC-089: unknown membership is not absence, unknown history does not invent closure',()=>{
 const f=visibilityFixture();f.input.tasks['3'].membershipCoverage='partial';expect(hidden(analyzeSprints(f.graph,f.input).rows['3'])).toEqual(['15']);
 f.input.tasks['3'].membershipCoverage='complete';f.graph.nodes['3'].historyCoverage='partial';expect(hidden(analyzeSprints(f.graph,f.input).rows['3'])).toEqual(['15']);
});
it('AC-089: active sprint uses observed end and remains inside an open task',()=>{
 const f=fixture();f.graph.nodes['3']=node('3');f.input.tasks['3'].sprintIds=[];f.input.sprints['13']=sprint('13',15,40,'active');
 expect(hidden(analyzeSprints(f.graph,f.input).rows['3'])).toEqual([]);
});
