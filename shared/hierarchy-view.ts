import type { HierarchyInput } from './hierarchy';
import { isRejected } from './statuses';
export function hierarchyIndex(graph: HierarchyInput) {
  const index = new Map<string, string[]>();
  for (const edge of graph.edges) { const list=index.get(edge.parent) ?? []; list.push(edge.child); index.set(edge.parent,list); }
  return index;
}
export function childrenOf(graph: HierarchyInput, parent: string, ancestors: string[] = [], index = hierarchyIndex(graph)) {
  const children = new Map<string, { id: string; via: string[] }>(), warnings: string[] = [];
  const forbidden = new Set([...ancestors,parent]), visited = new Set<string>(), active = new Set<string>(), predecessor = new Map<string,string>();
  const stack = (index.get(parent) ?? []).map(id=>({id,from:parent,exit:false}));
  while(stack.length) {
    const entry=stack.pop()!;
    if(entry.exit){active.delete(entry.id);continue;}
    if(forbidden.has(entry.id) || active.has(entry.id)){warnings.push('Обнаружен цикл связей.');continue;}
    const n=graph.nodes[entry.id]; if(!n || n.type==='subtask')continue;
    if(n.resolution !== null && isRejected(n.resolution)) {
      if(n.type!=='epic' || visited.has(n.id))continue;
      visited.add(n.id);active.add(n.id);predecessor.set(n.id,entry.from);
      stack.push({id:n.id,from:entry.from,exit:true});
      for(const id of index.get(n.id) ?? [])stack.push({id,from:n.id,exit:false});
      if(n.branchCoverage!=='complete')warnings.push(`Состав ${n.key} не подтверждён.`);
    } else if(!children.has(n.id)) {
      const via: string[]=[];let cursor=entry.from;
      while(cursor!==parent && predecessor.has(cursor)){via.push(cursor);cursor=predecessor.get(cursor)!;}
      children.set(n.id,{id:n.id,via:via.reverse()});
    }
  }
  return { children:[...children.values()].sort((a,b)=>graph.nodes[a.id].key.localeCompare(graph.nodes[b.id].key,'en',{numeric:true})), warnings:[...new Set(warnings)] };
}
export function eligibleHierarchyIds(graph: HierarchyInput) {
  const roots=new Set(Object.values(graph.roots)), seen=new Set<string>(), eligible=new Set<string>(), index=hierarchyIndex(graph), queue=[...roots];
  while(queue.length){const id=queue.pop()!;if(seen.has(id))continue;seen.add(id);const n=graph.nodes[id];if(!n || n.type==='subtask')continue;
    if(n.resolution!==null && !isRejected(n.resolution) && n.type!=='unknown')eligible.add(id);
    if(n.type==='epic')queue.push(...(index.get(id)??[]));
  }
  return eligible;
}
