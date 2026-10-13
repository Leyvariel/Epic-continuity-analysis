// @vitest-environment jsdom
import {it,expect,vi,afterEach} from 'vitest';
import {act} from 'react';import {createRoot} from 'react-dom/client';
import {App} from '../src/App';import {buildJiraDataset} from '../server/jira/dataset';
import {sprintDatasetInputs} from './sprint-dataset-fixture';import {at} from './sprint-fixtures';
import {STAGES} from '../shared/statuses';
import {readFileSync} from 'node:fs';
const roots:ReturnType<typeof createRoot>[]=[];
it.each(['known','unknown'] as const)('AC-091: gap touches the status from below with %s TTM, at all scales',async mode=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const input=sprintDatasetInputs();
 if(mode==='unknown'){
  const h=input.histories['jira:1'];h.currentStatus='[HF] Проверка идей';input.hierarchy!.nodes['1'].currentStatus=h.currentStatus;
 }
 for(const t of Object.values(input.sprintInputs!.tasks))t.sprintIds=[];
 const d=buildJiraDataset(input,at(30));expect(d.epics[0].ttmMs===null).toBe(mode==='unknown');
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({dataset:d})));
 const style=document.createElement('style');style.textContent=readFileSync('src/styles.css','utf8');document.body.append(style);
 const div=document.createElement('div');document.body.append(div);const r=createRoot(div);roots.push(r);await act(()=>r.render(<App/>));
 const gap=()=>div.querySelector<HTMLButtonElement>('.epic-row .epic-sprint-gap')!;
 const status=div.querySelector<HTMLElement>(mode==='known'?'.epic-row .status-segment':'.epic-row .phase-fallback')!;
 const initialColour=status.style.backgroundColor;const originalWidth=parseFloat(gap().style.width);
 for(const [label,pixels] of [['День',26],['Неделя',8],['Месяц',3]] as const){
  await act(()=>[...div.querySelectorAll('button')].find(b=>b.textContent===label)!.click());
  const g=getComputedStyle(gap()),s=getComputedStyle(status),imp=getComputedStyle(div.querySelector('.epic-row .impediment-track')!);
  expect(parseFloat(g.top)).toBe(parseFloat(s.top)+parseFloat(s.height));
  expect(parseFloat(g.top)+parseFloat(g.height)).toBeLessThan(parseFloat(imp.top));
  expect(g.backgroundColor).not.toBe('rgb(255, 255, 255)');
  expect(status.style.backgroundColor).toBe(initialColour);
  expect(parseFloat(gap().style.width)).toBeCloseTo(originalWidth*pixels/8);
 }
 expect(div.querySelector('.legends .gap-swatch')?.parentElement?.textContent).toContain('Брешь');
 expect(div.querySelector('.sprint-notice')?.textContent).toContain('Пустой спринт сам по себе не означает брешь');
 await act(()=>gap().focus());expect(document.activeElement).toBe(gap());expect(gap().title).toContain('ни одна дочерняя задача не была включена');
 await act(()=>div.querySelector<HTMLButtonElement>('button[aria-label="Раскрыть A-1"]')!.click());expect(div.querySelector('[data-issue-key="A-2"]')).not.toBeNull();
 expect(div.querySelectorAll('.epic-row .epic-sprint-gap')).toHaveLength(1);
});
it('AC-090: unknown TTM preserves epic stage colours, unknown hatching and membership gaps',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const input=sprintDatasetInputs(),h=input.histories['jira:1'];
 const statuses=['Discovery',...STAGES.map(s=>`[HF]\u00a0${s.name}`),'[HF] Закрыт','Неизвестный статус'];
 h.currentStatus=statuses.at(-1)!;h.statusChanges=statuses.slice(1).map((to,i)=>({id:`color-${i}`,at:at(i+2),from:statuses[i],to}));
 h.historyCount=h.statusChanges.length;h.proof={expected:h.historyCount,received:h.historyCount,terminal:true,adapterVersion:'fixture'};
 input.hierarchy!.nodes['1'].currentStatus=h.currentStatus;
 for(const t of Object.values(input.sprintInputs!.tasks))t.sprintIds=[];
 const d=buildJiraDataset(input,at(30));expect(d.epics[0].ttmMs).toBeNull();
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({dataset:d})));
 const div=document.createElement('div');document.body.append(div);const r=createRoot(div);roots.push(r);await act(()=>r.render(<App/>));
 const phases=[...div.querySelectorAll<HTMLElement>('.epic-row .phase-fallback')];expect(phases).toHaveLength(statuses.length);
 for(const stage of STAGES){
  const bar=phases.find(p=>p.getAttribute('aria-label')===`[HF]\u00a0${stage.name}`)!;
  const legend=[...div.querySelectorAll<HTMLElement>('.legends i')].find(i=>i.parentElement?.textContent===`${stage.code} ${stage.name}`)!;
  expect(bar.style.backgroundColor,stage.name).toBe(legend.style.backgroundColor);
  expect(bar.classList.contains('hatch')).toBe(false);
  const metric=div.querySelector<HTMLButtonElement>(`.epic-row .metric[title^="${stage.name}:"]`)!;
  expect(metric.textContent).toBe('1,00');
 }
 expect(phases[0].classList.contains('hatch')).toBe(true);expect(phases.at(-2)!.classList.contains('hatch')).toBe(true);
 expect(phases.at(-1)!.classList.contains('hatch')).toBe(true);
 expect(div.querySelectorAll('.epic-sprint-gap.phase-gap').length).toBeGreaterThan(0);
 expect(div.querySelector('.unavailable')?.textContent).toContain('TTM неизвестны');
});
afterEach(async()=>{for(const r of roots.splice(0))await act(()=>r.unmount());document.body.innerHTML='';vi.restoreAllMocks();});
it('T008: independent three-level segments, fixed axis, scales, keyboard details and old-cache message',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
 const input=sprintDatasetInputs();input.hierarchy!.nodes['2'].historyCoverage='unavailable';
 const d=buildJiraDataset(input,at(30));const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({dataset:d})));
 const div=document.createElement('div');document.body.append(div);const r=createRoot(div);roots.push(r);await act(()=>r.render(<App/>));
 expect(div.textContent).toContain('Анализ по текущему составу подзадач');expect(div.querySelectorAll('.epic-row .sprint-segment')).toHaveLength(3);
 const axis=()=>div.querySelector<HTMLElement>('.calendar-header')!.style.width;const before=axis();
 const expand=async(key:string)=>act(()=>div.querySelector<HTMLButtonElement>(`button[aria-label="Раскрыть ${key}"]`)!.click());
 await expand('A-1');await expand('A-2');expect(axis()).toBe(before);
 expect(div.querySelectorAll('[data-issue-key="A-2"] .sprint-segment')).toHaveLength(3);expect(div.querySelectorAll('[data-issue-key="A-3"] .sprint-segment')).toHaveLength(3);
 expect(div.querySelector('[data-issue-key="A-2"] .related-diagnostic')).not.toBeNull();
 const segment=()=>div.querySelector<HTMLButtonElement>('[data-issue-key="A-3"] .sprint-segment')!;
 const width=parseFloat(segment().style.width);
 for(const [label,pixels] of [['День',26],['Месяц',3],['Неделя',8]] as const){await act(()=>[...div.querySelectorAll('button')].find(b=>b.textContent===label)!.click());expect(parseFloat(segment().style.width)).toBeCloseTo(width*pixels/8);}
 await act(()=>segment().focus());expect(div.querySelector('.sprint-details')?.textContent).toContain('A-3');
 expect(segment().getAttribute('aria-label')).toContain('Работа подтверждена');
 await act(()=>div.querySelector<HTMLButtonElement>('button[aria-label="Свернуть A-1"]')!.click());expect(axis()).toBe(before);expect(fetch).toHaveBeenCalledTimes(1);
});
it('T008: old Jira cache explicitly has no sprints and does not fetch them',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const i=sprintDatasetInputs();delete i.sprintInputs;
 const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({dataset:buildJiraDataset(i,at(30))})));
 const div=document.createElement('div');document.body.append(div);const r=createRoot(div);roots.push(r);await act(()=>r.render(<App/>));
 expect(div.textContent).toContain('Спринты не загружены');expect(fetch).toHaveBeenCalledTimes(1);
});
it('B06/B33: unknown numeric TTM keeps raw phases and sprint axis; overlapping equal names have separate lanes',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const input=sprintDatasetInputs(),h=input.hierarchy!.nodes['1'].history!;
 h.currentStatus='[HF] Проверка идей';input.histories['jira:1'].currentStatus=h.currentStatus;input.hierarchy!.nodes['1'].currentStatus=h.currentStatus;
 input.sprintInputs!.sprints['12']={...input.sprintInputs!.sprints['12'],name:'S11',startDate:at(4),completeDate:at(12)};
 const d=buildJiraDataset(input,at(30));expect(d.epics[0].ttmMs).toBeNull();expect(d.epics[0].ttmState).toBe('indeterminate');
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({dataset:d})));const div=document.createElement('div');document.body.append(div);const r=createRoot(div);roots.push(r);await act(()=>r.render(<App/>));
 expect(div.querySelectorAll('.epic-row .sprint-segment')).toHaveLength(3);const buttons=[...div.querySelectorAll<HTMLElement>('.epic-row .sprint-segment')];expect(buttons[0].style.top).not.toBe(buttons[1].style.top);expect(buttons[0].getAttribute('aria-label')).toContain('Sprint 11');expect(buttons[1].getAttribute('aria-label')).toContain('Sprint 12');expect(div.querySelector('.calendar-placeholder')).toBeNull();
});
it('only proven non-membership has a gap marker; unknown and active negatives have no marker',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const input=sprintDatasetInputs();for(const t of Object.values(input.sprintInputs!.tasks))t.sprintIds=[];
 input.sprintInputs!.sprints['13']={...input.sprintInputs!.sprints['13'],state:'active',completeDate:null};
 const d=buildJiraDataset(input,at(30));const savedEpics=buildJiraDataset({...input,sprintInputs:undefined},at(30)).epics;
 const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({dataset:d})));const div=document.createElement('div');document.body.append(div);const r=createRoot(div);roots.push(r);await act(()=>r.render(<App/>));
 const overlay=()=>div.querySelectorAll<HTMLElement>('.epic-row .calendar-body .epic-sprint-gap');expect(overlay()).toHaveLength(1);expect(overlay()[0].getAttribute('aria-label')).toContain('ни одна дочерняя задача не была включена');
 expect(div.querySelectorAll('.epic-row .calendar-body .sprint-unknown, .epic-row .calendar-body .sprint-preliminary, .epic-row .sprint-mark')).toHaveLength(0);
 const originalWidth=parseFloat(overlay()[0].style.width);for(const [label,pixels] of [['День',26],['Месяц',3],['Неделя',8]] as const){await act(()=>[...div.querySelectorAll('button')].find(b=>b.textContent===label)!.click());expect(parseFloat(overlay()[0].style.width)).toBeCloseTo(originalWidth*pixels/8);}
 expect(d.epics).toEqual(savedEpics);expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(['unknown-membership','included-idle'] as const)('05.10: %s has no gap or unknown overlay and preserves child status/sprint rows',async mode=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const input=sprintDatasetInputs();
 for(const t of Object.values(input.sprintInputs!.tasks)){t.sprintIds=mode==='included-idle'?['13']:[];if(mode==='unknown-membership')t.membershipCoverage='unavailable';}
 const d=buildJiraDataset(input,at(30));
 if(mode==='included-idle')expect(d.sprintAnalysis!.rows['1'].segments.find(s=>s.sprintId==='13')!.state).toBe('empty');
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({dataset:d})));
 const div=document.createElement('div');document.body.append(div);const r=createRoot(div);roots.push(r);await act(()=>r.render(<App/>));
 const gaps=[...div.querySelectorAll<HTMLElement>('.epic-sprint-gap')];
 expect(gaps).toHaveLength(mode==='unknown-membership'?0:1);
 if(mode==='included-idle')expect(gaps[0].title).not.toContain('22.09');
 expect(div.querySelectorAll('.calendar-body .sprint-unknown, .calendar-body .sprint-preliminary, .sprint-mark')).toHaveLength(0);
 for(const key of ['A-1','A-2'])await act(()=>div.querySelector<HTMLButtonElement>(`button[aria-label="Раскрыть ${key}"]`)!.click());
 const child=div.querySelector('[data-issue-key="A-3"]')!;expect(child.textContent).toContain('A-3');expect(child.querySelectorAll('.related-segment').length).toBeGreaterThan(0);expect(child.querySelectorAll('.sprint-segment')).toHaveLength(mode==='included-idle'?1:3);
});

