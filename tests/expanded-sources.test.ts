import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CacheStore } from '../server/cache';
import { DatasetService } from '../server/service';
import { buildJiraDataset } from '../server/jira/dataset';
import { parseWorkbook } from '../server/import';
import { buildDataset } from '../server/dataset';
import { metricsFor, metricValue, relatedMetricValue } from '../shared/metrics';
import { jiraHistory } from './jira-fixtures';
import { modelHistory, modelAt } from './status-model-fixtures';
import { workbook } from './fixtures';
import { linkedWorkbook } from './linked-workbook';
import { CUT } from './hierarchy-fixtures';
import type { JiraInputs } from '../shared/contracts';
import { DAY_MS } from '../shared/statuses';
const dirs:string[]=[];
afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
function source(steps:[string,number][], flag=false) {
 const f=modelHistory(steps,{key:'HOTELS-1',...(flag?{flagChanges:[{id:'f',at:modelAt(10),from:true,to:false}]}:{})});
 const h=jiraHistory({...f.history,proof:{expected:f.history.historyCount,received:f.history.historyCount,terminal:true,adapterVersion:'fixture'}});
 const inputs:JiraInputs={source:{kind:'keys',importedAt:f.asOf,historyMode:'jira'},asOf:f.asOf,syncStartedAt:f.asOf,syncFinishedAt:f.asOf,
  candidates:[{requestedKey:'HOTELS-1',rows:[1],issueId:'1'},{requestedKey:'HOTELS-2',rows:[2],issueId:'2'}],
  audit:{inputRows:2,sourceCoverage:'complete',eligibilityCoverage:'partial',resolvedIssues:2,duplicates:0,entries:[
   {requestedKey:'HOTELS-1',key:'HOTELS-1',issueId:'1',rows:[1],decision:'included',reason:'HF'},
   {requestedKey:'HOTELS-2',key:'HOTELS-2',issueId:'2',rows:[2],decision:'unresolved',reason:'Историческое решение без [HF]'},
  ]},epics:[f.summary],histories:{'jira:1':h},historyWarnings:{},warnings:[]};
 let day=0;
 const rows=steps.map(([status,days])=>{const from=day;day+=days;return ['HOTELS-1',status,modelAt(from),modelAt(day)];});
 rows.push(['HOTELS-1','[HF] Закрыт',modelAt(day),'']);
 const extras:Record<string,unknown[][]>={История:[['Ключ эпика','Статус','Начало','Окончание'],...rows],Параметры:[['asOf',f.asOf]],Impediment:[['Ключ эпика','Начало','Окончание'],...(flag?[['HOTELS-1',modelAt(0),modelAt(10)]]:[])]};
 const bytes=()=>workbook([['Ключ','Тип эпика','Название','Резолюция','[HF] Time To Market','Cycle Time [HF] Отложено'],['HOTELS-1','HF','Синтетический пример','',75,60]],extras);
 return {inputs,extras,bytes,asOf:f.asOf};
}
it('AC-118/119: old v3 derived fields are ignored; fixed inputs and audit restore byte-for-byte without network',async()=>{
 const f=source([['[HF] Проверка идей',5],['[HF] Отложено',60],['[HF] Реализация',10]]);
 const dir=await mkdtemp(path.join(os.tmpdir(),'expanded-cache-'));dirs.push(dir);
 const file=path.join(dir,'dataset.json');
 const old=JSON.stringify({schemaVersion:3,calculationProfile:'jira-v3',inputs:f.inputs,dataset:{id:'old-set',savedAt:f.asOf,epics:[{ttmMs:75*DAY_MS}]}});
 await writeFile(file,old);const network=vi.fn(async()=>{throw new Error('Network forbidden');});
 for(const now of [modelAt(90),modelAt(100)]) {
  const service=new DatasetService(new CacheStore(dir),()=>now,network);await service.initialize();
  const data=service.getDataset()!;expect(data.id).toBe('old-set');expect(data.asOf).toBe(f.asOf);expect(data.savedAt).toBe(f.asOf);
  expect(data.epics).toHaveLength(1);expect(data.epics[0].ttmMs).toBe(15*DAY_MS);expect(data.epics[0].ttmWithoutFlagMs).toBe(15*DAY_MS);
  expect('audit' in data && data.audit.entries).toEqual(f.inputs.audit.entries);
  expect(await readFile(file,'utf8')).toBe(old);
 }
 expect(network).not.toHaveBeenCalled();
});
it.each([false,true])('AC-116/017: exact Jira and XLSX histories have the same independent metrics, flag=%s',flag=>{
 const f=source(flag?[['[HF] Запланировано',10],['[HF] Проработка решения',5]]:[['[HF] Проверка идей',5],['[HF] Отложено',60],['[HF] Реализация',10]],flag);
 const jira=buildJiraDataset(f.inputs,f.asOf).epics[0],offline=buildDataset(parseWorkbook(f.bytes(),'fixture.xlsx',f.asOf),f.asOf).epics[0];
 for(const field of ['ttmMs','ttmWithoutFlagMs','ttmFlaggedMs','impedimentMs','returnToOpenMs','durations'] as const)expect(offline[field]).toEqual(jira[field]);
 expect(offline.ttmMs).toBe(15*DAY_MS);expect(offline.ttmWithoutFlagMs).toBe((flag?5:15)*DAY_MS);
 delete f.extras.Impediment;
 const unknown=buildDataset(parseWorkbook(f.bytes(),'without-flags.xlsx',f.asOf),f.asOf).epics[0];
 expect(unknown.ttmMs).toBe(15*DAY_MS);expect(unknown.ttmWithoutFlagMs).toBeNull();
});
it('AC-117: aggregate 75/60 stays source data, without invented dates or a flagless metric',()=>{
 const f=source([['[HF] Реализация',5]]);delete f.extras.История;delete f.extras.Impediment;delete f.extras.Параметры;
 const r=buildDataset(parseWorkbook(f.bytes(),'aggregates.xlsx',f.asOf),f.asOf).epics[0];
 expect(metricValue(r,'ttm','excel')).toBe(75*DAY_MS);expect(metricValue(r,'deferred','excel')).toBe(60*DAY_MS);
 expect(r.ttmMs).toBeNull();expect(metricValue(r,'ttmWithoutFlag','excel')).toBeNull();expect(r.intervals).toEqual([]);
});
it('AC-046/044: own numbers and stable columns survive offline hierarchy restore without Jira',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'expanded-hierarchy-cache-'));dirs.push(dir);
 const network=vi.fn(async()=>{throw new Error('Network forbidden');});
 const service=new DatasetService(new CacheStore(dir),()=>CUT,network);service.import(linkedWorkbook(),'children.xlsx');await service.waitForIdle();
 const original=service.getDataset()!,next=new DatasetService(new CacheStore(dir),()=>modelAt(400),network);await next.initialize();const restored=next.getDataset()!;
 expect(restored).toEqual(original);
 expect(relatedMetricValue(restored.hierarchy!.nodes['C-1'],'status:в работе')).toBe(4*DAY_MS);
 expect(metricsFor(restored.epics,'history')).toEqual(metricsFor(original.epics,'history'));
 expect(network).not.toHaveBeenCalled();
});
