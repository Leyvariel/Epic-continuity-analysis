import type {HierarchyNodeInput} from '../shared/hierarchy';
import type {SprintFocusResult,SprintSegment} from '../shared/sprints';
import {statusInfo} from '../shared/statuses';
import {statusClosure} from './related-timeline';
import type {StatusSpan} from './sprint-analysis';
import {mergeSpans,intersect,subtractSpans,asIntervals,type Span} from './sprint-intervals';

const length=(spans:Span[])=>mergeSpans(spans).reduce((sum,[a,b])=>sum+b-a,0);
const span=(s:SprintSegment):Span=>[Date.parse(s.start),Date.parse(s.end)];
/** Uses validated status history and the full analytical segments, never their UI visibility. */
export function calculateSprintFocus(node:HierarchyNodeInput,history:StatusSpan[]|null,cutoff:number,segments:SprintSegment[],unbounded:boolean,warnings:string[],exact:{yes:Span[];unknown:Span[];wholeCycle:boolean}={yes:[],unknown:[],wholeCycle:false}):SprintFocusResult {
 const base:SprintFocusResult={scope:exact.wholeCycle?'cycle':'sprints',state:'unknown',cycles:[],window:[],evaluated:[],covered:[],withoutWork:[],preliminary:[],unknown:[],totalMs:null,closedMs:0,preliminaryMs:0,windowMs:0,deferredMs:0,evaluatedMs:0,coveredMs:0,outsideSprintMs:null,reasons:[]};
 if(!history)return {...base,reasons:['Границы реализации не подтверждены полной историей.']};
 const cycles:Span[]=[];let start:number|undefined;
 for(const h of history){const kind=statusInfo(h.status).kind;
  if(kind==='implementation'&&start===undefined)start=h.span[0];
  if(kind==='experiment'&&start!==undefined){cycles.push([start,h.span[0]]);start=undefined;}
 }
 if(start!==undefined){
  // A closure before reopening stays inside the cycle; only the trailing closed run bounds it.
  let finalClose=cutoff;
  for(let i=history.length-1;i>=0;i--){
   const h=history[i],kind=statusInfo(h.status).kind;
   const closed=statusClosure(node,h.status,h.id).closed ?? (kind==='closed'?true:kind!=='unknown'?false:null);
   if(closed===null)return {...base,reasons:['Неизвестно, завершает ли конечный статус цикл реализации.']};
   if(!closed)break;
   finalClose=h.span[0];
  }
  cycles.push([start,Math.max(start,finalClose)]);
 }
 if(!cycles.length)return {...base,state:'not-started',reasons:['Реализация не начата.']};
 base.cycles=cycles.map(([a,b])=>({start:new Date(a).toISOString(),end:new Date(b).toISOString()}));
 const W=subtractSpans(cycles,history.filter(h=>statusInfo(h.status).kind==='deferred').map(h=>h.span));
 base.window=asIntervals(W);base.windowMs=length(W);base.deferredMs=length(cycles)-base.windowMs;
 if(!W.length)return {...base,state:'not-applicable',reasons:['Нет учитываемого времени реализации после исключения Отложено.']};
 const C=segments.map(span),P=[...segments.filter(s=>s.state==='work').map(span),...exact.yes],A=segments.filter(s=>s.lifecycle==='active').map(span);
 const U=unbounded?W:[...segments.filter(s=>s.state==='unknown').map(span),...exact.unknown];
 const D=exact.wholeCycle?W:intersect(W,C),covered=intersect(D,P),unknown=subtractSpans(intersect(unbounded?W:D,U),P),negative=subtractSpans(D,[...P,...U]),preliminary=intersect(negative,A),closed=subtractSpans(negative,A);
 Object.assign(base,{evaluated:asIntervals(D),covered:asIntervals(covered),unknown:asIntervals(unknown),withoutWork:asIntervals(negative),preliminary:asIntervals(preliminary),evaluatedMs:length(D),coveredMs:length(covered),closedMs:length(closed),preliminaryMs:length(preliminary),outsideSprintMs:exact.wholeCycle?0:unbounded&&subtractSpans(W,C).length?null:length(subtractSpans(W,C))});
 if(unknown.length)return {...base,reasons:[...new Set(['Недостаточно данных о работе, составе или календаре для точного итога.',...warnings])]};
 if(!D.length)return {...base,state:'not-applicable',reasons:['В периоде нет спринтов.']};
 return {...base,state:preliminary.length?'preliminary':'known',totalMs:length(negative)};
}
