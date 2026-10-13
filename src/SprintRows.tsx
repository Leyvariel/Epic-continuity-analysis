import {useId,useState} from 'react';
import type {SprintRow,SprintSegment,SprintAnalysis} from '../shared/sprints';
import {dateTime,position,type CalendarRange} from '../shared/calendar';
export const SPRINT_LABELS={work:'Работа подтверждена',empty:'Нет работы в закрытом спринте',unknown:'Недостаточно данных','active-empty':'Пока нет подтверждённой работы · спринт активен'};
export function sprintLanes(segments:SprintSegment[]){
 const ends:number[]=[];
 return [...segments].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)||(a.boardId??'').localeCompare(b.boardId??'','en',{numeric:true})||a.sprintId.localeCompare(b.sprintId,'en',{numeric:true})).map(segment=>{
  let lane=ends.findIndex(end=>end<=Date.parse(segment.start));if(lane<0)lane=ends.length;ends[lane]=Date.parse(segment.end);return {segment,lane};
 });
}
export function visibleSprints(row:SprintRow){const hidden=new Set(row.hiddenSprintIds??[]);return row.segments.filter(s=>!hidden.has(s.sprintId));}
export function sprintBounds(analysis?:SprintAnalysis){return Object.values(analysis?.rows??{}).flatMap(row=>[...visibleSprints(row),...row.phases]);}
const tooltip=(s:SprintSegment)=>`${s.name} · Sprint ${s.sprintId}${s.boardId?` · доска ${s.boardId}`:''}\n${SPRINT_LABELS[s.state]} · ${s.lifecycle==='active'?'активен на срезе':'закрыт'}\n${dateTime(s.start)} → ${dateTime(s.end)} МСК\nПлановое окончание: ${dateTime(s.plannedEnd)} МСК${s.taskKeys.length?`\nЗадачи: ${s.taskKeys.join(', ')}`:''}${s.subtaskKeys.length?`\nПодзадачи: ${s.subtaskKeys.join(', ')}`:''}${s.coveredBy.length?`\nПересечение с работой в: ${s.coveredBy.join(', ')}. Отсутствие работы в спринте само по себе не означает брешь: для неё нужно доказанное отсутствие включённых задач.`:''}${s.warnings.length?`\n${s.warnings.join(' ')}`:''}`;
export function SprintRows({row,range,pixels,width}:{row?:SprintRow;range:CalendarRange;pixels:number;width:number}){
 const [selected,setSelected]=useState<string|null>(null),detailId=useId();if(!row)return null;
 const segments=visibleSprints(row),lanes=sprintLanes(segments),count=Math.max(0,...lanes.map(l=>l.lane+1));
 const detail=segments.find(s=>s.sprintId===selected),pos=(v:string)=>position(Date.parse(v),range.start,pixels);
 return <div className="sprint-layer" style={{width}} aria-label="Спринты дочерних задач">
  <div className="sprint-tracks" style={{height:Math.max(26,8+count*29)}}>
   {lanes.map(({segment:s,lane})=><button key={s.sprintId} className={`sprint-segment sprint-${s.state}`} style={{left:pos(s.start),width:pos(s.end)-pos(s.start),top:6+lane*29}} title={tooltip(s)} aria-label={tooltip(s)} aria-describedby={selected===s.sprintId?detailId:undefined} onFocus={()=>setSelected(s.sprintId)} onClick={()=>setSelected(s.sprintId)} onKeyDown={e=>{if(e.key==='Escape')setSelected(null);}}>{s.state==='work'?'✓ ':s.state==='unknown'?'? ':s.state==='active-empty'?'◌ ':'○ '}{s.name}</button>)}
   {!count&&<span className="sprint-empty">Нет спринтов для отображения</span>}
  </div>
  {detail&&<div className="sprint-details" id={detailId} role="status"><button className="sprint-close" aria-label="Закрыть сведения о спринте" onClick={()=>setSelected(null)}>×</button>{tooltip(detail)}{detail.taskKeys.length>0&&<div>{[...detail.taskKeys,...detail.subtaskKeys].map(key=><a key={key} href={`https://hq.tutu.ru/browse/${encodeURIComponent(key)}`} target="_blank" rel="noreferrer">{key} ↗ </a>)}</div>}</div>}
  {row.warnings.length>0&&<details className="sprint-warnings"><summary>Неполнота анализа спринтов ({row.warnings.length})</summary><ul>{row.warnings.map(w=><li key={w}>{w}</li>)}</ul></details>}
 </div>;
}
