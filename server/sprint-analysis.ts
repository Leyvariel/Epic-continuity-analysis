import type { SprintAnalysis,SprintInputs,SprintInterval,SprintRow,SprintSegment,SprintRecord,SprintTaskInput } from '../shared/sprints';
import type { HierarchyInput,HierarchyNodeInput } from '../shared/hierarchy';
import { canonical,isRejected } from '../shared/statuses';
import { statusClosure } from './related-timeline';
import { orderedChanges,sameStatus } from './jira/normalize';
type Span=[number,number];
const iso=(n:number)=>new Date(n).toISOString();
const ms=(v:string|null|undefined)=>v?Date.parse(v):NaN;
const overlaps=(a:Span,b:Span)=>a[0]<b[1]&&b[0]<a[1];
export function mergeSpans(spans:Span[]):Span[]{const out:Span[]=[];for(const [a,b] of spans.filter(([a,b])=>Number.isFinite(a)&&Number.isFinite(b)&&a<b).sort((x,y)=>x[0]-y[0]||x[1]-y[1])){const last=out.at(-1);if(last&&a<=last[1])last[1]=Math.max(last[1],b);else out.push([a,b]);}return out;}
const intersect=(a:Span[],b:Span[])=>mergeSpans(a.flatMap(x=>b.filter(y=>overlaps(x,y)).map(y=>[Math.max(x[0],y[0]),Math.min(x[1],y[1])] as Span)));
export function subtractSpans(a:Span[],b:Span[]):Span[]{let out=mergeSpans(a);for(const [c,d] of mergeSpans(b))out=out.flatMap(([x,y])=>d<=x||c>=y?[[x,y]]:([[x,Math.min(y,c)],[Math.max(x,d),y]] as Span[]).filter(([l,r])=>l<r));return out;}
const asIntervals=(spans:Span[]):SprintInterval[]=>mergeSpans(spans).map(([a,b])=>({start:iso(a),end:iso(b)}));
interface StatusSpan {span:Span;status:string;id?:string}
export function sprintStatusHistory(node:HierarchyNodeInput|undefined,cutoff:number):StatusSpan[]|null{
 const h=node?.history,created=ms(node?.created);
 if(!node||!h||!Number.isFinite(created)||ms(h.historyStart)!==created||node.historyCoverage!=='complete')return null;
 if('source' in h&&h.source==='jira'&&(h.statusCoverage!=='complete'||!h.initialStateProven||!h.proof?.terminal||h.proof.expected!==h.proof.received))return null;
 const changes=orderedChanges(h.statusChanges),seen=new Set<string>();let status=changes[0]?.from??h.currentStatus,id=changes[0]?.fromId??h.currentStatusId,cursor=created;
 for(const c of changes){const t=ms(c.at);if(!Number.isFinite(t)||t<cursor||seen.has(c.id)||!sameStatus(status,c.from,id,c.fromId))return null;seen.add(c.id);cursor=t;status=c.to;id=c.toId;}
 if(!sameStatus(status,h.currentStatus,id,h.currentStatusId))return null;
 const out:StatusSpan[]=[];status=changes[0]?.from??h.currentStatus;id=changes[0]?.fromId??h.currentStatusId;cursor=created;
 for(const c of changes){const t=ms(c.at);if(t>cutoff)break;if(cursor<t)out.push({span:[cursor,t],status,id});cursor=t;status=c.to;id=c.toId;}
 if(cursor<cutoff)out.push({span:[cursor,cutoff],status,id});return out;
}
export function observedSprint(s:SprintRecord,cutoff:number):{kind:'future'|'unknown'|'active'|'closed';span?:Span}{
 const start=ms(s.startDate),close=ms(s.completeDate),activated=ms(s.activatedDate);
 if(s.state==='future')return s.completeDate||s.activatedDate?{kind:'unknown'}:{kind:'future'};
 if(s.state==='unknown'||!Number.isFinite(start))return {kind:'unknown'};
 if(s.state==='closed'&&(!Number.isFinite(close)||close<=start))return {kind:'unknown'};
 if(s.state==='active'&&s.completeDate)return {kind:'unknown'};
 if(Number.isFinite(activated)&&Number.isFinite(close)&&activated>close)return {kind:'unknown'};
 if(start>=cutoff)return {kind:'future'};
 return s.state==='closed'&&close<=cutoff?{kind:'closed',span:[start,close]}:{kind:'active',span:[start,cutoff]};
}
function membership(t:SprintTaskInput|undefined,node:HierarchyNodeInput,sprintId:string,cutoff:number):Span[]|null{
 if(!t||t.membershipCoverage!=='complete'||!node.created)return null;
 const same=(a:string[],b:string[])=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
 const changes=[...t.changes].sort((a,b)=>ms(a.at)-ms(b.at)||a.id.localeCompare(b.id,'en',{numeric:true}));
 let state=changes[0]?.fromIds??t.sprintIds,cursor=ms(node.created);const seen=new Set<string>();
 for(const c of changes){if(ms(c.at)<cursor||seen.has(c.id)||!same(state,c.fromIds))return null;cursor=ms(c.at);state=c.toIds;seen.add(c.id);}
 if(!same(state,t.sprintIds))return null;
 const out:Span[]=[];state=changes[0]?.fromIds??t.sprintIds;cursor=ms(node.created);
 for(const c of changes){const end=ms(c.at);if(end>cutoff)break;if(state.includes(sprintId)&&cursor<end)out.push([cursor,end]);cursor=end;state=c.toIds;}
 if(state.includes(sprintId)&&cursor<cutoff)out.push([cursor,cutoff]);return out;
}
interface Work {yes:Span[];unknown:Span[];subtasks:Map<string,Span[]>}
function workFor(node:HierarchyNodeInput,t:SprintTaskInput|undefined,graph:HierarchyInput,cutoff:number):Work{
 const yes:Span[]=[],unknown:Span[]=[],subtasks=new Map<string,Span[]>();
 const possible=(n:HierarchyNodeInput|undefined):Span=>[Number.isFinite(ms(n?.created))?ms(n?.created):ms(node.created),cutoff];
 const read=(n:HierarchyNodeInput|undefined,uncertain=false)=>{
  const raw=!uncertain?sprintStatusHistory(n,cutoff):null,positive:Span[]=[];
  if(!raw){unknown.push(possible(n));return positive;}
  for(const {span,id} of raw){const category=id?n?.statusCategories[id]:undefined;if(category==='indeterminate'){yes.push(span);positive.push(span);}else if(category!=='new'&&category!=='done')unknown.push(span);}
  return positive;
 };
 if(!t){unknown.push(possible(node));return {yes,unknown,subtasks};}
 if(t.subtaskIds.length){for(const id of t.subtaskIds){const n=graph.nodes[id];const p=read(n,t.uncertainSubtaskIds.includes(id));if(n&&p.length)subtasks.set(n.key,p);}}
 else if(t.rosterCoverage==='complete')read(node);
 if(t.rosterCoverage!=='complete')unknown.push(possible(node));
 return {yes,unknown,subtasks};
}
const focus=(status:string)=>['проверка идей','валидация','реализация','оценка результата'].includes(canonical(status).replace(/^\[hf\]\s*/,''));
export function analyzeSprints(graph:HierarchyInput,input:SprintInputs):SprintAnalysis{
 const cutoff=ms(input.asOf),rows:Record<string,SprintRow>={},adj=new Map<string,string[]>();
 for(const e of graph.edges){const list=adj.get(e.parent)??[];list.push(e.child);adj.set(e.parent,list);}
 const rootIds=new Set(Object.values(graph.roots));
 const applicable=(n:HierarchyNodeInput)=>!n.created||ms(n.created)<=cutoff;
 const reachable=new Set<string>(),todo=[...rootIds];
 while(todo.length){const id=todo.pop()!;if(reachable.has(id))continue;reachable.add(id);if(graph.nodes[id]?.type==='epic')todo.push(...adj.get(id)??[]);}
 const work=new Map<string,Work>();
 for(const id of reachable){const n=graph.nodes[id];if(n?.type==='task'&&applicable(n)&&n.resolution!==null&&!isRejected(n.resolution))work.set(id,workFor(n,input.tasks[id],graph,cutoff));}
 const earliest=Math.min(cutoff,...[...reachable].flatMap(id=>{const n=graph.nodes[id];return n&&applicable(n)&&n.type!=='subtask'&&Number.isFinite(ms(n.created))?[ms(n.created)]:[];}));
 for(const rowId of [...reachable].sort((a,b)=>a.localeCompare(b,'en',{numeric:true}))){
  const rowNode=graph.nodes[rowId];if(!rowNode||!applicable(rowNode)||!['task','epic'].includes(rowNode.type)||rowNode.resolution===null||isRejected(rowNode.resolution))continue;
  const descendants=new Set<string>(),seen=new Set<string>(),queue=[rowId];let structural=false;
  while(queue.length){const id=queue.pop()!;if(seen.has(id))continue;seen.add(id);const n=graph.nodes[id];
   if(!n){structural=true;continue;}if(!applicable(n)||n.type==='subtask')continue;
   if(n.type==='unknown'||n.resolution===null){structural=true;continue;}
   if(n.type==='epic'){if(n.branchCoverage!=='complete')structural=true;queue.push(...adj.get(id)??[]);}else if(!isRejected(n.resolution))descendants.add(id);
  }
  const warnings=new Set<string>(),candidateIds=new Set<string>();let unbounded=structural||!descendants.size;
  if(!descendants.size)warnings.add('Ритм спринтов не определён: нет доступных обычных задач.');
  if(structural)warnings.add(`Состав ветки ${rowNode.key} не подтверждён; отсутствие работы неизвестно.`);
  for(const id of descendants){const t=input.tasks[id];if(!t){unbounded=true;warnings.add('Спринты задачи не получены.');continue;}
   for(const w of t.warnings)warnings.add(`${graph.nodes[id].key}: ${w}`);
   if(work.get(id)?.unknown.length)warnings.add(`${graph.nodes[id].key}: не подтверждены рабочие статусы, категории или текущие связи подзадач.`);
   for(const sid of [...t.sprintIds,...t.changes.flatMap(c=>[...c.fromIds,...c.toIds])])candidateIds.add(sid);
   if(t.calendarCoverage!=='complete'||!t.calendarIds.length){unbounded=true;warnings.add('Ритм или полнота календаря не подтверждены.');}
   for(const bid of t.calendarIds){const cal=input.calendars[bid];if(!cal||cal.coverage!=='complete'){unbounded=true;warnings.add('Календарь спринтов неполон.');}for(const sid of cal?.sprintIds??[])candidateIds.add(sid);}
  }
  const usable:{s:SprintRecord;span:Span;kind:'active'|'closed'}[]=[];
  for(const sid of candidateIds){const s=input.sprints[sid];if(!s){unbounded=true;warnings.add('Данные исторического спринта недоступны.');continue;}
   const observed=observedSprint(s,cutoff);if(observed.kind==='future')continue;
   if(!observed.span){unbounded=true;warnings.add(`Не подтверждены даты или состояние спринта ${s.name}.`);continue;}
   if(observed.span[1]<=earliest)continue;usable.push({s,span:observed.span,kind:observed.kind as 'active'|'closed'});
  }
  // Work coverage remains the per-sprint result. Epic gaps use membership only.
  const assigned:Span[]=[],assignmentUnknown:Span[]=[];
  const memberSprintIds=new Set<string>(),unknownMemberSprintIds=new Set<string>();
  const P:Span[]=[],U:Span[]=[],A:Span[]=[],C:Span[]=[],segments:SprintSegment[]=[];
  for(const {s,span,kind} of usable){const tasks=new Set<string>(),subtasks=new Set<string>();let possible=unbounded,hasMember=false,uncertainMembership=unbounded;
   for(const id of descendants){const n=graph.nodes[id],t=input.tasks[id],w=work.get(id)!;const member=membership(t,n,s.id,cutoff);
    if(member===null){if(!n.created||ms(n.created)<span[1])uncertainMembership=true;if([...w.yes,...w.unknown].some(p=>overlaps(p,span)))possible=true;continue;}
    const participating=intersect(member,[span]);if(!participating.length)continue;hasMember=true;
    if(intersect(w.yes,participating).length){tasks.add(n.key);for(const [key,spans] of w.subtasks)if(intersect(spans,participating).length)subtasks.add(key);}
    if(intersect(w.unknown,participating).length)possible=true;
   }
   if(hasMember){assigned.push(span);memberSprintIds.add(s.id);}else if(uncertainMembership){assignmentUnknown.push(span);unknownMemberSprintIds.add(s.id);}
   const state=tasks.size?'work':possible?'unknown':kind==='active'?'active-empty':'empty';
   if(state==='work')P.push(span);else if(state==='unknown')U.push(span);
   (kind==='active'?A:C).push(span);
   segments.push({sprintId:s.id,lifecycle:kind,name:s.name,boardId:s.originBoardId,plannedEnd:s.endDate,start:iso(span[0]),end:iso(span[1]),state,taskKeys:[...tasks].sort(),subtaskKeys:[...subtasks].sort(),warnings:state==='unknown'?['Недостаточно данных о работе, составе или календаре.']:[],coveredBy:[]});
  }
  for(const segment of segments)if(segment.state==='empty'||segment.state==='active-empty')segment.coveredBy=[...new Set(segments.filter(s=>s.state==='work'&&overlaps([ms(s.start),ms(s.end)],[ms(segment.start),ms(segment.end)])).map(s=>`${s.name} (Sprint ${s.sprintId})`))];
  segments.sort((a,b)=>ms(a.start)-ms(b.start)||ms(a.end)-ms(b.end)||a.sprintId.localeCompare(b.sprintId,'en',{numeric:true}));
  const history=sprintStatusHistory(rowNode,cutoff),mask=history?history.filter(s=>focus(s.status)).map(s=>s.span):[];
  if(rowNode.type==='epic'&&!history)warnings.add('История этапов неизвестна; известные спринты сохранены без точных брешей.');
  const visibleHistory=history?[...history]:[];
  while(visibleHistory.length&&rowNode.statusCategories[visibleHistory.at(-1)!.id??'']==='done')visibleHistory.pop();
  const phases=visibleHistory.map(s=>({status:s.status,start:iso(s.span[0]),end:iso(s.span[1])}));
  if(unbounded){U.push(...mask);assignmentUnknown.push(...mask);}
  const isRoot=rootIds.has(rowId);
  // Only display changes: never feed the task filter into epic rollups.
  const possiblyOpen=history?mergeSpans(history.filter(h=>statusClosure(rowNode,h.status,h.id).closed!==true).map(h=>h.span)):null;
  const hiddenSprintIds=rowNode.type==='task'?segments.filter(s=>{
   if(memberSprintIds.has(s.sprintId))return false;
   const start=ms(s.start),end=ms(s.end);
   if(Number.isFinite(ms(rowNode.created))&&end<=ms(rowNode.created))return true;
   if(unknownMemberSprintIds.has(s.sprintId)||!possiblyOpen)return false;
   return !possiblyOpen.some(([a,b])=>a<=start&&end<=b);
  }).map(s=>s.sprintId):undefined;
  rows[rowId]={issueId:rowId,...(hiddenSprintIds?{hiddenSprintIds}:{}),segments,warnings:[...warnings],phases:isRoot?phases:[],gaps:isRoot?asIntervals(subtractSpans(intersect(mask,C),[...assigned,...assignmentUnknown,...A])):[],preliminary:isRoot?asIntervals(subtractSpans(intersect(mask,A),[...P,...U])):[],unknown:isRoot?asIntervals(subtractSpans(intersect(mask,U),P)):[]};
 }
 return {...(input.diagnostics?{diagnostics:input.diagnostics}:{}),asOf:input.asOf,mode:input.mode,rows,warnings:input.warnings};
}
