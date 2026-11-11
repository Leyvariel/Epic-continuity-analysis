// @vitest-environment jsdom
import {it,expect,vi,afterEach} from 'vitest';
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {App} from '../src/App';
import {buildJiraDataset} from '../server/jira/dataset';
import {sprintDatasetInputs} from './sprint-dataset-fixture';
import {at} from './sprint-fixtures';
const roots:Root[]=[];const data=()=>buildJiraDataset(sprintDatasetInputs(),at(30));
const response=(dataset:unknown)=>new Response(JSON.stringify({dataset}));
async function mount(fetcher:typeof fetch){Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.spyOn(globalThis,'fetch').mockImplementation(fetcher);const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);await act(()=>root.render(<App/>));return div;}
const button=(d:HTMLElement,text:string)=>[...d.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text)!;
const click=async(d:HTMLElement,text:string)=>{expect(button(d,text)).toBeDefined();await act(()=>button(d,text).click());};
afterEach(async()=>{for(const r of roots.splice(0))await act(()=>r.unmount());document.body.innerHTML='';vi.restoreAllMocks();});
it('AC-145/146 confirms, cancels without a request and clears the source and view only on success',async()=>{
 const d=data();const fetcher=vi.fn<typeof fetch>(async url=>String(url).endsWith('/reset')?response(null):response(d));const div=await mount(fetcher);
 await click(div,'Список ключей');const input=div.querySelector('textarea')!;await act(()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'A-99');input.dispatchEvent(new Event('input',{bubbles:true}));});
 await click(div,'Месяц');await click(div,'Сбросить все данные');expect(div.querySelector('[role="dialog"]')?.textContent).toContain('потребуется загрузить');await click(div,'Отмена');expect(fetcher).toHaveBeenCalledTimes(1);expect(div.querySelector('textarea')!.value).toBe('A-99');
 await click(div,'Сбросить все данные');await click(div,'Сбросить данные');expect(div.querySelector('.epic-row')).toBeNull();expect(div.textContent).toContain('Данные сброшены');expect(div.querySelector('textarea')).toBeNull();expect(div.textContent).toContain('Выберите эпики для анализа');expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toEqual({datasetId:d.id});
});
it('AC-149 server error retains the dataset; lost success response reconciles with the server',async()=>{
 const d=data();let lost=false;const div=await mount(vi.fn<typeof fetch>(async url=>{
  if(String(url).endsWith('/reset')){if(lost)throw new Error('network');return new Response(JSON.stringify({error:{code:'CACHE_RESET',message:'Очистка не выполнена'}}),{status:500});}
  return response(lost?null:d);
 }));
 await click(div,'Сбросить все данные');await click(div,'Сбросить данные');expect(div.querySelector('.epic-row')).not.toBeNull();expect(div.textContent).toContain('Очистка не выполнена');
 lost=true;await click(div,'Сбросить все данные');await click(div,'Сбросить данные');expect(div.querySelector('.epic-row')).toBeNull();expect(div.textContent).toContain('Данные сброшены');
});
it('AC-148 disables import and duplicate reset while request is pending',async()=>{
 let finish!:(r:Response)=>void;const div=await mount(vi.fn<typeof fetch>(async url=>String(url).endsWith('/reset')?new Promise(r=>finish=r):response(data())));
 await click(div,'Сбросить все данные');await click(div,'Сбросить данные');expect(button(div,'Сбросить все данные').disabled).toBe(true);expect(div.querySelector<HTMLInputElement>('input[type=file]')!.disabled).toBe(true);await act(()=>finish(response(null)));expect(div.querySelector('.epic-row')).toBeNull();
});
it('AC-150 can reset after corrupt-cache load error',async()=>{
 const div=await mount(async url=>String(url).endsWith('/reset')?response(null):new Response(JSON.stringify({error:{code:'CACHE_INVALID',message:'Кэш повреждён'}}),{status:500}));await click(div,'Сбросить все данные');await click(div,'Сбросить данные');expect(div.textContent).not.toContain('Кэш повреждён');
});
it('stale confirmation never retries deletion and shows the new dataset for a fresh confirmation',async()=>{
 const a=data(),b=data();b.epics[0].summary.title='Новый набор B';let reads=0;const fetcher=vi.fn<typeof fetch>(async url=>String(url).endsWith('/reset')?new Response(JSON.stringify({error:{code:'STALE_DATASET',message:'Набор изменился'}}),{status:409}):response(reads++===0?a:b));const div=await mount(fetcher);
 await click(div,'Сбросить все данные');await click(div,'Сбросить данные');expect(div.querySelector('.epic-row')).not.toBeNull();expect(div.textContent).toContain('Набор изменился');expect(fetcher.mock.calls.filter(([u])=>String(u).endsWith('/reset'))).toHaveLength(1);
 await click(div,'Сбросить все данные');await click(div,'Сбросить данные');const calls=fetcher.mock.calls.filter(([u])=>String(u).endsWith('/reset'));expect(JSON.parse(calls[1][1]!.body as string).datasetId).toBe(b.id);
});
it('lost reset response and failed reconciliation do not pretend success or retry imports',async()=>{
 let loaded=false;const fetcher=vi.fn<typeof fetch>(async()=>{if(!loaded){loaded=true;return response(data());}throw new Error('offline');});const div=await mount(fetcher);await click(div,'Сбросить все данные');await click(div,'Сбросить данные');expect(div.querySelector('.epic-row')).not.toBeNull();expect(div.textContent).toContain('Результат сброса не подтверждён');expect(fetcher).toHaveBeenCalledTimes(3);
});
it('AC-152 pending job responses cannot cross a reset: busy until completion, then polling stops',async()=>{
 vi.useFakeTimers();let finish!:(r:Response)=>void;const d=data();const fetcher=vi.fn<typeof fetch>(async url=>{
  const u=String(url);if(u.includes('/api/keys/import'))return new Response(JSON.stringify({id:'pending'}));
  if(u.includes('/api/jobs/'))return new Promise(r=>finish=r);
  if(u.endsWith('/reset'))return response(null);return response(d);
 });
 try{
  const div=await mount(fetcher);await click(div,'Список ключей');const textarea=div.querySelector('textarea')!;
  await act(()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(textarea,'A-1');textarea.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(()=>div.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  await act(()=>vi.advanceTimersByTimeAsync(700));expect(button(div,'Сбросить все данные').disabled).toBe(true);expect(fetcher.mock.calls.some(([u])=>String(u).endsWith('/reset'))).toBe(false);
  await act(()=>finish(new Response(JSON.stringify({id:'pending',status:'completed',dataset:d,errors:[],total:1,completed:1,currentKey:null,createdAt:at(30)}))));
  await click(div,'Сбросить все данные');await click(div,'Сбросить данные');await act(()=>vi.advanceTimersByTimeAsync(5000));expect(div.querySelector('.epic-row')).toBeNull();expect(fetcher.mock.calls.filter(([u])=>String(u).includes('/api/jobs/'))).toHaveLength(1);
 }finally{vi.useRealTimers();}
});
