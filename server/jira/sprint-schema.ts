import { z } from 'zod';
import type { SprintInputs } from '../../shared/sprints';
import { SPRINT_LIMITS } from '../../shared/sprints';
import type { HierarchyInput } from '../../shared/hierarchy';
const id=z.string().regex(/^\d+$/), time=z.string().regex(/T.*(?:Z|[+-]\d{2}:?\d{2})$/).refine(v=>Number.isFinite(Date.parse(v)));
const ids=z.array(id).refine(v=>new Set(v).size===v.length,'Повтор ID');
const coverage=z.enum(['complete','partial','unavailable']);
const sprint=z.strictObject({id,name:z.string(),state:z.enum(['future','active','closed','unknown']),startDate:time.nullable(),endDate:time.nullable(),completeDate:time.nullable(),activatedDate:time.nullable(),originBoardId:id.nullable()});
const task=z.strictObject({issueId:id,observedAt:time,sprintIds:ids,changes:z.array(z.strictObject({id:z.string(),at:time,fromIds:ids,toIds:ids})),membershipCoverage:coverage,rosterCoverage:coverage,subtaskIds:ids,uncertainSubtaskIds:ids,calendarIds:ids,calendarCoverage:coverage,warnings:z.array(z.string())});
export const sprintInputsSchema: z.ZodType<SprintInputs> = z.strictObject({diagnostics:z.strictObject({primaryNodes:z.number().int().nonnegative().max(10000),addedSubtasks:z.number().int().nonnegative().max(10000),unreadSubtasks:z.number().int().nonnegative(),limits:z.array(z.string())}).optional(),version:z.literal(1),asOf:time,mode:z.literal('current-subtasks'),tasks:z.record(id,task),sprints:z.record(id,sprint),calendars:z.record(id,z.strictObject({boardId:id,sprintIds:ids,coverage,warnings:z.array(z.string())})),warnings:z.array(z.string())}).superRefine((v,c)=>{
 const bad=(message:string)=>c.addIssue({code:'custom',message});
 if(Object.keys(v.sprints).length>SPRINT_LIMITS.sprints || Object.keys(v.calendars).length>SPRINT_LIMITS.boards)bad('Превышены пределы спринтов');
 let links=0;
 for(const [key,t] of Object.entries(v.tasks)){
  links+=t.subtaskIds.length;
  if(key!==t.issueId || Date.parse(t.observedAt)<Date.parse(v.asOf))bad('Идентичность или срез задачи');
  if(t.uncertainSubtaskIds.some(i=>!t.subtaskIds.includes(i)))bad('Неизвестная ссылка подзадачи');
  if(t.calendarIds.some(i=>!v.calendars[i]))bad('Нет календаря');
  if(new Set(t.changes.map(x=>x.id)).size!==t.changes.length)bad('Повтор события Sprint');
 }
 if(links>SPRINT_LIMITS.relations)bad('Превышен предел отношений');
 for(const [key,s] of Object.entries(v.sprints))if(key!==s.id)bad('Идентичность спринта');
 for(const [key,b] of Object.entries(v.calendars))if(key!==b.boardId || b.sprintIds.some(i=>!v.sprints[i]))bad('Идентичность или состав календаря');
});
export function sprintLinkErrors(input:SprintInputs,graph:HierarchyInput|undefined):string[]{
 if(!graph)return ['Нет основного графа для спринтов'];
 const errors:string[]=[];
 if(Date.parse(graph.asOf)!==Date.parse(input.asOf))errors.push('Срезы спринтов и графа различаются');
 for(const [id,t] of Object.entries(input.tasks)){
  if(graph.nodes[id]?.type!=='task')errors.push('Задача спринтов отсутствует в графе');
  if(t.subtaskIds.some(i=>graph.nodes[i]?.type!=='subtask'))errors.push('Подзадача спринтов отсутствует в графе');
 }
 return [...new Set(errors)];
}
