// @vitest-environment jsdom
import {it,expect,vi,afterEach} from 'vitest';
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {App} from '../src/App';
import {SprintRows,sprintBounds} from '../src/SprintRows';
import {buildJiraDataset} from '../server/jira/dataset';
import {sprintDatasetInputs} from './sprint-dataset-fixture';
import {at} from './sprint-fixtures';
import {DAY_MS} from '../shared/statuses';
import {calendarRange} from '../shared/calendar';
const roots:Root[]=[];
async function render(dataset:ReturnType<typeof buildJiraDataset>){
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({dataset})));
 const div=document.createElement('div');document.body.append(div);const r=createRoot(div);roots.push(r);await act(()=>r.render(<App/>));return div;
}
afterEach(async()=>{for(const r of roots.splice(0))await act(()=>r.unmount());document.body.innerHTML='';vi.restoreAllMocks();});
it('AC-135/136: renders neutral number and explanation distinct from old membership gaps',async()=>{
 const d=buildJiraDataset(sprintDatasetInputs(),at(30)),div=await render(d);
 const cell=div.querySelector<HTMLButtonElement>('.epic-row [data-metric="sprintFocus"]');expect(cell).not.toBeNull();expect(cell!.textContent).toBe('14,00');expect(cell!.classList.contains('heat-none')).toBe(true);
 expect(div.querySelector('.epic-sprint-gap')).toBeNull();expect(div.querySelectorAll('.epic-row .sprint-segment')).toHaveLength(1);
 expect(div.querySelector('.legends')?.textContent).not.toContain('Без работы');
 await act(()=>cell!.click());expect(div.querySelector('.sprint-focus-details')?.textContent).toContain('Включение задачи без работы устраняет прежнюю тёмную отметку');
 expect(div.querySelector('.sprint-focus-details')?.textContent).toContain('14,00');
 await act(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(div.querySelector('[role="dialog"]')).toBeNull();
});
it('AC-135: sorting uses the same value, unknown last in both directions, zero stays zero',async()=>{
 const d=buildJiraDataset(sprintDatasetInputs(),at(30)),base=d.epics[0],row=d.sprintAnalysis!.rows['1'];
 d.epics=[0,5,7,null].map((n,i)=>{const key=`A-${i+10}`,id=`f${i}`;d.hierarchy!.roots[key]=id;d.hierarchy!.nodes[id]={...d.hierarchy!.nodes['1'],id,key};d.sprintAnalysis!.rows[id]={...row,issueId:id,focus:{...row.focus!,state:n===null?'unknown':n===7?'preliminary':'known',totalMs:n===null?null:n*DAY_MS,preliminaryMs:n===7?7*DAY_MS:0}};return {...base,summary:{...base.summary,key},metadata:{...base.metadata!,title:`Fixture ${i}`}};});
 const div=await render(d),sort=div.querySelector<HTMLSelectElement>('select[aria-label="Сортировка"]')!;
 expect([...sort.options].map(o=>o.value)).toContain('sprintFocus');
 await act(()=>{sort.value='sprintFocus';sort.dispatchEvent(new Event('change',{bubbles:true}));});
 const keys=()=>[...div.querySelectorAll('.epic-row .epic-title strong')].map(el=>el.textContent);
 expect(keys()).toEqual(['A-12','A-11','A-10','A-13']);expect(div.querySelector('.metric-preliminary')?.textContent).toContain('предв.');
 const heading=[...div.querySelectorAll<HTMLButtonElement>('.timeline-header button')].find(b=>b.textContent?.includes('Без работы'));
 expect(heading).toBeDefined();await act(()=>heading!.click());expect(keys()).toEqual(['A-10','A-11','A-12','A-13']);
});
it('AC-137: children have no numeric cells; Excel excludes the metric and resets its sorting',async()=>{
 const input=sprintDatasetInputs();input.epics[0].excelAggregates={'TTM':42,'Cycle Time [HF] Реализация':11};const d=buildJiraDataset(input,at(30)),div=await render(d);
 await act(()=>div.querySelector<HTMLButtonElement>('button[aria-label="Раскрыть A-1"]')!.click());expect(div.querySelector('.related-row [data-metric]')).toBeNull();
 await act(()=>div.querySelector<HTMLButtonElement>('button[aria-label="Раскрыть A-2"]')!.click());
 expect(div.querySelectorAll('.related-row .sprint-segment')).toHaveLength(2);
 expect(div.querySelector('.related-row .metric')).toBeNull();
 const sort=div.querySelector<HTMLSelectElement>('select[aria-label="Сортировка"]')!;await act(()=>{sort.value='sprintFocus';sort.dispatchEvent(new Event('change',{bubbles:true}));});
 const source=div.querySelector<HTMLSelectElement>('select[aria-label="Источник длительностей"]')!;await act(()=>{source.value='excel';source.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(sort.value).toBe('ttm');expect(div.querySelector('[data-metric="sprintFocus"]')).toBeNull();expect(div.querySelector('.epic-row [data-metric="ttm"]')?.textContent).toBe('42,00');
});
it('AC-134: missing sprint inputs produce an explicit unavailable value without a fetch',async()=>{
 const input=sprintDatasetInputs();delete input.sprintInputs;const d=buildJiraDataset(input,at(30)),div=await render(d);
 const cell=div.querySelector('[data-metric="sprintFocus"]');expect(cell?.textContent).toBe('—');expect(cell?.getAttribute('title')).toContain('Спринты не загружены');expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});
it('AC-088/089: all hidden segments leave diagnostics and analytical bounds, no buttons or lanes',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const input=sprintDatasetInputs();input.sprintInputs!.tasks['3'].membershipCoverage='partial';const d=buildJiraDataset(input,at(30));
 const before=sprintBounds(d.sprintAnalysis),row=d.sprintAnalysis!.rows['1'];const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
 await act(()=>root.render(<SprintRows row={row} range={calendarRange(d.epics,at(30),before)} pixels={8} width={500}/>));
 expect(div.querySelectorAll('.sprint-segment')).toHaveLength(0);expect(div.textContent).toContain('Нет спринтов с подтверждённой работой');expect(div.querySelector('.sprint-warnings')).not.toBeNull();expect(sprintBounds(d.sprintAnalysis)).toEqual(before);
});
