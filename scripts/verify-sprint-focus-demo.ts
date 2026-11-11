// Synthetic browser fixture, private temporary cache, read-only API. No Jira or working cache access.
import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import http from 'node:http';import express from 'express';
import {STAGES} from '../shared/statuses';
import {fixture,node,at} from '../tests/sprint-fixtures';
import {sprintDatasetInputs} from '../tests/sprint-dataset-fixture';
import type {HistorySnapshot} from '../shared/contracts';
import {CacheStore} from '../server/cache';import {DatasetService} from '../server/service';
import {createApp} from '../server/app';import {buildJiraDataset} from '../server/jira/dataset';import {jiraInputsSchema} from '../server/jira/cache-schema';
const inputs=sprintDatasetInputs(),graph=inputs.hierarchy!,sprints=inputs.sprintInputs!;
inputs.source={kind:'keys',importedAt:at(30),historyMode:'jira'};inputs.epics=[];inputs.histories={};inputs.candidates=[];inputs.audit.entries=[];
graph.nodes={};graph.edges=[];graph.roots={};sprints.tasks={};sprints.sprints={};sprints.calendars={};
const titles=['14 суток без работы, тёмных отметок нет','Работа во всех спринтах: 0 суток','Активный спринт: предварительные 15 суток','Неизвестное членство: итог недоступен','Эпик до реализации: показатель не начат','Нет включения: прежние отметки сохранены'];
for(let i=0;i<titles.length;i++){
 const f=fixture(),offset=(i+1)*100,id=(s:string)=>String(offset+Number(s)),root=f.graph.nodes['1'];
 if(i===1)f.graph.nodes['3']=node('3','task',[[2,3],[9,10],[16,17]]);
 if(i===2){f.graph.nodes['3']=node('3','task',[[2,3],[9,10]]);f.input.sprints['13'].state='active';f.input.sprints['13'].completeDate=null;}
 if(i===3)f.input.tasks['3'].membershipCoverage='partial';
 if(i===4)root.history!.currentStatus=root.currentStatus='Открыто';
 if(i===5)for(const t of Object.values(f.input.tasks))t.sprintIds=[];
 root.title=titles[i];root.history!.title=titles[i];
 for(const n of Object.values(f.graph.nodes)){const old=n.id;n.id=id(old);n.key=`FOCUS-${n.id}`;n.history!.key=n.key;graph.nodes[n.id]=n;}
 for(const e of f.graph.edges)graph.edges.push({parent:id(e.parent),child:id(e.child)});
 graph.roots[root.key]=root.id;
 for(const s of Object.values(f.input.sprints)){s.id=id(s.id);s.originBoardId=id('100');sprints.sprints[s.id]=s;}
 sprints.calendars[id('100')]={boardId:id('100'),sprintIds:Object.values(f.input.sprints).map(s=>s.id),coverage:'complete',warnings:[]};
 for(const t of Object.values(f.input.tasks)){t.issueId=id(t.issueId);t.sprintIds=t.sprintIds.map(id);t.calendarIds=[id('100')];sprints.tasks[t.issueId]=t;}
 inputs.epics.push({key:root.key,title:root.title,type:'HF',resolution:'',excelAggregates:{TTM:42,'Cycle Time [HF] Реализация':11}});
 inputs.histories[`jira:${root.id}`]=root.history as HistorySnapshot;
 const candidate={requestedKey:root.key,rows:[i+1],issueId:root.id};inputs.candidates.push(candidate);inputs.audit.entries.push({...candidate,key:root.key,decision:'included',reason:'Синтетическая гипотеза'});
}
// A broad child history verifies that descendant statuses stay on bars without adding source columns or changing root focus.
const wide=graph.nodes['102'],h=wide.history! as HistorySnapshot;
h.statusChanges=STAGES.slice(1).map((stage,i)=>({id:`wide${i}`,at:at(i+2),from:STAGES[i].name,to:stage.name,fromId:`w${i}`,toId:`w${i+1}`}));
h.currentStatus=wide.currentStatus=STAGES.at(-1)!.name;h.currentStatusId=wide.currentStatusId=`w${STAGES.length-1}`;
wide.statusCategories=Object.fromEntries(STAGES.map((s,i)=>[`w${i}`,'indeterminate']));h.historyCount=h.statusChanges.length;h.proof={expected:h.historyCount,received:h.historyCount,terminal:true,adapterVersion:'fixture'};
// A separate pre-implementation root exercises pagination; its focus remains not-started.
for(let i=0;i<202;i++){const id=String(9000+i),n=node(id);graph.nodes[id]=n;graph.edges.push({parent:'502',child:id});sprints.tasks[id]={...sprints.tasks['503'],issueId:id};}
inputs.audit.inputRows=inputs.audit.resolvedIssues=titles.length;
const validated=jiraInputsSchema.parse(inputs),directory=await mkdtemp(path.join(os.tmpdir(),'sprint-focus-demo-')),cache=new CacheStore(directory);
await cache.write({schemaVersion:3,calculationProfile:'jira-v3',inputs:validated,dataset:buildJiraDataset(validated,at(30),'sprint-focus-demo')});
const service=new DatasetService(cache);await service.initialize();const app=createApp(service,undefined,'demo');app.use(express.static(path.resolve('dist')));
const server=http.createServer(app);server.listen(4333,'127.0.0.1',()=>console.log(JSON.stringify({url:'http://127.0.0.1:4333',directory})));
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>server.close());
