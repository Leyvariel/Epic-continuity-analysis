import { describe, it, expect, vi } from 'vitest';
import { collectHierarchy, issueSignature } from '../server/jira/hierarchy';
import { jiraIssue, jiraHistory } from './jira-fixtures';
import { AppError } from '../server/errors';
import { CUT, at, history } from './hierarchy-fixtures';
const root = jiraIssue({id:'1',key:'A-1',created:at(1),updated:CUT,isSubtask:false,linksKnown:true,links:[{parent:'1',child:'2',childKey:'B-1'},{parent:'1',child:'3',childKey:'C-1'}]});
const child = (id:string) => jiraIssue({id,key:id==='2'?'B-1':'C-1',isEpic:id==='2',flow:'DF',isSubtask:false,created:at(1),updated:CUT,currentStatus:'Готово',linksKnown:true,links:id==='2'?[{parent:'2',child:'3',childKey:'C-1'}]:[]});
describe('T005: получение графа Jira',()=>{
  it('стабильность учитывает дату создания и категорию, даже при том же updated',()=>{
    expect(issueSignature({...root,created:at(2)})).not.toBe(issueSignature(root));
    expect(issueSignature({...root,statusCategory:'done'})).not.toBe(issueSignature(root));
  });
  it('при повторной нестабильности ограничивает перечитывание и оставляет неполноту',async()=>{
    let reads=0;const getIssue=vi.fn(async(id:string)=>({...child(id),updated:at(++reads+1)}));
    const getHistory=vi.fn(async(issue:ReturnType<typeof child>)=>jiraHistory({...history(issue.key),updated:issue.updated}));
    const seed={...root,links:[root.links![1]]};
    const g=await collectHierarchy({getIssue,getHistory,readBoard:vi.fn()},[{issue:seed,historyAttempted:true}],CUT,new AbortController().signal);
    expect(getIssue).toHaveBeenCalledTimes(3);expect(getHistory).toHaveBeenCalledTimes(2);
    expect(g.nodes['3'].historyCoverage).toBe('partial');expect(g.nodes['3'].warnings.some(w=>w.code==='ISSUE_CHANGED')).toBe(true);
  });
  it('читает общую задачу одним процессом и сохраняет DF',async()=>{
    const getIssue=vi.fn(async(id:string)=>child(id)),getHistory=vi.fn(async(issue:ReturnType<typeof child>)=>jiraHistory({...history(issue.key),updated:CUT}));
    const g=await collectHierarchy({getIssue,getHistory,readBoard:vi.fn()},[{issue:root,history:jiraHistory({...history('A-1'),updated:CUT}),historyAttempted:true}],CUT,new AbortController().signal);
    expect(g?.nodes['2'].type).toBe('epic');expect(g?.edges).toHaveLength(3);expect(getHistory.mock.calls.filter(([n])=>n.id==='3')).toHaveLength(1);
    expect(getIssue.mock.calls.filter(([id])=>id==='3')).toHaveLength(2);
  });
  it('локальная ошибка истории сохраняет соседей, глобальная прерывает сбор',async()=>{
    const gateway={getIssue:vi.fn(async(id:string)=>child(id)),getHistory:vi.fn(async(issue:ReturnType<typeof child>)=>{if(issue.id==='3')throw new AppError('JIRA_FORBIDDEN','История недоступна',403);return jiraHistory({...history(issue.key),updated:CUT});}),readBoard:vi.fn()};
    const g=await collectHierarchy(gateway,[{issue:root,historyAttempted:true}],CUT,new AbortController().signal);expect(g?.nodes['3'].historyCoverage).toBe('unavailable');expect(g?.nodes['2'].history).toBeDefined();
    gateway.getIssue.mockRejectedValue(new AppError('JIRA_UNAUTHORIZED','Авторизация',401));await expect(collectHierarchy(gateway,[{issue:root}],CUT,new AbortController().signal)).rejects.toMatchObject({code:'JIRA_UNAUTHORIZED'});
  });
});
