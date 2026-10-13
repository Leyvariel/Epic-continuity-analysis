import {describe,it,expect,vi} from 'vitest';
import {collectHierarchy} from '../server/jira/hierarchy';import {childrenOf} from '../shared/hierarchy-view';import {node,CUT,at} from './hierarchy-fixtures';import {jiraIssue,jiraHistory} from './jira-fixtures';import type {HierarchyInput} from '../shared/hierarchy';
describe('AC-039: реальные защитные пределы',()=>{
 it('10 000 уникальных узлов допустимы, 10 001 явно неполны; дубли не расходуют лимит',async()=>{
  for(const count of [9999,10000]){
   let active=0,peak=0;const root=jiraIssue({id:'1',key:'A-1',created:at(1),updated:CUT,links:Array.from({length:count},(_,i)=>({parent:'1',child:String(i+2),childKey:`TASK-${i+2}`}))});root.links!.push(root.links![0]);
   const getIssue=vi.fn(async(id:string)=>{active++;peak=Math.max(peak,active);await Promise.resolve();active--;return jiraIssue({id,key:`TASK-${id}`,isEpic:false,isSubtask:false,created:at(11),updated:CUT,currentStatus:'В работе',links:[]});});
   const g=await collectHierarchy({getIssue,getHistory:vi.fn(),readBoard:vi.fn()},[{issue:root,history:jiraHistory(),historyAttempted:true}],CUT,new AbortController().signal);
   expect(Object.keys(g.nodes)).toHaveLength(10000);expect(g.edges).toHaveLength(9999);expect(peak).toBeLessThanOrEqual(4);expect(g.warnings.some(w=>w.code==='HIERARCHY_LIMIT')).toBe(count===10000);expect(getIssue).toHaveBeenCalledTimes(9999);
  }
 },15000);
 it('50 000 рёбер допустимы, 50 001 не теряются молча',async()=>{
  for(const overflow of [false,true]){
   const seeds=Array.from({length:501},(_,i)=>{const id=String(i+1);return {issue:jiraIssue({id,key:`ROOT-${id}`,created:at(1),updated:CUT,links:i<500?Array.from({length:100},(_,j)=>({parent:id,child:String(1000+j),childKey:`TASK-${j+1}`})):overflow?[{parent:id,child:'1000',childKey:'TASK-1'}]:[]}),history:jiraHistory(),historyAttempted:true};});
   const g=await collectHierarchy({getIssue:vi.fn(async(id:string)=>jiraIssue({id,key:`TASK-${id}`,isEpic:false,isSubtask:false,created:at(11),updated:CUT,links:[]})),getHistory:vi.fn(),readBoard:vi.fn()},seeds,CUT,new AbortController().signal);
   expect(g.edges).toHaveLength(50000);expect(g.warnings.some(w=>w.code==='HIERARCHY_LIMIT')).toBe(overflow);
  }
 },15000);
 it('1000 выбранных корней входят в предел 10 000 вместе с 9000 детьми',async()=>{
  const seeds=Array.from({length:1000},(_,i)=>{const id=String(i+1);return {issue:jiraIssue({id,key:`ROOT-${id}`,created:at(1),updated:CUT,links:i===0?Array.from({length:9000},(_,j)=>({parent:id,child:String(1001+j),childKey:`TASK-${j+1}`})):[]}),history:jiraHistory(),historyAttempted:true};});
  const gateway={getIssue:vi.fn(async(id:string)=>jiraIssue({id,key:`TASK-${id}`,isEpic:false,isSubtask:false,created:at(11),updated:CUT,links:[]})),getHistory:vi.fn(),readBoard:vi.fn()};
  const g=await collectHierarchy(gateway,seeds,CUT,new AbortController().signal);
  expect(Object.keys(g.roots)).toHaveLength(1000);expect(Object.keys(g.nodes)).toHaveLength(10000);expect(g.edges).toHaveLength(9000);
  expect(g.warnings.some(w=>w.code==='HIERARCHY_LIMIT')).toBe(false);expect(gateway.getIssue).toHaveBeenCalledTimes(9000);
 },15000);
 it('глубокая скрытая цепочка и скрытый цикл конечны',()=>{
  const g:HierarchyInput={version:1,asOf:CUT,roots:{'A-1':'A-1'},nodes:{'A-1':node('A-1'),'T-1':node('T-1','task')},edges:[],coverage:'complete',warnings:[]};let previous='A-1';
  for(let i=1;i<9998;i++){const id=`R-${i}`;g.nodes[id]={...node(id),resolution:'Отклонено'};g.edges.push({parent:previous,child:id});previous=id;}g.edges.push({parent:previous,child:'T-1'});g.edges.push({parent:previous,child:'R-2'});
  const result=childrenOf(g,'A-1');expect(result.children.map(c=>c.id)).toEqual(['T-1']);expect(result.warnings.join(' ')).toMatch(/цикл/);expect(result.children[0].via).toHaveLength(9997);
 });
});
