import { expect, it } from 'vitest';
import { buildHierarchy } from '../server/related-timeline';
import { calculateTimeline } from '../server/timeline';
import { metricsFor, relatedMetricValue } from '../shared/metrics';
import { DAY_MS } from '../shared/statuses';
import { node } from './hierarchy-fixtures';
import { modelHistory } from './status-model-fixtures';
import type { HierarchyInput } from '../shared/hierarchy';

function fixture() {
 const child=modelHistory([['Открыто',20],['В работе',2],['Открыто',3],['В работе',1]],{key:'CHILD-1'});
 const input:HierarchyInput={version:1,asOf:child.asOf,coverage:'complete',warnings:[],roots:{'ROOT-1':'root'},nodes:{
  root:{...node('root'),key:'ROOT-1'},
  child:{...node('child','task'),key:'CHILD-1',created:child.history.historyStart,currentStatus:child.history.currentStatus,history:child.history,statusCategories:{'[HF] Закрыт':'done'}},
 },edges:[{parent:'root',child:'child'}]};
 const f=modelHistory([['[HF] Реализация',10]],{key:'ROOT-1'});
 return {input,root:calculateTimeline(f.summary,f.history,f.asOf)};
}
it('AC-105/120: own child return excludes initial waiting and never supplies child TTM',()=>{
 const f=fixture(),graph=buildHierarchy(f.input)!,child=graph.nodes.child;
 expect(relatedMetricValue(child,'open')).toBe(3*DAY_MS);
 expect(relatedMetricValue(child,'status:в работе')).toBe(3*DAY_MS);
 expect(relatedMetricValue(child,'ttm')).toBeNull();expect(relatedMetricValue(child,'ttmWithoutFlag')).toBeNull();
 expect(f.root.ttmMs).toBe(10*DAY_MS);
 expect(metricsFor([f.root],'history',graph).map(c=>c.id)).toEqual(['ttm','ttmWithoutFlag','open','implementation','status:в работе']);
});
it('AC-114/106: child-only columns remain known with unavailable values; excluded nodes add no columns',()=>{
 const f=fixture(); f.input.nodes.child.historyCoverage='unavailable';
 f.input.nodes.rejected={...node('rejected'),resolution:'Отклонено',currentStatus:'[HF] Релиз'};
 f.input.nodes.orphan={...node('orphan'),currentStatus:'[HF] Эксперимент'};
 f.input.nodes.sub={...node('sub','subtask'),currentStatus:'[HF] Оценка результата'};
 f.input.edges.push({parent:'root',child:'rejected'},{parent:'root',child:'sub'});
 const graph=buildHierarchy(f.input)!;
 expect(relatedMetricValue(graph.nodes.child,'status:в работе')).toBeNull();
 const ids=metricsFor([f.root],'history',graph).map(c=>c.id);
 expect(ids).toContain('status:в работе');expect(ids).not.toContain('release');expect(ids).not.toContain('experiment');expect(ids).not.toContain('evaluation');
});
it('preserves DF and arbitrary child names instead of merging them into HF stages',()=>{
 const f=fixture();const h=f.input.nodes.child.history!;
 h.statusChanges=h.statusChanges.map(c=>({...c,from:c.from==='В работе'?'[DF] Реализация':c.from,to:c.to==='В работе'?'[DF] Реализация':c.to}));
 const graph=buildHierarchy(f.input)!,child=graph.nodes.child;
 expect(relatedMetricValue(child,'implementation')).toBe(0);
 expect(relatedMetricValue(child,'status:[df] реализация')).toBe(3*DAY_MS);
 expect(metricsFor([f.root],'history',graph).filter(c=>c.id.startsWith('status:')).map(c=>c.name)).toEqual(['[DF] Реализация']);
});
