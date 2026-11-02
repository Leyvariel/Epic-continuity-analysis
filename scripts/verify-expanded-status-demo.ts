// Synthetic browser acceptance dataset in a private temporary cache. No Jira or working data.
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { CacheStore } from '../server/cache';
import { DatasetService } from '../server/service';
import { createApp } from '../server/app';
import { migrateLegacy } from '../server/cache-migrations';
import { STAGES } from '../shared/statuses';
import type { ImportedSelection } from '../shared/types';
import type { HierarchyNodeInput } from '../shared/hierarchy';
import { modelAt, modelHistory } from '../tests/status-model-fixtures';

const asOf=modelAt(120);
const samples=[
 modelHistory([['[HF] Проверка идей',5],['[HF] Отложено',60],['[HF] Реализация',10]],{key:'HOTELS-1'}),
 modelHistory([['[HF] Запланировано',10],['[HF] Проработка решения',5]],{key:'HOTELS-2',flagChanges:[{id:'f',at:modelAt(10),from:true,to:false}]}),
 modelHistory([['[HF] Проверка идей',5],['[HF] Отложено',60],['[HF] Реализация',10]],{key:'HOTELS-3',flagChanges:[{id:'a',at:modelAt(5),from:false,to:true},{id:'b',at:modelAt(69),from:true,to:false}]}),
 modelHistory([['Открыто',100],['[HF] Подготовка',2],['Открыто',3],['[HF] Реализация',4]],{key:'HOTELS-4'}),
 modelHistory([['Открыто',1],...STAGES.map(s=>[s.name,2] as [string,number]),['Открыто',1],['Релиз',0]],{key:'HOTELS-5'}),
 modelHistory([['[HF] Запланировано',10],['[HF] Проработка решения',5]],{key:'HOTELS-6',flagAvailable:false}),
 modelHistory([['Discovery вне модели',2],['Тестирование эпика',3],['Релиз',1]],{key:'HOTELS-7'}),
 modelHistory([['[HF] Реализация',5],['[HF] Отложено',60]],{key:'HOTELS-8',closed:false}),
];
const titles=['Отложено: 75 календарных суток, TTM 15','Планирование: TTM 15 / без флага 5','Пересечение исключений: 15 / 11','Возврат в Открыто: 3 суток, TTM 9','Все статусы и вложенные объекты','История флага недоступна','Точные этапы при неизвестном начале TTM','Открытое Отложено: TTM остаётся 5'];
const selection:ImportedSelection={asOf,source:{filename:'Синтетические примеры.xlsx',sheet:'Данные',importedAt:asOf,totalRows:samples.length,excludedDF:0,excludedRejected:0,invalidRows:0,duplicates:0},epics:[],histories:{},historyWarnings:{},warnings:[]};
const nodes:Record<string,HierarchyNodeInput>={};
function addNode(f:ReturnType<typeof modelHistory>,type:HierarchyNodeInput['type'],title:string) {
 const h={...f.history,title};nodes[h.key]={id:h.key,key:h.key,title,type,resolution:'',created:h.historyStart,currentStatus:h.currentStatus,
  statusCategories:{[h.currentStatus]:h.currentStatus.includes('Закрыт')?'done':'indeterminate'},history:h,historyCoverage:'complete',branchCoverage:'complete',warnings:[]};
}
samples.forEach((f,i)=>{
 const title=titles[i];selection.epics.push({...f.summary,title,sourceRow:i+2,excelAggregates:{'[HF] Time To Market':75,'Cycle Time [HF] Релиз':2,'Cycle Time [HF] Отложено':60,'Cycle Time [HF] Реализация':10}});
 selection.histories[f.history.key]={...f.history,title};addNode(f,'epic',title);
});
const df=modelHistory([['[DF] Реализация',4]],{key:'DELIVERY-1'});addNode(df,'epic','Вложенный эпик: собственные четыре дня');
const child=modelHistory([['Открыто',20],['В работе',2],['Открыто',3],['Проверка готовности к публикации',1]],{key:'TASK-1'});addNode(child,'task','Своя история: возврат 3 дня, без дочернего TTM');
selection.hierarchy={version:1,asOf,roots:Object.fromEntries(samples.map(f=>[f.history.key,f.history.key])),nodes,edges:[{parent:'HOTELS-5',child:'DELIVERY-1'},{parent:'DELIVERY-1',child:'TASK-1'}],coverage:'complete',warnings:[]};
if(process.argv.includes('--large'))for(let i=1;i<=201;i++){
 const key=`PAGE-${i}`;nodes[key]={...nodes['TASK-1'],id:key,key,title:`Проверка порционного раскрытия ${i}`};selection.hierarchy.edges.push({parent:'HOTELS-5',child:key});
}
const directory=await mkdtemp(path.join(os.tmpdir(),'expanded-status-demo-')),cache=new CacheStore(directory);
await cache.write(migrateLegacy(selection,asOf,'expanded-status-demo'));
const service=new DatasetService(cache,()=>asOf,async()=>{throw new Error('Demo forbids Jira');});await service.initialize();
const app=createApp(service,undefined,'demo');app.use(express.static(path.resolve('dist')));
const server=http.createServer(app);server.listen(4332,'127.0.0.1',()=>console.log(JSON.stringify({url:'http://127.0.0.1:4332',directory,synthetic:true})));
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>server.close());
