import {describe,it,expect,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {DatasetService} from '../server/service';import {CacheStore} from '../server/cache';import {AppError} from '../server/errors';
import {parseWorkbook} from '../server/import';import {buildDataset} from '../server/dataset';import {relatedTimeline,buildHierarchy} from '../server/related-timeline';
import {childrenOf,eligibleHierarchyIds} from '../shared/hierarchy-view';import {calendarRange} from '../shared/calendar';
import {hierarchySchema} from '../server/hierarchy-schema';import {linkedWorkbook} from './linked-workbook';import {node,history,graph,CUT,at} from './hierarchy-fixtures';import {jiraIssue,jiraHistory} from './jira-fixtures';
describe('T010: сквозная приёмка и отрицательные сценарии',()=>{
 it('AC-042: будущее создание не превращает корректный набор в частичный',()=>{const g=graph();g.edges=[{parent:'A-1',child:'C-1'}];g.nodes={'A-1':{...node('A-1'),history:{...history('A-1'),currentStatus:'[HF] Реализация',statusChanges:[]}},'C-1':{...node('C-1','task'),created:at(11),historyCoverage:'unavailable'}};const d=buildHierarchy(g)!;expect(d.nodes['C-1'].timeline.state).toBe('not-present');expect(d.coverage).toBe('complete');});
 it('AC-032/036: исключённые даты не растягивают ось, допустимый потомок растягивает',()=>{const g=graph();g.nodes['R-1'].resolution='Отклонено';g.nodes['R-1'].created='2020-01-01T00:00:00Z';const allowed=eligibleHierarchyIds(g);expect(allowed.has('S-1')).toBe(false);expect(allowed.has('R-1')).toBe(false);expect(allowed.has('V-1')).toBe(true);const d=buildDataset(parseWorkbook(linkedWorkbook(),'offline.xlsx',CUT),CUT);const r=calendarRange(d.epics,CUT,[{start:'2026-08-25T00:00:00+03:00',end:CUT}]);expect(r.start).toBe(Date.parse('2026-08-24T00:00:00+03:00'));});
 it('AC-040/041/043: категория на срезе, промежуточное закрытие и неизвестное имя',()=>{
  const h=history('C-1',true);h.statusChanges.push({id:'4',at:at(11),from:'В работе',to:'Готово',fromId:'work',toId:'done'});h.currentStatus='Готово';h.currentStatusId='done';h.statusChanges[2].toId='work';
  const t=relatedTimeline({...node('C-1','task'),history:h,statusCategories:{done:'done',work:'indeterminate'}},CUT);expect(t.closed).toBe(false);expect(t.end).toBe(new Date(CUT).toISOString());expect(t.intervals[2].durationMs).toBe(86400000);
  for(const name of ['Не закрыто','Готово к тестированию','Архив команды']){const historyValue={...history(),currentStatus:name};historyValue.statusChanges[1].to=name;expect(relatedTimeline({...node('C-1','task'),history:historyValue},CUT).state).toBe('unavailable');}
 });
 it('AC-046: кэш не принимает Jira-историю без доказательства',()=>{const g=graph();g.nodes['C-1'].history={...history(),source:'jira'} as never;expect(hierarchySchema.safeParse(g).success).toBe(false);});
 it('AC-037: пустой и неизвестный состав различаются',()=>{const g=graph();g.edges=[];expect(childrenOf(g,'A-1').children).toHaveLength(0);g.nodes['A-1'].branchCoverage='unavailable';expect(g.nodes['A-1'].branchCoverage).not.toBe('complete');});
 it('AC-044/046: импорт книги, публикация, перезапуск не читают credentials',async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),'hierarchy-flow-'));try{const factory=vi.fn(async()=>{throw new Error('Сеть запрещена');});const service=new DatasetService(new CacheStore(dir),()=>CUT,factory);const j=service.import(linkedWorkbook(),'offline.xlsx');await service.waitForIdle();expect(j.status).toBe('completed');expect(service.getDataset()?.hierarchy?.nodes['C-1'].timeline.end).toBe(new Date(at(7)).toISOString());const restart=new DatasetService(new CacheStore(dir),()=>at(20),factory);await restart.initialize();expect(restart.getDataset()).toEqual(service.getDataset());expect(factory).not.toHaveBeenCalled();}finally{await rm(dir,{recursive:true,force:true});}});
 it('AC-038/047: неудачная запись и глобальный отказ не заменяют прежний граф',async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),'hierarchy-atomic-'));try{const store=new CacheStore(dir);const factory=vi.fn(async()=>{throw new AppError('JIRA_UNAUTHORIZED','Нет авторизации',401);});const s=new DatasetService(store,()=>CUT,factory);s.import(linkedWorkbook(),'ok.xlsx');await s.waitForIdle();const old=s.getDataset();vi.spyOn(store,'write').mockRejectedValueOnce(new AppError('CACHE_WRITE','Сбой записи',500));const second=s.import(linkedWorkbook(true),'bad.xlsx');await s.waitForIdle();expect(second.status).toBe('failed');expect(s.getDataset()).toBe(old);const third=s.importEpic('https://hq.tutu.ru/browse/A-1');await s.waitForIdle();expect(third.status).toBe('failed');expect(s.getDataset()).toBe(old);}finally{await rm(dir,{recursive:true,force:true});}});
 it('AC-047: refresh добавляет/удаляет связь и сохраняет общий Jira-ID при смене ключа',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'hierarchy-refresh-'));
  try{
   let phase=0;
   const gateway={
    getIssue:vi.fn(async(id:string)=>id==='1'||id==='A-1'
     ?jiraIssue({id:'1',key:'A-1',created:at(1),updated:CUT,currentStatus:'[HF] Реализация',links:[{parent:'1',child:'2',childKey:phase?'C-2':'C-1'},{parent:'1',child:phase?'4':'3',childKey:phase?'E-1':'D-1'}]})
     :jiraIssue({id,key:id==='2'?(phase?'C-2':'C-1'):id==='3'?'D-1':'E-1',isEpic:false,isSubtask:false,created:at(1),updated:CUT,currentStatus:'Готово',links:[]})),
    getHistory:vi.fn(async(issue:ReturnType<typeof jiraIssue>)=>jiraHistory({...history(issue.key),updated:CUT,...(issue.id==='1'?{currentStatus:'[HF] Реализация',statusChanges:[]}: {})})),readBoard:vi.fn()
   };
   const s=new DatasetService(new CacheStore(dir),()=>CUT,async()=>gateway);
   s.importEpic('https://hq.tutu.ru/browse/A-1');await s.waitForIdle();
   expect(s.getDataset()?.hierarchy?.nodes['2'].key).toBe('C-1');
   expect(s.getDataset()?.hierarchy?.edges).toEqual([{parent:'1',child:'2'},{parent:'1',child:'3'}]);
   phase=1;s.refresh(s.getDataset()!.id);await s.waitForIdle();
   const g=s.getDataset()!.hierarchy!;
   expect(g.edges).toEqual([{parent:'1',child:'2'},{parent:'1',child:'4'}]);
   expect(g.nodes['3']).toBeUndefined();expect(g.nodes['2'].key).toBe('C-2');
   expect(Object.values(g.nodes).filter(n=>n.key==='C-1')).toHaveLength(0);
  }finally{await rm(dir,{recursive:true,force:true});}
 });
});
