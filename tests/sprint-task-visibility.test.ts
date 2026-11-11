import {it,expect} from 'vitest';
import {analyzeSprints} from '../server/sprint-analysis';
import {fixture,node,sprint,at} from './sprint-fixtures';
import type {SprintRow} from '../shared/sprints';
import {visibleSprints,sprintBounds} from '../src/SprintRows';
const shown=(r:SprintRow)=>visibleSprints(r).map(s=>s.sprintId);
import {visibilityFixture} from './sprint-visibility-fixture';
it('AC-088: hide every nonworking sprint, preserve complete analytical segments; epic calculation is independent',()=>{
 const f=visibilityFixture(),r=analyzeSprints(f.graph,f.input);
 expect(shown(r.rows['3'])).toEqual(['11','17']);
 expect(r.rows['3'].segments).toHaveLength(7);expect(r.rows['3'].segments.find(s=>s.sprintId==='17')!.end).toBe(at(25));
 expect(shown(r.rows['2'])).toEqual(['11','17']);expect(shown(r.rows['1'])).toEqual(['11','17']);
 expect(sprintBounds(r).some(s=>s.end===at(30))).toBe(true);
 const before=r.rows['1'];f.graph.nodes['3'].created=f.graph.nodes['3'].history!.historyStart=at(1);
 expect(analyzeSprints(f.graph,f.input).rows['1']).toEqual(before);
});
it('AC-089: reopening does not bridge a closed interval, consecutive open statuses do merge',()=>{
 const f=fixture();f.graph.nodes['3']=node('3','task',[[2,8],[15,22]]);f.input.tasks['3'].sprintIds=[];
 const r=analyzeSprints(f.graph,f.input);expect(shown(r.rows['3'])).toEqual([]);
 expect(analyzeSprints(structuredClone(f.graph),JSON.parse(JSON.stringify(f.input)))).toEqual(r);
});
it('AC-089: included idle sprint is hidden even across closure',()=>{
 const f=visibilityFixture();f.input.tasks['3'].sprintIds=['14'];const r=analyzeSprints(f.graph,f.input).rows['3'];
 expect(r.segments.find(s=>s.sprintId==='14')!.state).toBe('empty');expect(shown(r)).not.toContain('14');
});
it('AC-089: unknown membership is not absence, unknown history does not invent closure',()=>{
 const f=visibilityFixture();f.input.tasks['3'].membershipCoverage='partial';expect(shown(analyzeSprints(f.graph,f.input).rows['3'])).toEqual([]);
 f.input.tasks['3'].membershipCoverage='complete';f.graph.nodes['3'].historyCoverage='partial';expect(shown(analyzeSprints(f.graph,f.input).rows['3'])).toEqual([]);
});
it('AC-089: active sprint without work is hidden while its observed interval remains analytical',()=>{
 const f=fixture();f.graph.nodes['3']=node('3');f.input.tasks['3'].sprintIds=[];f.input.sprints['13']=sprint('13',15,40,'active');
 expect(shown(analyzeSprints(f.graph,f.input).rows['3'])).toEqual([]);
});
