import {it,expect,vi,afterEach} from 'vitest';
import {mkdtemp,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {DatasetService} from '../server/service';import {CacheStore} from '../server/cache';import {fixture,at} from './sprint-fixtures';
import type {JiraGateway} from '../server/jira/ports';import type {HistorySnapshot} from '../shared/contracts';import {isJiraDataset} from '../shared/contracts';import {AppError} from '../server/errors';
import {JiraClient} from '../server/jira/client';import {collectSprintInputs,type SprintClient} from '../server/jira/sprints';
import {setup as collectorSetup} from './sprint-collector-fixture';
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
async function setup(){
 const dir=await mkdtemp(path.join(tmpdir(),'sprint-pipeline-'));dirs.push(dir);const {graph,input}=fixture();const store=new CacheStore(dir);
 const gateway:JiraGateway={async getIssue(key){const n=graph.nodes[key.replace('A-','')];return {id:n.id,key:n.key,title:n.title,flow:n.id==='1'?'HF':'DF',isEpic:n.type==='epic',isSubtask:false,resolution:'',currentStatus:n.currentStatus,currentStatusId:n.currentStatusId,created:n.created!,updated:n.history!.updated,assignee:'',issueType:'Task',linksKnown:true,links:graph.edges.filter(e=>e.parent===n.id)};},async getHistory(issue){return graph.nodes[issue.id].history as HistorySnapshot;},async readBoard(){throw Error('unused');},getStatusCategories:async()=>graph.nodes['3'].statusCategories,readSprintInputs:vi.fn(async g=>{expect(Object.keys(g.nodes)).toHaveLength(5);return structuredClone(input);})};
 const service=new DatasetService(store,()=>at(30),async()=>gateway);await service.initialize();const writes=vi.spyOn(store,'write');return {dir,input,graph,store,gateway,service,writes};
}
it('B14: phase B follows graph, refresh atomically replaces all inputs, failed write preserves exact old cache',async()=>{
 const s=await setup();const first=s.service.importEpic('https://hq.tutu.ru/browse/A-1');await s.service.waitForIdle();expect(first.status).toBe('completed');expect(s.writes).toHaveBeenCalledTimes(1);expect(isJiraDataset(first.dataset)&&first.dataset.sprintAnalysis?.rows['1'].segments).toHaveLength(3);
 const raw=await readFile(path.join(s.dir,'dataset.json'),'utf8');s.writes.mockRejectedValueOnce(new Error('disk full'));s.input.tasks['3'].sprintIds=[];
 const failed=s.service.refresh(first.dataset!.id);await s.service.waitForIdle();expect(failed.status).toBe('failed');expect(s.service.getDataset()).toEqual(first.dataset);expect(await readFile(path.join(s.dir,'dataset.json'),'utf8')).toBe(raw);
 const next=s.service.refresh(first.dataset!.id);await s.service.waitForIdle();expect(next.status).toBe('completed');expect(isJiraDataset(next.dataset)&&next.dataset.sprintAnalysis?.rows['1'].segments[0].state).toBe('empty');
});
it.each(['JIRA_UNAUTHORIZED','JIRA_NETWORK','RATE_LIMITED','ABORTED','IDENTITY_CHANGED','JIRA_VERSION_CHANGED'])('B18/B24: global %s after primary graph keeps published data, zero new writes',async code=>{
 const s=await setup();const first=s.service.importEpic('https://hq.tutu.ru/browse/A-1');await s.service.waitForIdle();s.writes.mockClear();s.gateway.readSprintInputs=async()=>{throw new AppError(code,'Сбор остановлен');};
 const next=s.service.refresh(first.dataset!.id);await s.service.waitForIdle();expect(next.status).toBe('failed');expect(s.writes).not.toHaveBeenCalled();expect(s.service.getDataset()).toEqual(first.dataset);
});
it('B33: unavailable HF histories retain original HISTORY_UNAVAILABLE gate before sprint requests',async()=>{
 const s=await setup();s.gateway.getHistory=async()=>{throw new AppError('JIRA_FORBIDDEN','История недоступна');};const job=s.service.importEpic('https://hq.tutu.ru/browse/A-1');await s.service.waitForIdle();expect(job.status).toBe('failed');expect(job.errors[0].code).toBe('HISTORY_UNAVAILABLE');expect(s.gateway.readSprintInputs).not.toHaveBeenCalled();expect(s.writes).not.toHaveBeenCalled();
});
it.each([false,true])('B24: actual HTTP 500 retries, recover=%s, and partial collector publication',async recover=>{
 const s=await setup(),c=collectorSetup({child:true});let attempts=0;
 const http=new JiraClient('fixture',{delay:async()=>{},fetcher:async()=>{attempts++;return new Response(recover&&attempts>1?'{}':'',{status:recover&&attempts>1?200:500,headers:{'content-type':'application/json'}});}});
 const client:SprintClient={async get(p,q,sig){if(p.endsWith('/issue/6')){await http.get(p,{},sig);}return c.client.get(p,q,sig);}};
 s.gateway.readSprintInputs=async(graph,asOf,signal)=>collectSprintInputs(client,c.gateway,graph,asOf,signal);
 // Only A-3 is represented by the collector fixture; use its primary graph, other local failures stay partial.
 const job=s.service.importEpic('https://hq.tutu.ru/browse/A-1');await s.service.waitForIdle();expect(job.status).toBe('completed');expect(s.writes).toHaveBeenCalledTimes(1);
 expect(attempts).toBeGreaterThanOrEqual(recover?2:3);expect(isJiraDataset(job.dataset)&&job.dataset.sprintAnalysis?.rows['3'].segments[0].state).toBe(recover?'work':'unknown');
});
