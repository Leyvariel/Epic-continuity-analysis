// Isolated read-only UI fixtures, using the production derivation and a private temporary cache.
import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {STAGES} from '../shared/statuses';
import type {HistorySnapshot} from '../shared/contracts';
import type {HierarchyNodeInput} from '../shared/hierarchy';
import {sprintDatasetInputs} from '../tests/sprint-dataset-fixture';
import {at} from '../tests/sprint-fixtures';
import {buildJiraDataset} from '../server/jira/dataset';
import {jiraInputsSchema} from '../server/jira/cache-schema';
import {CacheStore} from '../server/cache';
import {DatasetService} from '../server/service';
import {createApp} from '../server/app';

function stages(node:HierarchyNodeInput,names:string[]){
 const h=node.history! as HistorySnapshot;
 h.statusChanges=names.slice(1).map((to,i)=>({id:`column${i}`,at:at(i+2),from:names[i],to,fromId:`c${i}`,toId:`c${i+1}`}));
 h.currentStatus=node.currentStatus=names.at(-1)!;h.currentStatusId=node.currentStatusId=`c${names.length-1}`;
 node.statusCategories=Object.fromEntries(names.map((_,i)=>[`c${i}`,'indeterminate']));
 h.historyCount=h.statusChanges.length;h.proof={expected:h.historyCount,received:h.historyCount,terminal:true,adapterVersion:'fixture'};
}
function inputs(alternatives:boolean){
 const input=sprintDatasetInputs(),graph=input.hierarchy!;
 stages(graph.nodes['2'],STAGES.map(s=>s.name));
 graph.nodes['2'].title='Связанный эпик со всеми статусами';
 graph.nodes['3'].title='Задача с подтверждённой работой';
 if(alternatives)stages(graph.nodes['1'],['Подготовка','Валидация','Скоринг','Реализация','Тестирование эпика','Релиз','Эксперимент']);
 input.source={kind:'keys',importedAt:at(30),historyMode:'jira'};
 input.epics[0].title=alternatives?'Гипотеза с альтернативными статусами':'Гипотеза: только реализация';
 graph.nodes['1'].history!.title=input.epics[0].title;
 graph.roots['A-4']='4';
 input.epics.push({key:'A-4',title:'Вторая гипотеза: только реализация',type:'HF',resolution:'',excelAggregates:{TTM:42,'Cycle Time [HF] Реализация':11}});
 input.histories['jira:4']=graph.nodes['4'].history as HistorySnapshot;
 input.candidates.push({requestedKey:'A-4',rows:[],issueId:'4'});
 input.audit.entries.push({requestedKey:'A-4',rows:[],issueId:'4',key:'A-4',decision:'included',reason:'Синтетическая гипотеза'});
 input.candidates.forEach((candidate,i)=>{candidate.rows=[i+1];input.audit.entries[i].rows=[i+1];});
 input.audit.inputRows=input.audit.resolvedIssues=2;
 return jiraInputsSchema.parse(input);
}
const base=inputs(false),directory=await mkdtemp(path.join(os.tmpdir(),'hypothesis-columns-')),cache=new CacheStore(directory);
await cache.write({schemaVersion:3,calculationProfile:'jira-v3',inputs:base,dataset:buildJiraDataset(base,at(30),'columns-base')});
const service=new DatasetService(cache);await service.initialize();
const app=express();
app.get('/api/alternative-fixture',(_req,res)=>res.json({dataset:buildJiraDataset(inputs(true),at(30),'columns-alternatives')}));
app.use(createApp(service,undefined,'demo'));app.use(express.static(path.resolve('dist')));
const server=app.listen(4334,'127.0.0.1',()=>console.log('Read-only status column fixture: http://127.0.0.1:4334/'));
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>server.close());
