import {expect,it} from 'vitest';
import {calculateJiraTimeline} from '../server/jira/normalize';
import {calculateTimeline} from '../server/timeline';
import {jiraHistory} from './jira-fixtures';
import {summary} from './fixtures';
import {at} from './sprint-fixtures';
import {DAY_MS} from '../shared/statuses';
import {metricValue} from '../shared/metrics';
const fixture=()=>jiraHistory({historyStart:at(1),currentStatus:'[HF] Закрыт',statusChanges:[
 {id:'1',at:at(3),from:'Discovery',to:'[HF] Валидация'},
 {id:'2',at:at(5),from:'[HF] Валидация',to:'[HF] Реализация'},
 {id:'3',at:at(8),from:'[HF] Реализация',to:'[HF] Валидация'},
 {id:'4',at:at(10),from:'[HF] Валидация',to:'[HF] Закрыт'},
],proof:{expected:4,received:4,terminal:true,adapterVersion:'test'}});
it('AC-092: repeated stages retain proven totals independently of ambiguous TTM, including restored input',()=>{
 const h=fixture(),r=calculateJiraTimeline(summary,h,at(20));
 expect(r.durations?.validation).toBe(4*DAY_MS);expect(r.durations?.implementation).toBe(3*DAY_MS);expect(r.durations?.preparation).toBe(0);
 expect(metricValue(r,'validation','history')).toBe(4*DAY_MS);
 expect(r.ttmMs).toBeNull();expect(r.returnToOpenMs).toBeNull();expect(r.impedimentMs).toBeNull();expect(r.quality).toBe('partial');
 expect(r.warnings.some(w=>w.code==='AMBIGUOUS_TTM_START')).toBe(true);
 expect(calculateJiraTimeline(summary,JSON.parse(JSON.stringify(h)),at(20))).toEqual(r);
 expect(calculateTimeline(summary,h,at(20)).durations).toBeNull();
});
it('AC-092: counts only observed time at the cutoff',()=>{
 const r=calculateJiraTimeline(summary,fixture(),at(6));
 expect(r.durations?.validation).toBe(2*DAY_MS);expect(r.durations?.implementation).toBe(DAY_MS);expect(r.ttmMs).toBeNull();
});
it.each(['partial','initial','later-break','mismatch'] as const)('AC-092: %s evidence does not invent stage numbers',mode=>{
 const h=fixture();if(mode==='partial')h.statusCoverage='partial';if(mode==='initial')h.initialStateProven=false;
 if(mode==='later-break')h.statusChanges[3].from='Unrelated';if(mode==='mismatch')h.currentStatus='Unrelated';
 expect(calculateJiraTimeline(summary,h,at(6)).durations).toBeNull();
});
