import {describe,it,expect} from 'vitest';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {DatasetService} from '../server/service';import {CacheStore} from '../server/cache';import {linkedWorkbook} from './linked-workbook';import {CUT} from './hierarchy-fixtures';
describe('T009: сохранение графа',()=>{
 it('после перезапуска офлайн восстанавливает те же полосы и отвергает неизвестное дополнение',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'hierarchy-cache-'));
  try{const forbidden=async()=>{throw new Error('Нельзя читать Jira');};const s=new DatasetService(new CacheStore(dir),()=>CUT,forbidden);s.import(linkedWorkbook(),'offline.xlsx');await s.waitForIdle();const d=s.getDataset();expect(d?.hierarchy?.nodes['C-1'].timeline.closed).toBe(true);const next=new DatasetService(new CacheStore(dir),()=>CUT,forbidden);await next.initialize();expect(next.getDataset()).toEqual(d);const file=path.join(dir,'dataset.json');const raw=JSON.parse(await readFile(file,'utf8'));raw.selection.hierarchy.version=2;const text=JSON.stringify(raw);await writeFile(file,text);await expect(new CacheStore(dir).read()).rejects.toMatchObject({code:'CACHE_INVALID'});expect(await readFile(file,'utf8')).toBe(text);}
  finally{await rm(dir,{recursive:true,force:true});}
 });
});

it('AC-046: срез дополнения не может расходиться с срезом набора',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'hierarchy-cutoff-'));
 try{const s=new DatasetService(new CacheStore(dir),()=>CUT);s.import(linkedWorkbook(),'offline.xlsx');await s.waitForIdle();const file=path.join(dir,'dataset.json'),raw=JSON.parse(await readFile(file,'utf8'));raw.selection.hierarchy.asOf='2026-09-09T00:00:00+03:00';await writeFile(file,JSON.stringify(raw));await expect(new CacheStore(dir).read()).rejects.toMatchObject({code:'CACHE_INVALID'});}
 finally{await rm(dir,{recursive:true,force:true});}
});
