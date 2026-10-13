import * as XLSX from 'xlsx';
import { canonical, normalize, isRejected } from '../shared/statuses';
import { HIERARCHY_LIMITS, type HierarchyInput, type HierarchyNodeInput } from '../shared/hierarchy';
import type { EpicSummary, DataWarning } from '../shared/types';
import { AppError } from './errors';
import { tableTimestamp, readTableHistories } from './table-history';
import { statusClosure } from './related-timeline';
const required=['ключ','название','вид элемента','резолюция','создан','статус на срезе'];
function sheet(book:XLSX.WorkBook,name:string){const found=book.SheetNames.filter(n=>canonical(n)===name);if(found.length>1)throw new AppError('HIERARCHY_SHEET','Неоднозначные листы дополнения.');return found[0];}
const rows=(book:XLSX.WorkBook,name:string)=>XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name],{header:1,defval:'',blankrows:true});
export function hierarchyFormat(book:XLSX.WorkBook){
  const settings=sheet(book,'параметры')??sheet(book,'settings');const markers=settings?rows(book,settings).filter(r=>canonical(r[0])==='hierarchyversion'):[];
  if(!markers.length)return undefined;
  if(markers.length!==1 || normalize(markers[0][1])!=='1')throw new AppError('HIERARCHY_VERSION','Неизвестная или неоднозначная версия дополнения книги.');
  const elements=sheet(book,'элементы');
  if(!elements)throw new AppError('HIERARCHY_COLUMNS','Для дополнения нужен лист Элементы.');
  const header=(rows(book,elements)[0]??[]).map(canonical);
  if(required.some(name=>header.filter(v=>v===name).length!==1))throw new AppError('HIERARCHY_COLUMNS','Неоднозначные или отсутствующие колонки листа Элементы.');
  return {settings:settings!,elements,links:sheet(book,'связи')};
}
export function readTableHierarchy(book:XLSX.WorkBook,epics:EpicSummary[],importedAt:string,globalWarnings:DataWarning[]){
  const format=hierarchyFormat(book);if(!format)return undefined;
  const settings=rows(book,format.settings).filter(r=>['asof','срез','момент среза'].includes(canonical(r[0])));
  if(settings.length!==1)throw new AppError('HIERARCHY_ASOF','Для дополнения нужен однозначный asOf.');
  const date1904=!!book.Workbook?.WBProps?.date1904, asOf=new Date(tableTimestamp(settings[0][1],date1904)).toISOString();
  if(Date.parse(asOf)>Date.parse(importedAt))throw new AppError('FUTURE_ASOF','Срез не может быть позже импорта.');
  const values=rows(book,format.elements),header=values[0].map(canonical),all=new Map<string,HierarchyNodeInput>();
  const val=(r:unknown[],name:string)=>normalize(r[header.indexOf(name)]);
  for(const row of values.slice(1)){
    if(row.every(c=>!normalize(c)))continue;
    const key=val(row,'ключ').toUpperCase();if(!/^[A-Z][A-Z0-9_]*-\d+$/.test(key))throw new AppError('HIERARCHY_KEY','Некорректный ключ метаданных дополнения.');
    let created:string|null=null;const warnings:DataWarning[]=[];
    try{created=new Date(tableTimestamp(val(row,'создан'),date1904)).toISOString();}catch{warnings.push({code:'CREATED_UNKNOWN',message:'Дата создания не подтверждена.',key,severity:'warning'});}
    const kind=canonical(val(row,'вид элемента')),type=kind==='эпик'?'epic':kind==='задача'?'task':kind==='подзадача'?'subtask':'unknown';
    const status=val(row,'статус на срезе'),category=val(row,'категория статуса на срезе');
    const node:HierarchyNodeInput={id:key,key,title:val(row,'название')||key,type,resolution:val(row,'резолюция'),created,currentStatus:status,statusCategories:category?{[status]:category}:{},historyCoverage:'unavailable',branchCoverage:type==='epic'?format.links?'complete':'unavailable':type==='unknown'?'unavailable':'complete',warnings};
    if(all.has(key) && JSON.stringify(all.get(key))!==JSON.stringify(node))throw new AppError('HIERARCHY_CONFLICT','Противоречивые метаданные одного элемента.');all.set(key,node);
  }
  const rawEdges:{parent:string;child:string}[]=[], malformed=new Set<string>();
  if(format.links){const linkRows=rows(book,format.links),cols=(linkRows[0]??[]).map(canonical);if(['откуда','связь','куда'].some(k=>cols.filter(v=>v===k).length!==1))throw new AppError('HIERARCHY_COLUMNS','Нужны колонки Откуда, Связь, Куда.');
    for(const r of linkRows.slice(1)){if(r.every(c=>!normalize(c)))continue;const a=normalize(r[cols.indexOf('откуда')]).toUpperCase(),b=normalize(r[cols.indexOf('куда')]).toUpperCase(),relation=canonical(r[cols.indexOf('связь')]);
      if(!['contains','is contained in'].includes(relation)||!/^[A-Z][A-Z0-9_]*-\d+$/.test(a)||!/^[A-Z][A-Z0-9_]*-\d+$/.test(b)){malformed.add(a);malformed.add(b);continue;}
      rawEdges.push(relation==='contains'?{parent:a,child:b}:{parent:b,child:a});
    }
  }
  const g:HierarchyInput={version:1,asOf,roots:Object.fromEntries(epics.map(e=>[e.key,e.key])),nodes:{},edges:[],coverage:'complete',warnings:[]};
  const adjacency=new Map<string,string[]>();for(const e of rawEdges){const list=adjacency.get(e.parent)??[];list.push(e.child);adjacency.set(e.parent,list);}
  const missing=(key:string):HierarchyNodeInput=>({id:key,key,title:key,type:'unknown',resolution:null,created:null,currentStatus:'',statusCategories:{},historyCoverage:'unavailable',branchCoverage:'unavailable',warnings:[{code:'RELATED_METADATA_MISSING',message:'Метаданные связанного элемента отсутствуют.',key,severity:'warning'}]});
  let queue=epics.map(e=>e.key),seen=new Set<string>(),edges=new Set<string>(),limited=false,count=0;
  for(const key of queue){g.nodes[key]=all.get(key)??missing(key);count++;}
  while(queue.length){const key=queue.pop()!;if(seen.has(key))continue;seen.add(key);const n=g.nodes[key];if(malformed.has(key)){n.branchCoverage='partial';n.warnings.push({code:'LINK_INVALID',message:'Одна из связей некорректна.',key,severity:'warning'});}if(n.type!=='epic')continue;
    for(const child of adjacency.get(key)??[]){const token=JSON.stringify([key,child]);if(edges.has(token))continue;
      if(limited||g.edges.length>=HIERARCHY_LIMITS.edges||(!g.nodes[child]&&count>=HIERARCHY_LIMITS.nodes)){limited=true;n.branchCoverage='partial';continue;}
      if(!g.nodes[child]){g.nodes[child]=all.get(child)??missing(child);count++;}edges.add(token);g.edges.push({parent:key,child});queue.push(child);
    }
  }
  const included=Object.values(g.nodes).filter(n=>n.type!=='unknown'&&n.type!=='subtask'&&!isRejected(n.resolution??'')&&(!n.created||Date.parse(n.created)<=Date.parse(asOf)));
  const histories=readTableHistories(book,included.map(n=>({key:n.key,title:n.title,resolution:n.resolution??''})),importedAt,globalWarnings,(key,status)=>statusClosure(g.nodes[key],status).closed===true);
  for(const n of included){const history=histories.histories[n.key];if(history){n.history=history;n.historyCoverage='complete';}n.warnings.push(...(histories.historyWarnings[n.key]??[]));
    if(history && canonical(history.currentStatus)!==canonical(n.currentStatus)){n.historyCoverage='partial';n.warnings.push({code:'STATUS_MISMATCH',message:'История не соответствует статусу на срезе.',key:n.key,severity:'warning'});}
  }
  if(limited)g.warnings.push({code:'HIERARCHY_LIMIT',message:'Достигнут предел графа; состав неполный.',severity:'warning'});
  g.coverage=limited||Object.values(g.nodes).some(n=>n.branchCoverage!=='complete'||(included.includes(n)&&n.historyCoverage!=='complete'))?'partial':'complete';
  return {hierarchy:g,histories:histories.histories,historyWarnings:histories.historyWarnings,asOf};
}
