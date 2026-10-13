import { HIERARCHY_LIMITS, type HierarchyInput, type HierarchyNodeInput } from '../../shared/hierarchy';
import type { HistorySnapshot } from '../../shared/contracts';
import type { JiraGateway, JiraIssue } from './ports';
import { AppError, safeError } from '../errors';
import { isRejected } from '../../shared/statuses';
import { mapConcurrent } from './concurrency';
import { historySchema } from './cache-schema';
export interface HierarchySeed { issue: JiraIssue; history?: HistorySnapshot; historyAttempted?: boolean }
export function issueSignature(issue:JiraIssue){return JSON.stringify([issue.updated,issue.created,issue.key,issue.currentStatusId,issue.currentStatus,issue.statusCategory,issue.isEpic,issue.isSubtask,issue.resolution,issue.linksKnown,[...(issue.links??[])].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]);}
const fatal=(e:unknown)=>e instanceof AppError && ['JIRA_UNAUTHORIZED','ABORTED','PROFILE_UNVERIFIED','RATE_LIMITED','IDENTITY_CHANGED','JIRA_NETWORK','JIRA_VERSION_CHANGED'].includes(e.code);
function asNode(issue:JiraIssue, history?:HistorySnapshot):HierarchyNodeInput {
  const type=issue.isSubtask===true?'subtask':issue.isEpic?'epic':issue.isSubtask===false?'task':'unknown';
  return {id:issue.id,key:issue.key,title:issue.title,type,resolution:issue.resolution,created:issue.created,currentStatus:issue.currentStatus,...(issue.currentStatusId?{currentStatusId:issue.currentStatusId}:{}),statusCategories:issue.currentStatusId && issue.statusCategory?{[issue.currentStatusId]:issue.statusCategory}:{},...(history?{history}:{}),historyCoverage:history?.statusCoverage ?? 'unavailable',branchCoverage:type==='epic'?issue.linksKnown?'complete':'partial':type==='unknown'?'unavailable':'complete',warnings:[...(issue.hierarchyWarnings??[])]};
}
export async function collectHierarchy(gateway:JiraGateway,seeds:HierarchySeed[],asOf:string,signal:AbortSignal):Promise<HierarchyInput> {
  const graph:HierarchyInput={version:1,asOf,roots:{},nodes:{},edges:[],coverage:'complete',warnings:[]};
  const known=new Map<string,HierarchySeed>(), done=new Set<string>(), edgeIds=new Set<string>();
  for(const seed of seeds){known.set(seed.issue.id,seed);graph.roots[seed.issue.key]=seed.issue.id;graph.nodes[seed.issue.id]=asNode(seed.issue,seed.history);}
  let pending=[...known.keys()],limited=false,nodeCount=Object.keys(graph.nodes).length;
  while(pending.length){
    const batch=pending;pending=[];
    const results=await mapConcurrent(batch,4,signal,async(id,signal)=>{
      let seed=known.get(id), issue=seed?.issue, history=seed?.history;
      try {
        if(!issue)issue=await gateway.getIssue(id,signal);
        if(issue.id!==id)throw new AppError('IDENTITY_CHANGED','Изменилась идентичность связанного элемента.');
        if(!seed?.historyAttempted && issue.isSubtask!==true && (issue.isEpic || issue.isSubtask===false) && !isRejected(issue.resolution) && Date.parse(issue.created)<=Date.parse(asOf)) {
          for(let attempt=0;attempt<2;attempt++){
            history=undefined;
            try{history=historySchema.parse(await gateway.getHistory(issue,signal));}catch(e){if(fatal(e))throw e;graph.nodes[id].warnings.push({...safeError(e),key:issue.key,severity:'warning'});}
            const after=await gateway.getIssue(id,signal);if(after.id!==id)throw new AppError('IDENTITY_CHANGED','Изменилась идентичность связанного элемента.');
            const stable=issueSignature(after)===issueSignature(issue) && (!history || history.updated===issue.updated);issue=after;
            if(stable)break;
            if(attempt===1){history=history?{...history,statusCoverage:'partial'}:undefined;issue={...issue,linksKnown:false,hierarchyWarnings:[...(issue.hierarchyWarnings??[]),{code:'ISSUE_CHANGED',key:issue.key,message:'Элемент менялся во время чтения.',severity:'warning'}]};}
          }
        }
        const node=asNode(issue,history);node.warnings.push(...graph.nodes[id].warnings);return {issue,node};
      }catch(e){if(fatal(e))throw e;signal.throwIfAborted();const node=graph.nodes[id];node.type='unknown';node.branchCoverage='unavailable';node.historyCoverage='unavailable';node.warnings.push({...safeError(e),key:node.key,severity:'warning'});return {node};}
    });
    for(const result of results)done.add(result.node.id);
    for(const {issue,node} of results){
      graph.nodes[node.id]=node;done.add(node.id);
      if(!issue || node.type!=='epic')continue;
      for(const edge of issue.links??[]){
        if(edge.parent!==node.id)continue;
        const token=JSON.stringify([edge.parent,edge.child]);if(edgeIds.has(token))continue;
        if(limited || graph.edges.length>=HIERARCHY_LIMITS.edges || (!graph.nodes[edge.child] && nodeCount>=HIERARCHY_LIMITS.nodes)){limited=true;node.branchCoverage='partial';continue;}
        if(!graph.nodes[edge.child]){nodeCount++;graph.nodes[edge.child]={id:edge.child,key:edge.childKey??edge.child,title:edge.childKey??edge.child,type:'unknown',resolution:null,created:null,currentStatus:'',statusCategories:{},historyCoverage:'unavailable',branchCoverage:'unavailable',warnings:[]};}
        edgeIds.add(token);graph.edges.push({parent:edge.parent,child:edge.child});
        if(!done.has(edge.child) && !pending.includes(edge.child))pending.push(edge.child);
      }
    }
  }
  let categories:Record<string,string>={};
  if(gateway.getStatusCategories && seeds.length){try{categories=await gateway.getStatusCategories(signal);}catch(e){if(fatal(e))throw e;signal.throwIfAborted();graph.warnings.push({code:'STATUS_CATEGORIES_UNAVAILABLE',message:'Категории статусов недоступны; используются правила названий.',severity:'warning'});}}
  for(const node of Object.values(graph.nodes)){
    const ids=new Set([node.currentStatusId,...(node.history?.statusChanges.flatMap(c=>[c.fromId,c.toId])??[])]);
    node.statusCategories={...Object.fromEntries([...ids].flatMap(id=>id && categories[id]?[[id,categories[id]]]:[])),...node.statusCategories};
  }
  if(limited)graph.warnings.push({code:'HIERARCHY_LIMIT',message:'Достигнут предел графа; состав веток неполный.',severity:'warning'});
  graph.coverage=limited || Object.values(graph.nodes).some(n=>n.branchCoverage!=='complete' || (n.type!=='subtask' && n.resolution!==null && !isRejected(n.resolution) && n.historyCoverage!=='complete' && (!n.created || Date.parse(n.created)<=Date.parse(asOf))))?'partial':'complete';
  signal.throwIfAborted();return graph;
}
