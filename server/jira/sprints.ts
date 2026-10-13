import { z } from 'zod';
import type { SprintRecord,SprintInputs,SprintTaskInput } from '../../shared/sprints';
import { SPRINT_LIMITS } from '../../shared/sprints';
import { HIERARCHY_LIMITS,type HierarchyInput,type HierarchyNodeInput } from '../../shared/hierarchy';
import type { JiraGateway,JiraIssue } from './ports';
import { AppError } from '../errors';
import { collectPages } from './pagination';
import { mapConcurrent } from './concurrency';
import { eligibleHierarchyIds } from '../../shared/hierarchy-view';
export interface SprintClient { get(path:string,params:Record<string,string>,signal:AbortSignal):Promise<unknown> }
const id=z.union([z.string().regex(/^\d+$/),z.number().int().positive()]).transform(String);
const stamp=z.string().refine(v=>/T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(v)&&Number.isFinite(Date.parse(v)));
const ref=z.object({id,key:z.string().regex(/^[A-Z][A-Z0-9_]*-\d+$/)});
export const sprintFatal=(e:unknown)=>e instanceof AppError&&['JIRA_UNAUTHORIZED','JIRA_NETWORK','RATE_LIMITED','ABORTED','IDENTITY_CHANGED','PROFILE_UNVERIFIED','JIRA_VERSION_CHANGED'].includes(e.code);
const fail=(message:string):never=>{throw new AppError('SPRINT_DATA_UNKNOWN',message);};
export function sprintIdSet(value:unknown):string[]{
 if(value===null||value==='')return [];
 if(typeof value!=='string'||!/^\d+(?:,\s*\d+)*$/.test(value))return fail('Неизвестный формат истории Sprint.');
 const ids=value.split(',').map(v=>v.trim());if(new Set(ids).size!==ids.length)return fail('Повтор ID в истории Sprint.');return ids.sort((a,b)=>a.localeCompare(b,'en',{numeric:true}));
}
const sprintRaw=z.object({id,name:z.string(),state:z.string(),startDate:stamp.nullish(),endDate:stamp.nullish(),completeDate:stamp.nullish(),activatedDate:stamp.nullish(),originBoardId:id.nullish()});
export function parseSprint(value:unknown):SprintRecord{
 const raw=sprintRaw.parse(value);return {...raw,state:['future','active','closed'].includes(raw.state)?raw.state as SprintRecord['state']:'unknown',startDate:raw.startDate??null,endDate:raw.endDate??null,completeDate:raw.completeDate??null,activatedDate:raw.activatedDate??null,originBoardId:raw.originBoardId??null};
}
export async function readSprintCalendar(client:SprintClient,boardId:string,signal:AbortSignal):Promise<SprintRecord[]>{
 const values:SprintRecord[]=[],seen=new Set<string>();
 for(let page=0;page<SPRINT_LIMITS.pages;page++){
  signal.throwIfAborted();const raw=z.object({startAt:z.number().int().nonnegative(),isLast:z.boolean(),values:z.array(z.unknown())}).parse(await client.get(`/rest/agile/1.0/board/${id.parse(boardId)}/sprint`,{startAt:String(values.length),maxResults:'100'},signal));
  if(raw.startAt!==values.length||(!raw.isLast&&!raw.values.length))return fail('Календарь спринтов не завершён.');
  for(const value of raw.values){const s=parseSprint(value);if(seen.has(s.id))return fail('Повтор спринта в календаре.');if(values.length>=SPRINT_LIMITS.sprints)return fail('Достигнут предел спринтов.');seen.add(s.id);values.push(s);}
  if(raw.isLast)return values;
 }
 return fail('Достигнут предел страниц календаря.');
}
const item=z.object({field:z.string(),fieldId:z.string().optional(),from:z.string().nullable().optional(),to:z.string().nullable().optional()});
const issueRaw=z.object({id,key:z.string(),fields:z.object({created:stamp,updated:stamp,status:z.object({id,name:z.string()}),issuetype:z.object({subtask:z.boolean()}).passthrough(),parent:ref.nullish(),subtasks:z.array(ref).optional()}).passthrough(),changelog:z.object({startAt:z.number(),total:z.number(),histories:z.array(z.object({id:z.string(),created:stamp,items:z.array(item)}))})});
interface Snapshot { id:string; key:string; created:string; updated:string; statusId:string; isSubtask:boolean; parentId:string|null; rosterKnown:boolean; refs:z.infer<typeof ref>[]; sprintIds:string[]; changes:SprintTaskInput['changes']; membershipComplete:boolean; moved:boolean }
class Reader {
 constructor(private client:SprintClient,private field:string){}
 async snapshot(issueId:string,signal:AbortSignal,includeSprint=true):Promise<Snapshot>{
  const raw=issueRaw.parse(await this.client.get(`/rest/api/2/issue/${id.parse(issueId)}`,{fields:`created,updated,status,issuetype,parent,subtasks,${this.field}`,expand:'changelog'},signal));
  if(raw.id!==issueId)throw new AppError('IDENTITY_CHANGED','Изменилась идентичность задачи спринтов.');
  let membershipComplete=raw.changelog.startAt===0&&raw.changelog.total===raw.changelog.histories.length&&new Set(raw.changelog.histories.map(h=>h.id)).size===raw.changelog.total;
  let sprintIds:string[]=[];
  if(includeSprint){
   const versioned=z.object({id,versionedRepresentations:z.record(z.string(),z.unknown())}).parse(await this.client.get(`/rest/api/2/issue/${issueId}`,{fields:this.field,expand:'versionedRepresentations'},signal));
   if(versioned.id!==issueId)throw new AppError('IDENTITY_CHANGED','Изменилась идентичность Sprint.');
   try{const v=z.object({'2':z.array(z.object({id}))}).parse(versioned.versionedRepresentations[this.field]);sprintIds=v['2'].map(s=>s.id).sort();if(new Set(sprintIds).size!==sprintIds.length)membershipComplete=false;}catch{membershipComplete=false;}
  }
  const changes:SprintTaskInput['changes']=[];let moved=false;
  for(const h of [...raw.changelog.histories].sort((a,b)=>Date.parse(a.created)-Date.parse(b.created)||a.id.localeCompare(b.id,'en',{numeric:true})))for(const [index,c] of h.items.entries()){
   if(['parent','issueparentassociation'].includes(c.field.toLowerCase())||c.fieldId==='parent')moved=true;
   if(includeSprint&&(c.field==='Sprint'||c.fieldId===this.field)){try{changes.push({id:`${h.id}:${index}`,at:h.created,fromIds:sprintIdSet(c.from),toIds:sprintIdSet(c.to)});}catch{membershipComplete=false;}}
  }
  return {id:raw.id,key:raw.key,created:raw.fields.created,updated:raw.fields.updated,statusId:raw.fields.status.id,isSubtask:raw.fields.issuetype.subtask,parentId:raw.fields.parent?.id??null,rosterKnown:Array.isArray(raw.fields.subtasks),refs:raw.fields.subtasks??[],sprintIds,changes,membershipComplete,moved};
 }
 async children(key:string,signal:AbortSignal){
  if(!/^[A-Z][A-Z0-9_]*-\d+$/.test(key))return fail('Некорректный ключ родителя.');
  return collectPages(async startAt=>{const p=z.object({startAt:z.number(),total:z.number(),issues:z.array(ref)}).parse(await this.client.get('/rest/api/2/search',{jql:`parent = ${key} ORDER BY key ASC`,fields:'key',startAt:String(startAt),maxResults:'100'},signal));return {startAt:p.startAt,total:p.total,values:p.issues};},{maxItems:HIERARCHY_LIMITS.nodes,maxPages:SPRINT_LIMITS.pages});
 }
}
const sig=(s:Snapshot)=>JSON.stringify({...s,refs:[...s.refs].sort((a,b)=>a.id.localeCompare(b.id))});
const sameIds=(a:{id:string}[],b:{id:string}[])=>JSON.stringify(a.map(x=>x.id).sort())===JSON.stringify(b.map(x=>x.id).sort());
const unknownTask=(issueId:string,asOf:string):SprintTaskInput=>({issueId,observedAt:asOf,sprintIds:[],changes:[],membershipCoverage:'unavailable',rosterCoverage:'unavailable',subtaskIds:[],uncertainSubtaskIds:[],calendarIds:[],calendarCoverage:'unavailable',warnings:[]});
const message=(error:unknown)=>error instanceof AppError?error.message:'Не удалось проверить формат данных спринтов.';
export async function collectSprintInputs(client:SprintClient,gateway:JiraGateway,graph:HierarchyInput,asOf:string,signal:AbortSignal):Promise<SprintInputs>{
 const stats={primaryNodes:Object.keys(graph.nodes).length,addedSubtasks:0,unreadSubtasks:0,limits:[] as string[]};
 const out:SprintInputs={diagnostics:stats,version:1,asOf,mode:'current-subtasks',tasks:{},sprints:{},calendars:{},warnings:[]};
 let field:string;
 try{const fields=z.array(z.object({id:z.string(),schema:z.object({custom:z.string().optional()}).passthrough().optional()})).parse(await client.get('/rest/api/2/field',{},signal));const matching=fields.filter(f=>f.schema?.custom==='com.pyxis.greenhopper.jira:gh-sprint');if(matching.length!==1||!/^customfield_\d+$/.test(matching[0].id))return fail('Поле Sprint не подтверждено.');field=matching[0].id;}catch(e){if(sprintFatal(e))throw e;signal.throwIfAborted();out.warnings.push(message(e));return out;}
 const reader=new Reader(client,field),ids=[...eligibleHierarchyIds(graph)].filter(i=>graph.nodes[i].type==='task'&&graph.nodes[i].created&&Date.parse(graph.nodes[i].created!)<=Date.parse(asOf)).sort((a,b)=>a.localeCompare(b,'en',{numeric:true}));
 const rosters=new Map<string,{id:string;key:string}[]>();
 await mapConcurrent(ids,4,signal,async(issueId,sigAbort)=>{
  const t=out.tasks[issueId]=unknownTask(issueId,asOf),n=graph.nodes[issueId];
  try{
   let chosen:Snapshot|undefined,children:{id:string;key:string}[]=[],stable=false,complete=false;
   for(let attempt=0;attempt<2;attempt++){
    const before=await reader.snapshot(issueId,sigAbort);
    let a:{id:string;key:string}[]=[],b:{id:string;key:string}[]=[],searchComplete=true;
    try{a=await reader.children(before.key,sigAbort);b=await reader.children(before.key,sigAbort);}catch(e){if(sprintFatal(e))throw e;sigAbort.throwIfAborted();searchComplete=false;t.warnings.push(message(e));}
    const after=await reader.snapshot(issueId,sigAbort);chosen=after;
    stable=sig(before)===sig(after)&&(!searchComplete||sameIds(a,b));
    children=[...new Map([...after.refs,...a,...b].map(x=>[x.id,x])).values()];
    complete=stable&&searchComplete&&after.rosterKnown&&sameIds(after.refs,b);
    if(stable)break;
   }
   if(!chosen)return;t.sprintIds=chosen.sprintIds;t.changes=chosen.changes;
   const h=n.history;
   const matchesMain=(!h||Date.parse(h.updated)===Date.parse(chosen.updated))&&n.currentStatusId===chosen.statusId&&Date.parse(n.created!)===Date.parse(chosen.created)&&!chosen.isSubtask;
   t.observedAt=new Date(Math.max(Date.parse(asOf),Date.now())).toISOString();
   t.membershipCoverage=stable&&matchesMain&&chosen.membershipComplete?'complete':'partial';t.rosterCoverage=complete&&matchesMain?'complete':'partial';
   if(!stable||!matchesMain)t.warnings.push('Задача менялась между основным графом и чтением спринтов; анализ неполон.');
   if(t.rosterCoverage!=='complete')t.warnings.push('Текущий состав подзадач не подтверждён полностью.');
   rosters.set(issueId,children);
  }catch(e){if(sprintFatal(e))throw e;sigAbort.throwIfAborted();t.warnings.push(message(e));}
 });
 // Deterministic admission is decided before concurrent child requests; primary nodes cannot be displaced.
 const wanted=[...new Set([...rosters.values()].flatMap(v=>v.map(s=>s.id)))].sort((a,b)=>a.localeCompare(b,'en',{numeric:true}));
 let remaining=Math.max(0,HIERARCHY_LIMITS.nodes-Object.keys(graph.nodes).length);
 const admitted=wanted.filter(i=>graph.nodes[i]?.type==='subtask'||!graph.nodes[i]&&remaining-->0);
 let categories:Record<string,string>={};try{categories=await gateway.getStatusCategories?.(signal)??{};}catch(e){if(sprintFatal(e))throw e;signal.throwIfAborted();out.warnings.push('Категории статусов подзадач недоступны.');}
 const childInfo=new Map<string,{parentId:string|null;moved:boolean;stable:boolean}>();
 await mapConcurrent(admitted,4,signal,async(childId,sigAbort)=>{
  try{
   let issue:JiraIssue|undefined,h:Awaited<ReturnType<JiraGateway['getHistory']>>|undefined,snapshot:Snapshot|undefined,stable=false;
   for(let attempt=0;attempt<2;attempt++){
    const before=await reader.snapshot(childId,sigAbort,false);issue=await gateway.getIssue(childId,sigAbort);
    if(issue.id!==childId||!issue.isSubtask)throw new AppError('IDENTITY_CHANGED','Тип или идентичность подзадачи изменились.');
    try{h=await gateway.getHistory(issue,sigAbort);}catch(e){if(sprintFatal(e))throw e;sigAbort.throwIfAborted();h=undefined;}
    snapshot=await reader.snapshot(childId,sigAbort,false);stable=sig(before)===sig(snapshot)&&issue.updated===snapshot.updated&&(!h||h.updated===snapshot.updated);if(stable)break;
   }
   if(!issue||!snapshot)return;
   const n:HierarchyNodeInput={id:issue.id,key:issue.key,title:issue.title,type:'subtask',resolution:issue.resolution,created:issue.created,currentStatus:issue.currentStatus,...(issue.currentStatusId?{currentStatusId:issue.currentStatusId}:{}),statusCategories:{...categories,...(issue.currentStatusId&&issue.statusCategory?{[issue.currentStatusId]:issue.statusCategory}:{})},history:h,historyCoverage:stable?h?.statusCoverage??'unavailable':'partial',branchCoverage:'complete',warnings:[]};
   const existing=graph.nodes[childId];
   if(existing&&(existing.created!==n.created||existing.currentStatusId!==n.currentStatusId||existing.history&&existing.history.updated!==n.history?.updated))stable=false;
   graph.nodes[childId]=existing?{...existing,history:h,historyCoverage:stable?n.historyCoverage:'partial',statusCategories:{...n.statusCategories,...existing.statusCategories}}:n;childInfo.set(childId,{parentId:snapshot.parentId,moved:snapshot.moved,stable});
  }catch(e){if(sprintFatal(e))throw e;sigAbort.throwIfAborted();out.warnings.push(`Подзадача ${childId}: ${message(e)}`);}
 });
 let relations=0;
 for(const issueId of ids){const t=out.tasks[issueId];for(const child of (rosters.get(issueId)??[]).sort((a,b)=>a.id.localeCompare(b.id,'en',{numeric:true}))){
   const info=childInfo.get(child.id);if(!info||relations>=SPRINT_LIMITS.relations){t.rosterCoverage='partial';t.warnings.push('Часть подзадач недоступна или достигнут предел аналитики.');continue;}
   relations++;t.subtaskIds.push(child.id);if(!info.stable||info.moved||info.parentId!==issueId){t.uncertainSubtaskIds.push(child.id);t.warnings.push('Обнаружен перенос или противоречивый parent подзадачи.');}
  }}
 stats.addedSubtasks=Object.keys(graph.nodes).length-stats.primaryNodes;stats.unreadSubtasks=wanted.length-childInfo.size;
 if(admitted.length<wanted.length)stats.limits.push('Узлы подзадач: основной граф использовал общий бюджет 10 000');
 if(relations>=SPRINT_LIMITS.relations)stats.limits.push('Отношения подзадач: 50 000');
 const sprintIds=[...new Set(Object.values(out.tasks).flatMap(t=>[...t.sprintIds,...t.changes.flatMap(c=>[...c.fromIds,...c.toIds])]))].sort((a,b)=>a.localeCompare(b,'en',{numeric:true}));
 if(sprintIds.length>SPRINT_LIMITS.sprints)stats.limits.push('Спринты: 10 000');
 const direct=await mapConcurrent(sprintIds.slice(0,SPRINT_LIMITS.sprints),4,signal,async(sid,sigAbort)=>{try{let result:SprintRecord|undefined;
   for(let attempt=0;attempt<2;attempt++){
    const before=parseSprint(await client.get(`/rest/agile/1.0/sprint/${sid}`,{},sigAbort));
    const after=parseSprint(await client.get(`/rest/agile/1.0/sprint/${sid}`,{},sigAbort));
    if(before.id!==sid||after.id!==sid)throw new AppError('IDENTITY_CHANGED','Изменилась идентичность спринта.');
    result=after;if(JSON.stringify(before)===JSON.stringify(after))return after;
   }
   return result?{...result,state:'unknown' as const}:undefined;}catch(e){if(sprintFatal(e))throw e;sigAbort.throwIfAborted();return undefined;}});
 for(const s of direct)if(s)out.sprints[s.id]=s;
 const boardIds=[...new Set(direct.flatMap(s=>s?.originBoardId?[s.originBoardId]:[]))].sort((a,b)=>a.localeCompare(b,'en',{numeric:true}));
 if(boardIds.length>SPRINT_LIMITS.boards)stats.limits.push('Календари: 100');
 // Calendars are merged in fixed board order to enforce a global unique sprint budget deterministically.
 for(const bid of boardIds.slice(0,SPRINT_LIMITS.boards)){
  const cal=out.calendars[bid]={boardId:bid,sprintIds:[] as string[],coverage:'complete' as 'complete'|'partial',warnings:[] as string[]};
  try{
   let values:SprintRecord[]=[],stable=false;
   for(let attempt=0;attempt<2;attempt++){const before=await readSprintCalendar(client,bid,signal);values=await readSprintCalendar(client,bid,signal);stable=JSON.stringify([...before].sort((a,b)=>a.id.localeCompare(b.id)))===JSON.stringify([...values].sort((a,b)=>a.id.localeCompare(b.id)));if(stable)break;}
   if(!stable){cal.coverage='partial';cal.warnings.push('Календарь менялся во время чтения.');}
   for(const s of values){
    if(!out.sprints[s.id]&&Object.keys(out.sprints).length>=SPRINT_LIMITS.sprints){cal.coverage='partial';continue;}
    const previous=out.sprints[s.id];
    const conflict=previous&&(['state','startDate','endDate','completeDate','originBoardId'] as const).some(k=>previous[k]!==s[k])||previous?.activatedDate&&s.activatedDate&&previous.activatedDate!==s.activatedDate;
    if(conflict||!stable){cal.coverage='partial';cal.warnings.push('Даты или состояние спринта менялись.');out.sprints[s.id]={...s,state:'unknown'};}
    else out.sprints[s.id]={...s,activatedDate:s.activatedDate??previous?.activatedDate??null};
    cal.sprintIds.push(s.id);
   }
  }catch(e){if(sprintFatal(e))throw e;signal.throwIfAborted();cal.coverage='partial';cal.warnings.push(message(e));}
 }
 for(const t of Object.values(out.tasks)){
  const all=[...new Set([...t.sprintIds,...t.changes.flatMap(c=>[...c.fromIds,...c.toIds])])];
  const bids=[...new Set(all.flatMap(i=>out.sprints[i]?.originBoardId?[out.sprints[i].originBoardId!]:[]))];
  t.calendarIds=bids.filter(b=>!!out.calendars[b]);
  for(const bid of t.calendarIds)for(const warning of out.calendars[bid].warnings)t.warnings.push(`Календарь ${bid}: ${warning}`);
  t.calendarCoverage=all.length&&t.calendarIds.length===bids.length&&all.every(i=>!!out.sprints[i]?.originBoardId)&&bids.every(b=>out.calendars[b]?.coverage==='complete')?'complete':'partial';
 }
 out.warnings.push(...stats.limits);
 return out;
}
