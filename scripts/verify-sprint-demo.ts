// Reproducible synthetic acceptance fixture. Never reads Jira or the working cache.
import {mkdtemp} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import http from 'node:http';import express from 'express';
import {CacheStore} from '../server/cache';import {DatasetService} from '../server/service';import {createApp} from '../server/app';import {buildJiraDataset} from '../server/jira/dataset';import {jiraInputsSchema} from '../server/jira/cache-schema';
import {sprintDatasetInputs} from '../tests/sprint-dataset-fixture';import {controlFixture} from '../tests/sprint-control-fixture';
import type {HistorySnapshot} from '../shared/contracts';
const {graph,input}=controlFixture(),inputs=sprintDatasetInputs();inputs.hierarchy=graph;inputs.sprintInputs=input;inputs.asOf=inputs.syncStartedAt=inputs.syncFinishedAt=graph.asOf;inputs.histories={'jira:1':graph.nodes['1'].history as HistorySnapshot};inputs.epics[0].title='Контрольный пример: четыре бреши, 26 суток';graph.nodes['1'].title=inputs.epics[0].title;
const directory=await mkdtemp(path.join(os.tmpdir(),'epic-sprint-demo-')),cache=new CacheStore(directory);const validated=jiraInputsSchema.parse(inputs);await cache.write({schemaVersion:3,calculationProfile:'jira-v3',inputs:validated,dataset:buildJiraDataset(validated,graph.asOf,'sprint-control-demo')});
const service=new DatasetService(cache);await service.initialize();const app=createApp(service,undefined,'demo');app.use(express.static(path.resolve('dist')));const server=http.createServer(app);server.listen(4331,'127.0.0.1',()=>console.log(JSON.stringify({url:'http://127.0.0.1:4331',directory,expectedGaps:4,expectedGapDays:26})));
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>server.close());
