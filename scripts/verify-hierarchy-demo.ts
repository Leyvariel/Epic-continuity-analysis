import {mkdtemp,writeFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import http from 'node:http';import express from 'express';import * as XLSX from 'xlsx';
import {DatasetService} from '../server/service';import {CacheStore} from '../server/cache';import {createApp} from '../server/app';import {linkedWorkbook} from '../tests/linked-workbook';import {CUT,at} from '../tests/hierarchy-fixtures';
const directory=await mkdtemp(path.join(os.tmpdir(),'epic-hierarchy-demo-'));
const book=XLSX.read(linkedWorkbook(),{type:'buffer'});
const append=(name:string,rows:unknown[][])=>XLSX.utils.sheet_add_aoa(book.Sheets[name],rows,{origin:-1});
append('Данные',[['Z-1','Пустой исходный эпик','HF','']]);
append('Элементы',[
 ['Z-1','Пустой исходный эпик','Эпик','',at(1),'[HF] Реализация'],
 ['R-1','Отклонённый промежуточный эпик','Эпик','Отклонено',at(1),'[DF] Закрыт'],
 ['V-1','Допустимая задача через скрытый эпик','Задача','',at(1),'В работе'],
 ['D-1','История этой задачи недоступна','Задача','',at(1),'В работе'],
 ['F-1','Создана после среза','Задача','',at(11),''],
]);
append('Связи',[['A-1','contains','C-1'],['A-1','contains','R-1'],['R-1','contains','V-1'],['A-1','contains','D-1'],['A-1','contains','F-1'],['B-1','contains','A-1']]);
append('История',[['Z-1','[HF] Реализация',at(1),CUT],['V-1','В работе',at(1),CUT]]);
const buffer=XLSX.write(book,{type:'buffer',bookType:'xlsx'}) as Buffer;
await writeFile(path.join(directory,'linked-issues-demo.xlsx'),buffer,{mode:0o600});
const service=new DatasetService(new CacheStore(directory),()=>CUT,async()=>{throw new Error('Автономная демонстрация не читает Jira');});service.import(buffer,'linked-issues-demo.xlsx');await service.waitForIdle();
const app=createApp(service,undefined,'demo');app.use(express.static(path.resolve('dist')));const server=http.createServer(app);server.listen(4329,'127.0.0.1',()=>console.log(JSON.stringify({url:'http://127.0.0.1:4329',directory})));
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>server.close());
