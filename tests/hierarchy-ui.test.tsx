// @vitest-environment jsdom
import { afterEach,describe,it,expect,vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../src/App';
import { buildDataset } from '../server/dataset';
import { parseWorkbook } from '../server/import';
import { linkedWorkbook } from './linked-workbook';
import { CUT } from './hierarchy-fixtures';
import { linkedJiraDataset } from './linked-jira-dataset';
const mounted:{unmount:()=>void}[]=[];afterEach(async()=>{for(const r of mounted.splice(0))await act(()=>r.unmount());document.body.innerHTML='';vi.restoreAllMocks();});
describe('T007/T008: раскрытие на календаре',()=>{
 it('AC-035: общий ребёнок и выбранный вложенный эпик имеют независимые ветки',async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const div=document.createElement('div');document.body.append(div);const r=createRoot(div);mounted.push(r);
  const dataset=buildDataset(parseWorkbook(linkedWorkbook(),'offline.xlsx',CUT),CUT),g=dataset.hierarchy!;
  dataset.epics.push({...dataset.epics[0],summary:{...dataset.epics[0].summary,key:'B-1',title:'Второй выбранный эпик'}});g.roots['B-1']='B-1';g.edges.push({parent:'A-1',child:'C-1'});
  vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({dataset}),{headers:{'content-type':'application/json'}}));await act(()=>r.render(<App/>));
  const buttons=(key:string)=>[...div.querySelectorAll<HTMLButtonElement>(`button[aria-label="Раскрыть ${key}"]`)];
  await act(()=>buttons('A-1')[0].click());await act(()=>buttons('B-1').at(-1)!.click());
  expect(div.querySelectorAll('.related-row[data-issue-key="C-1"]')).toHaveLength(2);
  expect(div.querySelectorAll('.epic-row')).toHaveLength(2);
  await act(()=>buttons('B-1')[0].click());expect(div.querySelectorAll('.related-row[data-issue-key="C-1"]')).toHaveLength(3);
  await act(()=>div.querySelector<HTMLButtonElement>('button[aria-label="Свернуть A-1"]')!.click());
  expect(div.querySelectorAll('.related-row[data-issue-key="C-1"]')).toHaveLength(1);
 });
 it.each(['xlsx','jira'])('%s: сначала свёрнуто; раскрывает по уровню без чисел и сохраняет ось при 3 масштабах',async source=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const div=document.createElement('div');document.body.append(div);const r=createRoot(div);mounted.push(r);
  const dataset=source==='jira'?await linkedJiraDataset():buildDataset(parseWorkbook(linkedWorkbook(),'offline.xlsx',CUT),CUT);
  vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({dataset}),{headers:{'content-type':'application/json'}}));
  await act(()=>r.render(<App/>));
  const button=(key:string)=>div.querySelector<HTMLButtonElement>(`button[aria-label="Раскрыть ${key}"]`)!;
  expect(div.querySelectorAll('.related-row')).toHaveLength(0);expect(button('A-1')).not.toBeNull();
  await act(()=>button('A-1').click());expect(div.querySelectorAll('.related-row')).toHaveLength(1);expect(div.textContent).toContain('B-1');
  await act(()=>button('B-1').click());expect(div.querySelectorAll('.related-row')).toHaveLength(2);expect(div.textContent).toContain('C-1');expect(div.textContent).not.toContain('S-1');
  expect(div.querySelector('.related-row .metric')).toBeNull();expect(div.querySelector('.related-row .flag-caption')).toBeNull();
  expect(div.querySelectorAll('.related-segment').length).toBeGreaterThan(0);expect(div.querySelector('[role=dialog]')).toBeNull();
  const initialWidth=parseFloat(div.querySelector<HTMLElement>('.related-segment')!.style.width);
  for(const [label,pixels] of [['День',26],['Месяц',3],['Неделя',8]] as const){
   await act(()=>[...div.querySelectorAll('button')].find(b=>b.textContent===label)!.click());
   expect(parseFloat(div.querySelector<HTMLElement>('.related-segment')!.style.width)).toBeCloseTo(initialWidth*pixels/8);
   expect(div.querySelectorAll('.related-row')).toHaveLength(2);
  }
  const axisWidth=div.querySelector<HTMLElement>('.calendar-header')!.style.width;
  await act(()=>div.querySelector<HTMLButtonElement>('button[aria-label="Свернуть A-1"]')!.click());expect(div.querySelectorAll('.related-row')).toHaveLength(0);
  expect(div.querySelector<HTMLElement>('.calendar-header')!.style.width).toBe(axisWidth);
  await act(()=>button('A-1').click());expect(div.querySelectorAll('.related-row')).toHaveLength(1);
 });
});

it('AC-039: порция 200/201 не теряет последнюю строку', async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const div=document.createElement('div');document.body.append(div);const r=createRoot(div);mounted.push(r);
 const d=buildDataset(parseWorkbook(linkedWorkbook(),'offline.xlsx',CUT),CUT),g=d.hierarchy!;g.edges=[];const sample=g.nodes['C-1'];
 for(let i=1;i<=201;i++){const id=`PAGE-${i}`;g.nodes[id]={...sample,id,key:id,title:id};g.edges.push({parent:'A-1',child:id});}
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({dataset:d}),{headers:{'content-type':'application/json'}}));await act(()=>r.render(<App/>));await act(()=>div.querySelector<HTMLButtonElement>('button[aria-label="Раскрыть A-1"]')!.click());expect(div.querySelectorAll('.related-row')).toHaveLength(200);
 const more=[...div.querySelectorAll('button')].find(b=>b.textContent==='Показать ещё')!;expect(more).toBeDefined();await act(()=>more.click());expect(div.querySelectorAll('.related-row')).toHaveLength(201);expect(new Set([...div.querySelectorAll('.related-row')].map(row=>row.getAttribute('data-issue-key'))).size).toBe(201);
});
