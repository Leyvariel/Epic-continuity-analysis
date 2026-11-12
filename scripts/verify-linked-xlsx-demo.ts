// Disposable application-mode server for XLSX acceptance; no access to Jira or the user's cache.
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import * as XLSX from 'xlsx';
import {createApp} from '../server/app';
import {DatasetService} from '../server/service';
import {CacheStore} from '../server/cache';
import {linkedWorkbook} from '../tests/linked-workbook';
import {workbook} from '../tests/fixtures';
import {CUT,at} from '../tests/hierarchy-fixtures';

const directory=await mkdtemp(path.join(os.tmpdir(),'linked-xlsx-acceptance-')),cache=new CacheStore(directory);
function fixture(paged=false){
 const book=XLSX.read(linkedWorkbook(),{type:'buffer'}),append=(name:string,rows:unknown[][])=>XLSX.utils.sheet_add_aoa(book.Sheets[name],rows,{origin:-1});
 // Excel aggregates deliberately differ from the calendar to exercise switching between the two modes.
 XLSX.utils.sheet_add_aoa(book.Sheets['Данные'],[['[HF] Time To Market'],[42]],{origin:'E1'});
 append('Данные',[['Z-1','Пустой исходный эпик','HF','',2],['W-1','Эпик с неизвестным составом','HF','',3]]);
 append('Элементы',[
  ['Z-1','Пустой исходный эпик','Эпик','',at(1),'[HF] Реализация'],
  ['W-1','Неизвестный состав','Эпик','',at(1),'[HF] Реализация'],
  ['R-1','Скрытый отклонённый эпик','Эпик','Отклонено',at(1),'[DF] Закрыт'],
  ['V-1','Задача через скрытый эпик','Задача','',at(1),'В работе'],
  ['D-1','История недоступна','Задача','',at(1),'В работе'],
  ['F-1','Создана после среза','Задача','',at(11),''],
  ['T-1','Короткие статусы с длинными названиями','Задача','',at(1),'Готово'],
 ]);
 append('Связи',[['A-1','contains','C-1'],['A-1','contains','R-1'],['R-1','contains','V-1'],['A-1','contains','D-1'],['A-1','contains','F-1'],['A-1','contains','T-1'],['B-1','contains','A-1'],['W-1','contains','UNKNOWN-1'],['W-1','invalid relation','INVALID-1']]);
 const short='2026-09-03T00:00:30+03:00';
 append('История',[
  ['Z-1','[HF] Реализация',at(1),CUT],['W-1','[HF] Реализация',at(1),CUT],['V-1','В работе',at(1),CUT],
  ['T-1','Открыто',at(1),at(3)],['T-1','Длинное название этапа согласования результата',at(3),short],['T-1','Нулевой промежуточный статус',short,short],['T-1','В работе',short,at(7)],['T-1','Готово',at(7),''],
 ]);
 if(paged)for(let i=1;i<=201;i++){
  const key=`PAGE-${i}`;append('Элементы',[[key,`Задача ${i}`,'Задача','',at(1),'В работе']]);append('Связи',[['Z-1','contains',key]]);append('История',[[key,'В работе',at(1),CUT]]);
 }
 return XLSX.write(book,{type:'buffer',bookType:'xlsx'}) as Buffer;
}
const books={linked:fixture(),paged:fixture(true),old:workbook()};
for(const [name,buffer] of Object.entries(books))await writeFile(path.join(directory,`${name}.xlsx`),buffer,{mode:0o600});
let jiraCalls=0;
const createService=()=>new DatasetService(cache,()=>CUT,async()=>{jiraCalls++;throw new Error('Проверка XLSX не должна обращаться к Jira');});
let service=createService();await service.initialize();
const app=express();
app.get('/api/test/book/:name',(req,res)=>{const book=books[req.params.name as keyof typeof books];if(!book){res.sendStatus(404);return;}res.type('application/octet-stream').send(book);});
app.get('/api/test/state',(_req,res)=>res.json({jiraCalls,directory}));
app.post('/api/test/reopen',async(req,res)=>{
 if(req.get('X-Local-Request')!=='1'||req.get('Host')!=='127.0.0.1:4336'){res.sendStatus(403);return;}
 await service.waitForIdle();const before=await readFile(path.join(directory,'dataset.json'));service=createService();await service.initialize();
 res.json({unchanged:before.equals(await readFile(path.join(directory,'dataset.json'))),dataset:service.getDataset(),jiraCalls});
});
app.use((req,res,next)=>createApp(service)(req,res,next));app.use(express.static(path.resolve('dist')));
const server=app.listen(4336,'127.0.0.1',()=>console.log(JSON.stringify({url:'http://127.0.0.1:4336',directory})));
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>server.close());
