import { describe,it,expect } from 'vitest';
import { collectSprintInputs,type SprintClient } from '../server/jira/sprints';
import { fixture,node,at } from './sprint-fixtures';
import type { JiraGateway } from '../server/jira/ports';
import type { HistorySnapshot } from '../shared/contracts';
import { AppError } from '../server/errors';
import { analyzeSprints } from '../server/sprint-analysis';
export function setup(options:{child?:boolean;childFailure?:string;conflict?:boolean;childOwnSprintMissing?:boolean;parentMismatch?:boolean}={}){
 const {graph,input}=fixture();delete graph.nodes['4'];delete graph.nodes['5'];graph.edges=graph.edges.slice(0,2);
 const child=node('6','subtask',[[2,3]]);let active=0,maxActive=0;
 const calls:string[]=[];
 const client:SprintClient={async get(path,p){calls.push(`${path}?${p.expand??''}`);active++;maxActive=Math.max(maxActive,active);await Promise.resolve();active--;
  if(path.endsWith('/field'))return [{id:'customfield_10005',schema:{custom:'com.pyxis.greenhopper.jira:gh-sprint'}}];
  if(path.endsWith('/search'))return {startAt:0,total:options.child?1:0,issues:options.child?[{id:'6',key:'A-6'}]:[]};
  if(path.includes('/board/'))return {startAt:0,isLast:true,values:Object.values(input.sprints).map(s=>({...s,activatedDate:undefined,...(options.conflict&&s.id==='11'?{startDate:at(2)}:{})}))};
  if(path.includes('/sprint/'))return input.sprints[path.split('/').at(-1)!];
  const id=path.split('/').at(-1)!;
  if(id==='6'&&options.childFailure)throw new AppError(options.childFailure,'Чтение подзадачи недоступно');
  const n=id==='6'?child:graph.nodes[id];
  if(p.expand==='versionedRepresentations'){
   if(id==='6'&&options.childOwnSprintMissing)throw new AppError('JIRA_FORBIDDEN','Поле Sprint подзадачи недоступно');
   return {id,versionedRepresentations:{customfield_10005:{'2':['11','12','13'].map(id=>({id}))}}};
  }
  return {id,key:n.key,fields:{created:n.created,updated:n.history!.updated,status:{id:n.currentStatusId,name:n.currentStatus},issuetype:{subtask:id==='6'},subtasks:id==='3'&&options.child?[{id:'6',key:'A-6'}]:[],...(id==='6'?{parent:{id:options.parentMismatch?'99':'3',key:options.parentMismatch?'A-99':'A-3'}}:{})},changelog:{startAt:0,total:0,histories:[]}};
 }};
 const gateway:JiraGateway={getStatusCategories:async()=>({'1':'new','3':'indeterminate','6':'done'}),getIssue:async()=>({id:'6',key:'A-6',title:'child',flow:'unknown',isEpic:false,isSubtask:true,resolution:'',created:child.created!,updated:child.history!.updated,currentStatus:child.currentStatus,currentStatusId:child.currentStatusId,assignee:'',issueType:'Sub-task'}),getHistory:async()=>child.history as HistorySnapshot,readBoard:async()=>{throw Error('unused');}};
 return {graph,input,client,gateway,calls,maxActive:()=>maxActive};
}
