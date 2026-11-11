import {afterEach,describe,it,expect,vi} from 'vitest';
import {mkdtemp,rm,writeFile,readFile,mkdir,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {CacheStore} from '../server/cache';
import {DatasetService} from '../server/service';
import {createApp} from '../server/app';
import {historyWorkbook,AS_OF} from './fixtures';
const clean:(()=>Promise<unknown>)[]=[];
afterEach(async()=>{for(const fn of clean.splice(0).reverse())await fn();vi.restoreAllMocks();});
async function setup(mode:'application'|'demo'|'snapshot'='application'){
 const dir=await mkdtemp(path.join(tmpdir(),'dataset-reset-'));clean.push(()=>rm(dir,{recursive:true,force:true}));const cache=new CacheStore(dir),gateway=vi.fn(),service=new DatasetService(cache,()=>AS_OF,gateway);await service.initialize();
 const server=http.createServer(createApp(service,undefined,mode));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));clean.push(()=>new Promise<void>(r=>server.close(()=>r())));const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const reset=(datasetId:string|null,headers:Record<string,string>={})=>fetch(url+'/api/reset',{method:'POST',headers:{'Content-Type':'application/json','X-Local-Request':'1',...headers},body:JSON.stringify({datasetId})});
 const load=async()=>{const j=service.import(historyWorkbook(),'x.xlsx');await service.waitForIdle();expect(j.status).toBe('completed');return j;};return {dir,cache,service,gateway,url,reset,load};
}
describe('FR-055 dataset reset',()=>{
 it('AC-146/147 clears only owned analysis, jobs and survives restart; next import is fresh',async()=>{
  const a=await setup(),j=await a.load(),id=j.dataset!.id;
  const tmp='dataset-12345678-1234-1234-1234-123456789012.tmp';for(const n of ['dataset.v2.backup.json',tmp,'jira-profile.json','report.json','source.xlsx'])await writeFile(path.join(a.dir,n),'sentinel');
  expect((await a.reset(id)).status).toBe(200);expect(a.service.getDataset()).toBeNull();expect(()=>a.service.getJob(j.id)).toThrow();expect(await readdir(a.dir)).toEqual(expect.arrayContaining(['jira-profile.json','report.json','source.xlsx']));expect(await readdir(a.dir)).not.toContain('dataset.json');expect(await readdir(a.dir)).not.toContain(tmp);expect(await readdir(a.dir)).not.toContain('dataset.v2.backup.json');
  const restarted=new DatasetService(new CacheStore(a.dir));await restarted.initialize();expect(restarted.getDataset()).toBeNull();expect((await a.load()).dataset!.id).not.toBe(id);expect(a.gateway).not.toHaveBeenCalled();
 });
 it('AC-148 rejects stale ID and busy import without changing the dataset',async()=>{
  const a=await setup();const first=await a.load(),second=await a.load();expect((await a.reset(first.dataset!.id)).status).toBe(409);expect(a.service.getDataset()!.id).toBe(second.dataset!.id);
  const original=a.cache.write.bind(a.cache);let release!:()=>void;const gate=new Promise<void>(r=>release=r);vi.spyOn(a.cache,'write').mockImplementation(async s=>{await gate;await original(s);});a.service.import(historyWorkbook(),'x.xlsx');try{expect((await a.reset(second.dataset!.id)).status).toBe(409);}finally{release();await a.service.waitForIdle();}
 });
 it('AC-149 failure removing a backup preserves the current usable dataset',async()=>{
  const a=await setup(),j=await a.load();await mkdir(path.join(a.dir,'dataset.v2.backup.json'));const before=await readFile(path.join(a.dir,'dataset.json'),'utf8');const response=await a.reset(j.dataset!.id);expect(response.status).toBe(500);expect((await response.json()).error.code).toBe('CACHE_RESET');expect(a.service.getDataset()!.id).toBe(j.dataset!.id);expect(await readFile(path.join(a.dir,'dataset.json'),'utf8')).toBe(before);
 });
 it('AC-150 repeats empty reset and clears corrupt cache without parsing it',async()=>{
  const a=await setup();expect((await a.reset(null)).status).toBe(200);expect((await a.reset(null)).status).toBe(200);await writeFile(path.join(a.dir,'dataset.json'),'{broken');await a.service.initialize();expect(()=>a.service.getDataset()).toThrow();expect((await a.reset(null)).status).toBe(200);expect(a.service.getDataset()).toBeNull();
 });
 it.each(['demo','snapshot'] as const)('AC-151 %s protects data',async mode=>{const a=await setup(mode),j=await a.load();expect((await a.reset(j.dataset!.id)).status).toBe(409);expect(a.service.getDataset()).not.toBeNull();});
 it('AC-151 rejects cross-site and malformed reset',async()=>{const a=await setup(),j=await a.load();expect((await a.reset(j.dataset!.id,{Origin:'https://example.test'})).status).toBe(403);expect((await a.reset(j.dataset!.id,{'X-Local-Request':'0'})).status).toBe(403);expect((await fetch(a.url+'/api/reset',{method:'POST',headers:{'Content-Type':'application/json','X-Local-Request':'1'},body:'{}'})).status).toBe(400);expect(a.service.getDataset()).not.toBeNull();});
});
it('reset serializes with new imports and another reset until the cache operation settles',async()=>{
 const a=await setup(),j=await a.load();const original=a.cache.clear.bind(a.cache);let release!:()=>void;const gate=new Promise<void>(r=>release=r);vi.spyOn(a.cache,'clear').mockImplementation(async()=>{await gate;await original();});
 const pending=a.service.reset(j.dataset!.id);try{expect(()=>a.service.import(historyWorkbook(),'x.xlsx')).toThrow();expect((await a.reset(j.dataset!.id)).status).toBe(409);expect(a.service.getDataset()!.id).toBe(j.dataset!.id);}finally{release();await pending;}
 expect(a.service.getDataset()).toBeNull();await a.load();
});
