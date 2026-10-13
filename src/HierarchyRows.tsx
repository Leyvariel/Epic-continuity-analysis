import {SprintRows} from './SprintRows';
import type {SprintAnalysis} from '../shared/sprints';
import {useState,useEffect} from 'react';
import type {Hierarchy} from '../shared/hierarchy';import {HIERARCHY_LIMITS} from '../shared/hierarchy';
import {childrenOf,hierarchyIndex} from '../shared/hierarchy-view';import type {CalendarRange} from '../shared/calendar';import {RelatedStatusBar} from './RelatedStatusBar';
export const branchKey=(path:string[])=>JSON.stringify(path);
export function HierarchyRows({sprintAnalysis,index,graph,parent,open,toggle,range,pixels,width}:{sprintAnalysis?:SprintAnalysis;index:ReturnType<typeof hierarchyIndex>;graph:Hierarchy;parent:string;open:Set<string>;toggle:(path:string[])=>void;range:CalendarRange;pixels:number;width:number}){
 const [limit,setLimit]=useState<number>(HIERARCHY_LIMITS.page),rootOpen=open.has(branchKey([parent]));
 useEffect(()=>{if(!rootOpen)setLimit(HIERARCHY_LIMITS.page);},[rootOpen]);
 if(!rootOpen)return null;
 const stack:{id:string;via:string[];path:string[]}[]=[],rows:typeof stack=[],warnings:string[]=[];
 const append=(id:string,path:string[])=>{const result=childrenOf(graph,id,path.slice(0,-1),index);warnings.push(...result.warnings);for(const child of [...result.children].reverse())stack.push({...child,path:[...path,child.id]});if(graph.nodes[id].branchCoverage!=='complete')warnings.push(`Состав ${graph.nodes[id].key} не подтверждён.`);};
 append(parent,[parent]);
 while(stack.length && rows.length<limit){const row=stack.pop()!;rows.push(row);if(open.has(branchKey(row.path)) && graph.nodes[row.id].type==='epic')append(row.id,row.path);}
 return <>
  {[...new Set(warnings)].map(w=><div className="hierarchy-notice" key={w} role="status">⚠ {w}</div>)}
  {rows.map(row=>{const node=graph.nodes[row.id],expanded=open.has(branchKey(row.path)),result=node.type==='epic'?childrenOf(graph,row.id,row.path.slice(0,-1),index):null,empty=result?.children.length===0&&node.branchCoverage==='complete'&&!result.warnings.length;
   return <div className="related-row" key={branchKey(row.path)} data-issue-key={node.key}><div className="left-area related-title" style={{paddingLeft:12+Math.min(row.path.length-1,12)*16}}>
    <div>{result&&<button className="disclosure" disabled={empty} aria-expanded={expanded} aria-label={`${expanded?'Свернуть':'Раскрыть'} ${node.key}`} title={empty?'Нет связанных элементов':undefined} onClick={()=>toggle(row.path)}>{empty?'·':expanded?'▾':'▸'}</button>}<strong>{node.key}</strong> <span>{node.title}</span></div>
    <small>{node.type==='epic'?'Связанный эпик':node.type==='task'?'Связанная задача':'Тип элемента не подтверждён'}{row.via.length>0&&` · через скрытый отклонённый эпик ${row.via.map(id=>graph.nodes[id].key).join(' → ')}`}{node.timeline.closureSource==='name'&&' · закрытие по названию статуса'}{empty&&' · Нет связанных элементов'}</small>
    {node.timeline.warnings.length>0 && <small className="related-warning">⚠ {node.timeline.warnings.map(w=>w.message).join(' ')}</small>}
   </div><div className="row-calendar" style={{width}}><RelatedStatusBar node={node} range={range} pixels={pixels} width={width}/><SprintRows row={sprintAnalysis?.rows[row.id]} range={range} pixels={pixels} width={width}/></div></div>;
  })}
  {stack.length>0&&<div className="hierarchy-notice"><button onClick={()=>setLimit(n=>n+HIERARCHY_LIMITS.page)}>Показать ещё</button></div>}
 </>;
}
