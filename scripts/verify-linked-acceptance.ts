// Read-only Jira acceptance. Reports contain selected facts, never full responses or credentials.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {JiraClient} from '../server/jira/client';
import {readPat} from '../server/jira/keychain';
import {ServerJiraAdapter,profileSchema} from '../server/jira/adapter';
import {relatedTimeline} from '../server/related-timeline';
import type {HierarchyNodeInput} from '../shared/hierarchy';

if(!process.argv.includes('--execute')){console.log('План: только GET Jira для BUSDIS-10, BUSDEL-6, RAILDIS-58, RAIL-11361, BUSDEL-58/60 и до пяти случаев повторного открытия RAIL/BUSDEL; рабочий кэш не изменяется.');process.exit(0);}
const asOf=new Date().toISOString(),signal=AbortSignal.timeout(180_000);
const before=await readFile('.local-data/dataset.json');
const client=new JiraClient(await readPat(signal));
const profile=profileSchema.parse(JSON.parse(await readFile('.local-data/jira-profile.json','utf8')));
const adapter=new ServerJiraAdapter(client,profile);
const report:any={asOf,status:'running',checks:[],cases:[],limits:[]};
const check=(name:string,facts:unknown)=>report.checks.push({name,facts});
try{
 const info:any=await client.get('/rest/api/2/serverInfo',{},signal);assert.equal(info.version,profile.version);
 const categories=await adapter.getStatusCategories(signal);
 const workingIds=new Set<string>();
 const fields='summary,status,issuetype,resolution,created,updated,assignee,issuelinks,parent,subtasks';
 const raw=async(key:string)=>client.get(`/rest/api/2/issue/${key}`,{fields},signal) as Promise<any>;
 const [parent,child]=await Promise.all([raw('BUSDIS-10'),raw('BUSDEL-6')]);
 const outward=parent.fields.issuelinks.find((l:any)=>l.outwardIssue?.id===child.id||l.inwardIssue?.id===child.id);
 const inward=child.fields.issuelinks.find((l:any)=>l.outwardIssue?.id===parent.id||l.inwardIssue?.id===parent.id);
 assert.ok(outward&&inward);assert.equal(outward.type.id,inward.type.id);
 const parentIssue=await adapter.getIssue(parent.key,signal),childIssue=await adapter.getIssue(child.key,signal);
 assert.ok(parentIssue.links?.some(e=>e.parent===parent.id&&e.child===child.id));
 assert.ok(childIssue.links?.some(e=>e.parent===parent.id&&e.child===child.id));
 check('Обе стороны contains дают одно направление',{parent:parent.key,child:child.key,type:outward.type.id,parentSide:outward.outwardIssue?'outwardIssue':'inwardIssue',childSide:inward.outwardIssue?'outwardIssue':'inwardIssue',labels:outward.type});
 const task=await raw('BUSDEL-58'),subtask=await raw('BUSDEL-60');
 assert.equal(task.fields.issuetype.subtask,false);assert.equal(subtask.fields.issuetype.subtask,true);assert.equal(subtask.fields.parent.id,task.id);
 assert.equal((await adapter.getIssue(subtask.key,signal)).isSubtask,true);
 check('Признак native Sub-task и родитель',{task:task.key,subtask:subtask.key,subtaskFlag:true,parentMatches:true});
 const epic=await adapter.getIssue('RAIL-11361',signal);
 const membership:any=await client.get(`/rest/agile/1.0/epic/${epic.id}/issue`,{startAt:'0',maxResults:'100',fields:'key'},signal);
 assert.equal(membership.issues.length,membership.total);
 assert.ok(membership.issues.every((i:any)=>epic.links?.some(e=>e.parent===epic.id&&e.child===i.id)));
 check('Стандартный состав Epic Link включён',{epic:epic.key,count:membership.total,allIncluded:true,complete:epic.linksKnown});
 async function inspect(key:string){
  const issue=await adapter.getIssue(key,signal),history=await adapter.getHistory(issue,signal);
  const node:HierarchyNodeInput={id:issue.id,key:issue.key,title:issue.title,type:issue.isEpic?'epic':issue.isSubtask?'subtask':'task',resolution:issue.resolution,created:issue.created,currentStatus:issue.currentStatus,currentStatusId:issue.currentStatusId,statusCategories:categories,history,historyCoverage:history.statusCoverage,branchCoverage:'complete',warnings:[]};
  const timeline=relatedTimeline(node,asOf);assert.equal(timeline.state,'complete');
  const transitions=history.statusChanges.filter(c=>Date.parse(c.at)<=Date.parse(asOf));
  for(const c of transitions)for(const id of [c.fromId,c.toId])if(id&&['new','indeterminate'].includes(categories[id]))workingIds.add(id);
  const reopen=transitions.filter(c=>categories[c.fromId??'']==='done'&&['new','indeterminate'].includes(categories[c.toId??'']));
  if(timeline.closed)assert.equal(timeline.end,transitions.at(-1)?.at??history.historyStart);else assert.equal(timeline.end,asOf);
  const replay=relatedTimeline({...node,statusCategories:{}},asOf);
  const missingIds=[...new Set(transitions.flatMap(c=>[c.fromId,c.toId]).filter((id):id is string=>!!id&&!categories[id]))];
  const result={key:issue.key,type:node.type,status:issue.currentStatus,category:categories[issue.currentStatusId??''],historyCoverage:history.statusCoverage,closureSource:timeline.closureSource,end:timeline.end,closed:timeline.closed,reopen:reopen.map(c=>({at:c.at,from:c.from,to:c.to})),missingCategoryIds:missingIds,nameFallbackReplay:{state:replay.state,closureSource:replay.closureSource,end:replay.end,matches:replay.end===timeline.end}};
  report.cases.push(result);return result;
 }
 for(const key of ['BUSDIS-10','BUSDEL-6','RAIL-11361','BUSDEL-58'])await inspect(key);
 const ordinary=await adapter.getIssue('RAIL-10019',signal);
 const doneIds=[epic.currentStatusId,task.fields.status.id,ordinary.currentStatusId];
 const conditions=[...new Set(doneIds)].flatMap(from=>[...workingIds].map(to=>`status CHANGED FROM ${from} TO ${to}`));
 const search:any=await client.get('/rest/api/2/search',{jql:`project in (RAIL, BUSDEL) AND (${conditions.join(' OR ')}) ORDER BY updated DESC`,fields:'key',maxResults:'5'},signal);
 report.reopenSearch={doneIds,workingIds:[...workingIds],total:search.total,examined:[]};
 for(const candidate of search.issues){if(report.cases.some((c:any)=>c.key===candidate.key))continue;report.reopenSearch.examined.push(candidate.key);const result=await inspect(candidate.key);if(result.reopen.length)break;}
 assert.ok(report.cases.some((c:any)=>c.reopen.length),'Не найден живой пример переоткрытия в ограниченном наборе');
 check('Закрытие и повторное открытие сверены по полной истории',{keys:report.cases.map((c:any)=>c.key),reopened:report.cases.filter((c:any)=>c.reopen.length).map((c:any)=>c.key)});
 const replayCases=report.cases.filter((c:any)=>c.nameFallbackReplay.closureSource==='name'&&c.nameFallbackReplay.matches);
 assert.ok(replayCases.length);check('Резерв по названию на живых историях при отключённом словаре',{keys:replayCases.map((c:any)=>c.key),kind:'controlled-replay',naturalCategoryOutage:false});
 report.limits.push('Справочник категорий Jira доступен. Его естественный отказ не наблюдался; резерв по названию проверен управляемым повтором живых историй без словаря и автоматическими тестами отказов.');
 assert.deepEqual(await readFile('.local-data/dataset.json'),before);report.cacheUnchanged=true;report.cacheSha256=createHash('sha256').update(before).digest('hex');report.status='passed';
}catch(error){report.status='failed';report.error=error instanceof Error?error.message:'Ошибка проверки';process.exitCode=1;}
finally{client.close();await writeFile('docs/sdd/changes/archive/2026/LOCAL-20260924-02-linked-issue-status-bars/evidence/acceptance-jira-20261111.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,cases:report.cases.map((c:any)=>c.key),error:report.error}));}
