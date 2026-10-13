import type { HierarchyNode } from '../shared/hierarchy';
import type { CalendarRange } from '../shared/calendar';
import { dateTime, position } from '../shared/calendar';
import { canonical } from '../shared/statuses';
import { segmentLabels } from '../shared/layout';
export function relatedLabels(node:HierarchyNode,range:CalendarRange,pixels:number){return segmentLabels(node.timeline.intervals.map((s,i)=>({...s,order:i,kind:'unknown' as const,code:s.status,openEnded:false})),range.start,pixels);}
function color(status:string){let hash=0;for(const char of canonical(status))hash=(hash*31+char.charCodeAt(0))>>>0;return `hsl(${hash%360} 48% 76%)`;}
export function RelatedStatusBar({node,range,pixels,width}:{node:HierarchyNode;range:CalendarRange;pixels:number;width:number}){
 const t=node.timeline,labels=relatedLabels(node,range,pixels),pos=(value:string)=>position(Date.parse(value),range.start,pixels);
 return <div className="calendar-body related-calendar" style={{width}}>
  {t.state!=='complete'?<div className="related-diagnostic">{t.state==='not-present'?'Создан после среза':t.warnings.map(w=>w.message).join(' ')||'История недоступна'}</div>:<>
  {t.intervals.map((s,i)=>{const l=labels[i],title=`${s.status}\n${dateTime(s.start)} → ${dateTime(s.end)} МСК`;return <div key={i}><span tabIndex={0} className="related-segment" style={{left:l.left,width:l.width,background:color(s.status)}} title={title} aria-label={title}>{!l.narrow&&s.status}</span>{l.narrow&&<span className="related-callout" style={{left:l.labelLeft,top:4+l.lane*15,width:l.labelWidth}} title={title}>{s.status}</span>}</div>;})}
  {t.closed && t.end && <span className="related-end" style={{left:pos(t.end)}} title={`${t.terminalStatus}\n${dateTime(t.end)} МСК`} aria-label={`Закрытие ${node.key}: ${dateTime(t.end)} МСК`}/>}
  </>}
 </div>;
}
