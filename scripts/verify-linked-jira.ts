import {mkdtemp,readFile,writeFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {DatasetService} from '../server/service';import {CacheStore} from '../server/cache';import {gatewayFromProfile} from '../server/jira/config';import {safeError} from '../server/errors';
const key=process.argv.find(a=>/^[A-Z][A-Z0-9_]*-\d+$/.test(a));
if(!process.argv.includes('--execute')||!key){console.log('План: --execute KEY-1; чтение одного HF-корня и его contains/Epic Link-потомков до задач, без записи в Jira. Отдельный временный кэш.');}
else{
 const directory=await mkdtemp(path.join(os.tmpdir(),'epic-hierarchy-jira-')),cutoff=new Date().toISOString();
 const service=new DatasetService(new CacheStore(directory),()=>cutoff,gatewayFromProfile(path.resolve('.local-data/jira-profile.json')));
 try{const job=service.importEpic(`https://hq.tutu.ru/browse/${key}`);await service.waitForIdle();if(job.status!=='completed'||!job.dataset?.hierarchy)throw new Error(job.errors.map(e=>e.message).join(' ')||'Импорт не завершён');
  const graph=job.dataset.hierarchy;
  const nodes=Object.values(graph.nodes).map(n=>{const last=n.history?.statusChanges.filter(c=>Date.parse(c.at)<=Date.parse(cutoff)).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||(a.order??0)-(b.order??0)).at(-1);return {key:n.key,type:n.type,resolution:n.resolution,subtask:n.type==='subtask',branchCoverage:n.branchCoverage,historyCoverage:n.historyCoverage,statusOnLoad:n.currentStatus,statusCategories:n.statusCategories,barState:n.timeline.state,end:n.timeline.end,closed:n.timeline.closed,lastTransition:last?{at:last.at,from:last.from,to:last.to}:null,closureDateMatches:n.timeline.closed&&n.timeline.end?Date.parse(n.timeline.end)===Date.parse(last?.at??n.created??''):null,warnings:n.timeline.warnings.map(w=>w.code)};});
  const restored=new DatasetService(new CacheStore(directory),()=>cutoff,async()=>{throw new Error('Запрос сети при восстановлении');});await restored.initialize();
  const report={checkedAt:cutoff,root:key,coverage:graph.coverage,nodes,edges:graph.edges.map(e=>({parent:graph.nodes[e.parent].key,child:graph.nodes[e.child].key})),offlineRestore:JSON.stringify(restored.getDataset())===JSON.stringify(job.dataset),reopenCases:Object.values(graph.nodes).filter(n=>n.timeline.intervals.some(i=>/закрыт|готово|done|closed|resolved/i.test(i.status))&&!n.timeline.closed).map(n=>n.key),note:'Проверка живого получения и восстановления; отсутствие конкретного случая не доказывает его приёмку.'};
  await writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({status:'completed',root:key,nodeCount:nodes.length,edgeCount:graph.edges.length,coverage:graph.coverage,offlineRestore:report.offlineRestore,report:path.join(directory,'report.json')}));
 }catch(e){console.log(JSON.stringify({status:'failed',error:e instanceof Error?e.message:safeError(e).message}));process.exitCode=1;}
}
