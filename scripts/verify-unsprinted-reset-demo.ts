// Application-mode fixture with a disposable cache; never touches the user's cache or Jira.
import {mkdtemp,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {CacheStore} from '../server/cache';
import {DatasetService} from '../server/service';
import {createApp} from '../server/app';
import {buildJiraDataset} from '../server/jira/dataset';
import {sprintDatasetInputs} from '../tests/sprint-dataset-fixture';
import {node,sprint,at} from '../tests/sprint-fixtures';
import {historyWorkbook} from '../tests/fixtures';
const directory=await mkdtemp(path.join(os.tmpdir(),'unsprinted-reset-')),cache=new CacheStore(directory);
function fixture(mixed:boolean){
 const input=sprintDatasetInputs(),g=input.hierarchy!,s=input.sprintInputs!;
 g.nodes['3']=node('3','task',[[4,7]]);g.nodes['3'].key=g.nodes['3'].history!.key='TEXT-3';g.nodes['3'].title='Точная активность без спринтов';
 s.tasks['3']={...s.tasks['3'],sprintIds:[],changes:[],calendarIds:[],calendarCoverage:'partial'};
 if(mixed){s.sprints={'11':sprint('11',1,15)};s.calendars['100'].sprintIds=['11'];s.tasks['5'].sprintIds=[];}
 else g.edges=g.edges.filter(e=>e.parent!=='4');
 return input;
}
const inputs=fixture(true);
await cache.write({schemaVersion:3,calculationProfile:'jira-v3',inputs,dataset:buildJiraDataset(inputs,at(30),'mixed-fixture')});
await writeFile(path.join(directory,'new-analysis.xlsx'),historyWorkbook());
let service=new DatasetService(cache);await service.initialize();
const app=express();app.get('/api/test-fixture',(_req,res)=>res.json({dataset:buildJiraDataset(fixture(false),at(30),'exact-fixture')}));
app.get('/api/test-workbook',(_req,res)=>res.type('application/octet-stream').send(historyWorkbook()));
app.use((req,res,next)=>createApp(service)(req,res,next));app.use(express.static(path.resolve('dist')));
const server=app.listen(4335,'127.0.0.1',()=>console.log(JSON.stringify({url:'http://127.0.0.1:4335',directory})));
process.on('SIGHUP',()=>{void(async()=>{await service.waitForIdle();const next=new DatasetService(cache);await next.initialize();service=next;console.log('Fixture service reinitialized from disk');})();});
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>server.close());
