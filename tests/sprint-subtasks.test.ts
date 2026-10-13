import { describe,it,expect } from 'vitest';
import { collectSprintInputs,type SprintClient } from '../server/jira/sprints';
import { fixture,node,at } from './sprint-fixtures';
import type { JiraGateway } from '../server/jira/ports';
import type { HistorySnapshot } from '../shared/contracts';
import { AppError } from '../server/errors';
import { analyzeSprints } from '../server/sprint-analysis';
import {setup} from './sprint-collector-fixture';
describe('T003: текущий native roster и независимость основного графа',()=>{
 it('читает историю native child без требования его Sprint, сохраняет основной граф',async()=>{
  const s=setup({child:true,childOwnSprintMissing:true}),before=structuredClone(s.graph);
  const data=await collectSprintInputs(s.client,s.gateway,s.graph,at(30),new AbortController().signal);
  expect(data.tasks['3'].rosterCoverage).toBe('complete');expect(data.tasks['3'].subtaskIds).toEqual(['6']);
  expect(analyzeSprints(s.graph,data).rows['1'].segments.find(s=>s.sprintId==='11')?.state).toBe('work');
  expect(s.graph.edges).toEqual(before.edges);expect(s.graph.coverage).toBe(before.coverage);
  for(const [id,n] of Object.entries(before.nodes))expect(s.graph.nodes[id]).toEqual(n);
  expect(s.calls.some(c=>c.includes('/6?versioned'))).toBe(false);expect(s.maxActive()).toBeLessThanOrEqual(4);
 });
 it('отсутствие activatedDate в списке не делает стабильные даты неизвестными',async()=>{
  const s=setup(),data=await collectSprintInputs(s.client,s.gateway,s.graph,at(30),new AbortController().signal);
  expect(data.calendars['100'].coverage).toBe('complete');expect(data.sprints['11'].activatedDate).toBe(at(1));
 });
 it('противоречащие даты не сохраняют прежнее положительное покрытие',async()=>{
  const s=setup({conflict:true}),data=await collectSprintInputs(s.client,s.gateway,s.graph,at(30),new AbortController().signal);
  expect(data.sprints['11'].state).toBe('unknown');expect(analyzeSprints(s.graph,data).rows['1'].segments.some(s=>s.sprintId==='11'&&s.state==='work')).toBe(false);
 });
 it.each(['JIRA_FORBIDDEN','JIRA_NOT_FOUND','JIRA_HTTP'])('локальный %s делает roster частичным без parent fallback',async childFailure=>{
  const s=setup({child:true,childFailure}),data=await collectSprintInputs(s.client,s.gateway,s.graph,at(30),new AbortController().signal);
  expect(data.tasks['3'].rosterCoverage).toBe('partial');expect(data.tasks['3'].subtaskIds).toEqual([]);
  expect(analyzeSprints(s.graph,data).rows['1'].segments.some(s=>s.state==='work')).toBe(false);
 });
 it.each(['JIRA_UNAUTHORIZED','JIRA_NETWORK','RATE_LIMITED','IDENTITY_CHANGED'])('глобальный %s останавливает сбор',async childFailure=>{
  const s=setup({child:true,childFailure});await expect(collectSprintInputs(s.client,s.gateway,s.graph,at(30),new AbortController().signal)).rejects.toMatchObject({code:childFailure});
 });
 it('несовпадающий parent не доказывает работу',async()=>{
  const s=setup({child:true,parentMismatch:true}),data=await collectSprintInputs(s.client,s.gateway,s.graph,at(30),new AbortController().signal);
  expect(data.tasks['3'].uncertainSubtaskIds).toEqual(['6']);expect(analyzeSprints(s.graph,data).rows['1'].segments.some(s=>s.state==='work')).toBe(false);
 });
});
it('B21: 8000 primary + 3000 requested, deterministic 2000 admission; full primary budget adds none',async()=>{
 const run=async(primary:number,reverse=false)=>{
  const s=setup({child:true}),template=node('9000','subtask',[[2,3]]);
  for(let k=Object.keys(s.graph.nodes).length;k<primary;k++)s.graph.nodes[String(100000+k)]={...template,id:String(100000+k),key:`A-${100000+k}`};
  const before=structuredClone(s.graph),refs=Array.from({length:3000},(_,i)=>({id:String(9000+i),key:`A-${9000+i}`}));if(reverse)refs.reverse();
  const orig=s.client.get.bind(s.client);s.client.get=async(p,q,signal)=>{
   if(p.endsWith('/search')){const start=Number(q.startAt);return {startAt:start,total:refs.length,issues:refs.slice(start,start+100)};}
   if(p.includes('/issue/')){const id=p.split('/').at(-1)!;const base=await orig(Number(id)>=9000?'/rest/api/2/issue/6':p,q,signal) as any;
    if(q.expand==='versionedRepresentations')return {...base,id};
    return {...base,id,key:`A-${id}`,fields:{...base.fields,subtasks:id==='3'?refs:[],...(Number(id)>=9000?{parent:{id:'3',key:'A-3'}}:{})}};
   }return orig(p,q,signal);
  };
  const issue=s.gateway.getIssue; s.gateway.getIssue=async id=>({...await issue('6',new AbortController().signal),id,key:`A-${id}`});s.gateway.getHistory=async issue=>({...template.history!,key:issue.key}) as HistorySnapshot;
  const data=await collectSprintInputs(s.client,s.gateway,s.graph,at(30),new AbortController().signal);
  expect(s.graph.edges).toEqual(before.edges);expect(s.graph.coverage).toBe(before.coverage);for(const id of Object.keys(before.nodes))expect(s.graph.nodes[id]).toEqual(before.nodes[id]);
  expect(Object.keys(s.graph.nodes)).toHaveLength(10000);expect(data.tasks['3'].rosterCoverage).toBe('partial');return data.tasks['3'].subtaskIds;
 };
 const selected=await run(8000);expect(selected).toHaveLength(2000);expect(selected[0]).toBe('9000');expect(selected.at(-1)).toBe('10999');expect(await run(8000,true)).toEqual(selected);expect(await run(10000)).toEqual([]);
},20000);
it('B19: explicitly observed parent move after cutoff invalidates child work on earlier sprint',async()=>{
 const s=setup({child:true}),get=s.client.get.bind(s.client);
 s.client.get=async(p,q,signal)=>{const raw=await get(p,q,signal) as any;if(p.endsWith('/6')&&q.expand==='changelog')raw.changelog={startAt:0,total:1,histories:[{id:'move',created:at(20),items:[{field:'Parent',fieldId:'parent',from:'99',to:'3'}]}]};return raw;};
 s.graph.asOf=at(10);const data=await collectSprintInputs(s.client,s.gateway,s.graph,at(10),new AbortController().signal);expect(data.tasks['3'].uncertainSubtaskIds).toEqual(['6']);expect(analyzeSprints(s.graph,data).rows['3'].segments[0].state).toBe('unknown');
});
