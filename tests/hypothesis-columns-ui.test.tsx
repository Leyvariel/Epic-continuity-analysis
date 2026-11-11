// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import {App} from '../src/App';
import {buildJiraDataset} from '../server/jira/dataset';
import {calculateTimeline} from '../server/timeline';
import {sprintDatasetInputs} from './sprint-dataset-fixture';
import {modelHistory} from './status-model-fixtures';
import {at} from './sprint-fixtures';

let root:Root;
afterEach(async()=>{if(root)await act(()=>root.unmount());document.body.innerHTML='';vi.restoreAllMocks();});
const alternatives=['Подготовка','Валидация','Скоринг','Тестирование эпика','Релиз'];
const epic=(key:string,steps:[string,number][])=>{
 const f=modelHistory(steps,{key});return calculateTimeline(f.summary,f.history,f.asOf);
};
it('AC-138: descendant-only alternatives are absent from headers, sorting and legend, with their bars retained',async()=>{
 const input=sprintDatasetInputs(),child=input.hierarchy!.nodes['2'],history=child.history!;
 history.statusChanges=alternatives.map((status,i)=>({id:`alt${i}`,at:at(i+2),from:status,to:alternatives[i+1]??'[HF] Реализация'}));
 history.historyCount=history.statusChanges.length;
 history.currentStatus=child.currentStatus='[HF] Реализация';
 const data=buildJiraDataset(input,at(30));
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({dataset:data})));
 const div=document.createElement('div');document.body.append(div);root=createRoot(div);await act(()=>root.render(<App/>));
 const headers=()=>[...div.querySelectorAll('.timeline-header [aria-label^="Сортировать:"]')].map(b=>b.getAttribute('aria-label'));
 const before=headers();
 await act(()=>div.querySelector<HTMLButtonElement>('button[aria-label="Раскрыть A-1"]')!.click());
 await act(()=>div.querySelector<HTMLButtonElement>('button[aria-label="Раскрыть A-2"]')!.click());
 expect(headers()).toEqual(before);
 for(const name of alternatives){
  expect(div.querySelector(`[aria-label="Сортировать: ${name}"]`)).toBeNull();
  expect(div.querySelector('.legends')?.textContent).not.toContain(name);
  expect(div.querySelector('select[aria-label="Сортировка"]')?.textContent).not.toContain(name);
 }
 expect(div.querySelectorAll('.related-row .related-segment').length).toBeGreaterThan(5);
 expect(div.querySelectorAll('.related-row .sprint-segment')).toHaveLength(2);
 expect(div.querySelector('.related-row [data-metric]')).toBeNull();
});
it('AC-102/114/138: only source observations add alternatives; filtering and expansion keep columns and source values',async()=>{
 const data=buildJiraDataset(sprintDatasetInputs(),at(30));
 data.epics=[epic('A-1',[...alternatives.map(s=>[s,1] as [string,number]),['Реализация',10]]),epic('A-99',[['Реализация',3]])];
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({dataset:data})));
 const div=document.createElement('div');document.body.append(div);root=createRoot(div);await act(()=>root.render(<App/>));
 const headers=()=>[...div.querySelectorAll('.timeline-header [aria-label^="Сортировать:"]')].map(b=>b.getAttribute('aria-label'));
 const expected=['Time to Market','TTM без флага','Без работы','Подготовка','Валидация','Скоринг','Реализация','Тестирование эпика','Релиз'].map(s=>`Сортировать: ${s}`);
 expect(headers()).toEqual(expected);
 const first=div.querySelector('.epic-row[data-issue-key="A-1"]')!;
 expect(first.querySelector('[data-metric="implementation"]')?.textContent).toBe('10,00');
 for(const id of ['preparation','validation','scoring','epic-testing','release'])expect(first.querySelector(`[data-metric="${id}"]`)?.textContent).toBe('1,00');
 const ttm=first.querySelector('[data-metric="ttm"]')?.textContent;
 await act(()=>div.querySelector<HTMLButtonElement>('button[aria-label="Раскрыть A-1"]')!.click());
 await act(()=>div.querySelector<HTMLButtonElement>('button[aria-label="Раскрыть A-2"]')!.click());
 expect(headers()).toEqual(expected);expect(div.querySelector('.related-row [data-metric]')).toBeNull();
 expect(div.querySelectorAll('.related-row .related-segment').length).toBeGreaterThan(0);
 expect(div.querySelectorAll('.related-row .sprint-segment')).toHaveLength(2);
 expect(first.querySelector('[data-metric="ttm"]')?.textContent).toBe(ttm);
 const input=div.querySelector<HTMLInputElement>('[aria-label="Поиск по ключу или названию"]')!;
 await act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'A-99');input.dispatchEvent(new Event('input',{bubbles:true}));});
 expect(div.querySelectorAll('.epic-row')).toHaveLength(1);expect(headers()).toEqual(expected);
 expect(div.querySelector('.epic-row [data-metric="release"]')?.textContent).toBe('0,00');
 expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});
