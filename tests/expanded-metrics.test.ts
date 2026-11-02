import { describe, expect, it } from 'vitest';
import { calculateTimeline, unavailableTimeline } from '../server/timeline';
import { metricsFor, metricValue } from '../shared/metrics';
import { compositionFor } from '../shared/composition';
import { displayIntervals } from '../shared/display';
import { heatFor } from '../shared/heatmap';
import { STAGES, DAY_MS } from '../shared/statuses';
import { modelHistory, modelAt } from './status-model-fixtures';

const epic = (steps: [string, number][]) => { const f=modelHistory(steps,{key:'HOTELS-1'}); return calculateTimeline(f.summary,f.history,f.asOf); };
describe('FR-045/046/048: observed columns and separate TTM metrics', () => {
  it('orders the full observed catalogue, including returns, without sorting calendar transitions', () => {
    const order=['preparation','idea-check','validation','decided','deferred','scoring','planned','solution','ready','implementation','epic-testing','release','experiment','evaluation'];
    const r=epic([['Открыто',1],...STAGES.slice().reverse().map(s=>[s.name,1] as [string,number]),['Открыто',1]]);
    expect(metricsFor([r],'history').map(c=>c.id)).toEqual(['ttm','ttmWithoutFlag','open',...order]);
    expect(r.intervals[0].status).toBe('Оценка результата');
  });
  it('hides all absent stages and initial Open; retains zero-length observations', () => {
    const r=epic([['Открыто',10],['[HF] Реализация',2],['Релиз',0]]);
    expect(metricsFor([r],'history').map(c=>c.id)).toEqual(['ttm','ttmWithoutFlag','implementation','release']);
    expect(metricValue(r,'release','history')).toBe(0);
    expect(metricsFor([epic([['Открыто',10]])],'history').some(c=>c.id==='open')).toBe(false);
  });
  it('keeps observed names in partial data without inventing durations or future states', () => {
    const r=unavailableTimeline(modelHistory([['Открыто',1]]).summary,modelAt(3),[]);
    r.transitions=[{id:'1',at:modelAt(1),from:'Открыто',to:'Релиз'},{id:'2',at:modelAt(5),from:'Релиз',to:'Тестирование эпика'}];
    expect(metricsFor([r],'history').map(c=>c.id)).toEqual(['ttm','ttmWithoutFlag','release']);
    expect(metricValue(r,'release','history')).toBeNull();
  });
  it('keeps the two calculated values distinct and never mixes history into aggregate values', () => {
    const f=modelHistory([['[HF] Запланировано',10],['[HF] Проработка решения',5]],{currentFlag:false,flagChanges:[{id:'f',at:modelAt(10),from:true,to:false}]});
    const r=calculateTimeline(f.summary,f.history,f.asOf);
    expect(metricValue(r,'ttm','history')).toBe(15*DAY_MS);
    expect(metricValue(r,'ttmWithoutFlag','history')).toBe(5*DAY_MS);
    expect(metricValue(r,'ttmWithoutFlag','excel')).toBeNull();
  });
  it('orders known aggregates and retains unknown names, but suppresses empty template columns', () => {
    const r=epic([['Открыто',1]]);
    r.summary.excelAggregates={'[HF] Time To Market':75,'Cycle Time [HF] Релиз':2,'Cycle Time [HF] Эксперимент':0,'Cycle Time [HF] Отложено':60,'Cycle Time [HF] Особый этап':3,'Cycle Time [HF] Открыто':100};
    const cols=metricsFor([r],'excel');
    expect(cols.map(c=>c.name)).toEqual(['Time to Market','TTM без флага','Отложено','Релиз','Особый этап']);
    expect(compositionFor(r,cols)).toMatchObject({ttmMs:75*DAY_MS,totalMs:65*DAY_MS});
    expect(compositionFor(r,cols).missing).toEqual([]);
  });
  it('marks Deferred inside the calendar as excluded, not pre-TTM', () => {
    const r=epic([['[HF] Реализация',5],['[HF] Отложено',60],['Релиз',10]]);
    expect(displayIntervals(r).find(s=>s.kind==='deferred')?.role).toBe('excluded');
    expect(displayIntervals(r).reduce((sum,s)=>sum+s.durationMs,0)).toBe(75*DAY_MS);
  });
  it('adds no heat thresholds for new statuses or the flagless metric', () => {
    for(const id of ['idea-check','decided','deferred','planned','epic-testing','release','ttmWithoutFlag'] as const) expect(heatFor(id,1000)).toBe('none');
    expect(heatFor('ttm',100)).toBe('red'); expect(heatFor('scoring',30)).toBe('none');
  });
});
