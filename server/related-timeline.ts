import { eligibleHierarchyIds } from '../shared/hierarchy-view';
import type { Hierarchy, HierarchyInput, HierarchyNodeInput, RelatedInterval, RelatedTimeline } from '../shared/hierarchy';
import { canonical } from '../shared/statuses';
import { orderedChanges, sameStatus } from './jira/normalize';
const CLOSED = new Set(['закрыт','закрыто','закрыта','готово','выполнен','выполнено','выполнена','завершен','завершено','завершена','решен','решено','решена','closed','done','completed','resolved']);
const OPEN = new Set(['открыт','открыто','открыта','новый','новая','новое','в работе','в процессе','переоткрыт','переоткрыто','переоткрыта','open','new','to do','in progress','reopened']);
export function statusClosure(node: HierarchyNodeInput, status: string, id?: string) {
  const name=canonical(status), category=canonical(node.statusCategories[id ?? ''] ?? node.statusCategories[status]);
  const named = node.type==='epic' ? /^\[(hf|df)\] /.test(name) ? /^\[(hf|df)\] закрыт$/.test(name) : null : node.type==='task' ? CLOSED.has(name) ? true : OPEN.has(name) ? false : null : null;
  const categorized=['done','completed'].includes(category) ? true : ['new','indeterminate','in-flight'].includes(category) ? false : null;
  return { closed:categorized ?? named, source:categorized!==null ? 'category' as const : named!==null ? 'name' as const : null, mismatch:categorized!==null && named!==null && categorized!==named, unknownCategory:!!category && !['done','completed','new','indeterminate','in-flight','undefined'].includes(category) };
}
export function relatedTimeline(node: HierarchyNodeInput, asOf: string): RelatedTimeline {
  const warnings=[...node.warnings], base:RelatedTimeline={state:'unavailable',intervals:[],start:null,end:null,closed:false,terminalStatus:null,closureSource:null,warnings};
  const fail=(message:string)=>({...base,warnings:[...warnings,{code:'RELATED_HISTORY_UNKNOWN',key:node.key,message,severity:'warning' as const}]});
  const cutoff=Date.parse(asOf), created=node.created ? Date.parse(node.created):NaN;
  if(created>cutoff)return {...base,state:'not-present',warnings:[...warnings,{code:'AFTER_CUTOFF',key:node.key,message:'Создан после среза',severity:'warning'}]};
  const h=node.history;
  if(!h || node.historyCoverage!=='complete' || !Number.isFinite(created) || created!==Date.parse(h.historyStart))return fail('Полная история от создания не подтверждена.');
  if('source' in h && h.source==='jira' && (h.statusCoverage!=='complete' || !h.initialStateProven || !h.proof?.terminal || h.proof.expected!==h.proof.received))return fail('Полнота истории Jira не подтверждена.');
  const changes=orderedChanges(h.statusChanges);let status=changes[0]?.from ?? h.currentStatus, statusId=changes[0]?.fromId ?? (!changes.length ? h.currentStatusId : undefined), cursor=created;
  const seen=new Set<string>();
  for(const change of changes){const at=Date.parse(change.at);if(!Number.isFinite(at)||at<cursor||seen.has(change.id)||!sameStatus(status,change.from,statusId,change.fromId))return fail('Разрыв или повтор в цепочке статусов.');seen.add(change.id);status=change.to;statusId=change.toId;cursor=at;}
  if(!sameStatus(status,h.currentStatus,statusId,h.currentStatusId))return fail('История не соответствует конечному статусу.');
  status=changes[0]?.from ?? h.currentStatus;statusId=changes[0]?.fromId ?? (!changes.length ? h.currentStatusId : undefined);cursor=created;
  const intervals:RelatedInterval[]=[];
  for(const change of changes){const time=Date.parse(change.at);if(time>cutoff)break;intervals.push({status,start:new Date(cursor).toISOString(),end:new Date(time).toISOString(),durationMs:time-cursor});status=change.to;statusId=change.toId;cursor=time;}
  const closure=statusClosure(node,status,statusId);
  if(closure.closed===null)return fail('Неизвестно, закрывает ли конечный статус элемент.');
  if(closure.mismatch)warnings.push({code:'CLOSURE_MISMATCH',key:node.key,message:'Категория и название статуса расходятся; использована категория.',severity:'warning'});
  if(closure.unknownCategory)warnings.push({code:'CATEGORY_UNKNOWN',key:node.key,message:'Категория не распознана; использовано название статуса.',severity:'warning'});
  const end=closure.closed ? cursor : cutoff;
  if(!closure.closed)intervals.push({status,start:new Date(cursor).toISOString(),end:new Date(end).toISOString(),durationMs:end-cursor});
  return {state:'complete',intervals,start:new Date(created).toISOString(),end:new Date(end).toISOString(),closed:closure.closed,terminalStatus:closure.closed?status:null,closureSource:closure.source,warnings};
}
export function buildHierarchy(input: HierarchyInput | undefined): Hierarchy | undefined {
  if(!input)return undefined;
  const nodes=Object.fromEntries(Object.entries(input.nodes).map(([id,n])=>[id,{...n,timeline:relatedTimeline(n,input.asOf)}]));
  const eligible=eligibleHierarchyIds(input);
  const partial=[...eligible].some(id=>nodes[id].timeline.state==='unavailable');
  return {...input,nodes,coverage:input.coverage==='complete' && partial?'partial':input.coverage};
}