it('AC-088/089: task display hides outer/boundary empty sprints, keeps whole participation and inner empties at every scale',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
 const {visibilityFixture}=await import('./sprint-visibility-fixture');const f=visibilityFixture(),input=sprintDatasetInputs();input.hierarchy=f.graph;input.sprintInputs=f.input;
 const d=buildJiraDataset(input,at(30));vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({dataset:d})));
 const div=document.createElement('div');document.body.append(div);const r=createRoot(div);roots.push(r);await act(()=>r.render(<App/>));
 const click=(label:string)=>act(()=>div.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click());
 await click('Раскрыть A-1');await click('Раскрыть A-2');
 const shown=()=>[...div.querySelectorAll<HTMLButtonElement>('[data-issue-key="A-3"] .sprint-segment')];
 expect(shown().map(s=>s.textContent?.trim())).toEqual(['✓ S11','○ S12','✓ S17']);
 // S12 is empty only when there is no membership: the fixture's parent is working but not assigned to it.
 expect(shown()[1].title).toContain('Нет работы в закрытом спринте');
 expect(div.querySelectorAll('[data-issue-key="A-2"] .sprint-segment')).toHaveLength(7);
 for(const [label,pixels] of [['День',26],['Месяц',3],['Неделя',8]] as const){await act(()=>[...div.querySelectorAll('button')].find(b=>b.textContent===label)!.click());expect(shown()).toHaveLength(3);expect(parseFloat(shown()[2].style.width)).toBe(7*pixels);}
 await act(()=>shown()[1].focus());expect(div.querySelector('.sprint-details')!.textContent).toContain('S12');
 await click('Свернуть A-1');await click('Раскрыть A-1');await click('Раскрыть A-2');expect(shown()).toHaveLength(3);
});
