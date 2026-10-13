// Диагностика D1/D2: только GET, без изменения Jira и рабочего кэша.
import { readPat } from '../server/jira/keychain';
import { JiraClient } from '../server/jira/client';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const evidence = `${root}docs/sdd/changes/archive/2026/LOCAL-20260929-01-sprint-continuity/evidence/`;
const selectedKeys = ['HOTELS-14091', 'HOTELS-14245', 'ANL-20734'];
const cleanSprint = (s: any) => s && typeof s === 'object' ? Object.fromEntries(['id','state','name','startDate','endDate','completeDate','activatedDate','originBoardId'].filter(k => Object.hasOwn(s,k)).map(k => [k,s[k]])) : null;
const ref = (s: any) => s ? {id:s.id,key:s.key} : null;
async function main() {
  if (process.argv.slice(2).join(' ') !== '--execute') { console.log('Диагностика: три задачи, до 3 календарей по 20 страниц дважды, до 8 подзадач из текущего графа; только GET. Запуск: --execute'); return; }
  const signal = AbortSignal.timeout(600_000), client = new JiraClient(await readPat(signal));
  const report: any = {startedAt:new Date().toISOString(),scope:'D1/D2: GET Jira, без записи рабочего кэша',requests:[],issues:[],sprints:[],calendars:[],subtasks:[],parents:[]};
  let calls = 0;
  async function get(path: string, params: Record<string,string> = {}): Promise<any> {
    if (++calls > 150) throw new Error('DIAGNOSTIC_LIMIT');
    const start=Date.now();
    try { const r=await client.get(path,params,signal);report.requests.push({path,elapsedMs:Date.now()-start,result:'ok'});return r; }
    catch(e:any) { report.requests.push({path,elapsedMs:Date.now()-start,result:e.code??'ERROR'});if(['JIRA_UNAUTHORIZED','JIRA_NETWORK','ABORTED','RATE_LIMITED'].includes(e.code))throw e;return null; }
  }
  function issue(raw: any, sprintField: string) {
    if (!raw) return null;
    const f=raw.fields,h=raw.changelog,records=h?.histories??[];
    return {id:raw.id,key:raw.key,created:f.created,updated:f.updated,status:{id:f.status?.id,name:f.status?.name,category:f.status?.statusCategory?.key},type:{id:f.issuetype?.id,subtask:f.issuetype?.subtask},parent:ref(f.parent),subtasksFieldPresent:Object.hasOwn(f,'subtasks'),subtasks:(f.subtasks??[]).map(ref),
      sprintRaw:f[sprintField]===null?null:Array.isArray(f[sprintField])?f[sprintField].map((s:any)=>typeof s==='string'?s.split(',goal=')[0]+',goal=<omitted>]':cleanSprint(s)):undefined,
      history:{startAt:h?.startAt,total:h?.total,received:records.length,unique:new Set(records.map((r:any)=>r.id)).size,fieldNames:[...new Set(records.flatMap((r:any)=>r.items.map((i:any)=>i.field)))],changes:records.flatMap((r:any)=>r.items.filter((i:any)=>i.field==='Sprint'||i.fieldId===sprintField||/^(status|parent|subtasks|issueparentassociation)$/i.test(i.field)).map((i:any)=>({id:r.id,at:r.created,field:i.field,fieldId:i.fieldId,from:i.from,to:i.to,fromString:i.fromString,toString:i.toString})))}};
  }
  try {
    report.version=(await get('/rest/api/2/serverInfo'))?.version;
    const fields=await get('/rest/api/2/field');
    report.sprintFields=(fields??[]).filter((f:any)=>f.schema?.custom==='com.pyxis.greenhopper.jira:gh-sprint').map((f:any)=>({id:f.id,name:f.name,schema:f.schema}));
    if(report.sprintFields.length!==1)throw new Error('SPRINT_FIELD_AMBIGUOUS');
    const sf=report.sprintFields[0].id, requestedFields=`status,parent,subtasks,issuetype,created,updated,${sf}`;
    const statusList=await get('/rest/api/2/status');report.statusCategories=(statusList??[]).map((s:any)=>({id:s.id,name:s.name,category:s.statusCategory?.key,categoryName:s.statusCategory?.name}));
    const sprintIds=new Set<string>(),boardIds=new Set<string>();
    for(const key of selectedKeys) {
      const raw=await get(`/rest/api/2/issue/${key}`,{fields:requestedFields,expand:'changelog'}),v=issue(raw,sf);if(!v)continue;
      const agile=await get(`/rest/agile/1.0/issue/${key}`,{fields:'sprint,closedSprints'});
      const versioned=await get(`/rest/api/2/issue/${key}`,{fields:sf,expand:'versionedRepresentations'});
      const v2=versioned?.versionedRepresentations?.[sf]?.['2'];
      const sprints=[...(agile?.fields?.closedSprints??[]),...(agile?.fields?.sprint?[agile.fields.sprint]:[])].map(cleanSprint);
      for(const s of sprints)if(s?.id)sprintIds.add(String(s.id));
      for(const c of v.history.changes.filter((c:any)=>c.field==='Sprint'))for(const value of [c.from,c.to])if(typeof value==='string'&&/^\d+(?:,\s*\d+)*$/.test(value))for(const id of value.split(/,\s*/))sprintIds.add(id);
      report.issues.push({...v,agileSprints:sprints,versionedSprintV2:Array.isArray(v2)?v2.map(cleanSprint):null});
    }
    for(const id of [...sprintIds].slice(0,16)) {
      const raw=await get(`/rest/agile/1.0/sprint/${id}`);report.sprints.push(raw?cleanSprint(raw):{id,unavailable:true});if(raw?.originBoardId)boardIds.add(String(raw.originBoardId));
    }
    async function calendar(boardId:string) {
      const values:any[]=[],pages:any[]=[],seen=new Set<number>();let startAt=0,complete=false;
      for(let page=0;page<20;page++) {
        const r=await get(`/rest/agile/1.0/board/${boardId}/sprint`,{startAt:String(startAt),maxResults:'100'});if(!r)break;
        pages.push({requestedStart:startAt,startAt:r.startAt,maxResults:r.maxResults,total:r.total,isLast:r.isLast,count:r.values?.length,keys:Object.keys(r)});
        if(r.startAt!==startAt||!Array.isArray(r.values)||r.values.some((s:any)=>seen.has(s.id)))break;
        for(const s of r.values){seen.add(s.id);values.push(cleanSprint(s));}
        if(r.isLast===true){complete=true;break;}
        if(r.isLast===undefined && Number.isInteger(r.total) && startAt+r.values.length===r.total){complete=true;break;}
        if(!r.values.length)break;startAt+=r.values.length;
      }
      return {pages,values,complete};
    }
    for(const boardId of [...boardIds].slice(0,3)) { const first=await calendar(boardId),second=await calendar(boardId);report.calendars.push({boardId,first,second,stable:JSON.stringify(first.values)===JSON.stringify(second.values)});console.log(JSON.stringify({phase:'calendar',boardId,count:first.values.length,complete:first.complete&&second.complete})); }
    // Поиск только среди текущих обычных потомков уже загруженных эпиков приложения.
    const cache=JSON.parse(await readFile(`${root}.local-data/dataset.json`,'utf8'));
    const keys=Object.values(cache.inputs?.hierarchy?.nodes??{}).filter((n:any)=>n.type==='task'&&/^[A-Z][A-Z0-9_]*-\d+$/.test(n.key)).map((n:any)=>n.key).sort().slice(0,200);
    report.parentSearchScope={count:keys.length,keys};
    if(keys.length) {
      const found=await get('/rest/api/2/search',{jql:`parent in (${keys.join(',')}) ORDER BY key ASC`,fields:'parent,issuetype',maxResults:'8'});
      report.subtaskSearch={total:found?.total,received:found?.issues?.length,startAt:found?.startAt};
      const parents=new Set<string>();
      for(const item of found?.issues??[]) {
        const v=issue(await get(`/rest/api/2/issue/${item.key}`,{fields:requestedFields,expand:'changelog'}),sf);if(v){report.subtasks.push(v);if(v.parent?.key)parents.add(v.parent.key);}
      }
      for(const key of [...parents].slice(0,3)) {
        const v=issue(await get(`/rest/api/2/issue/${key}`,{fields:requestedFields,expand:'changelog'}),sf);if(v)report.parents.push(v);
      }
    }
    for(const original of report.issues) {
      const after=issue(await get(`/rest/api/2/issue/${original.key}`,{fields:requestedFields,expand:'changelog'}),sf);
      original.stability={matched:after!==null && JSON.stringify(after)===JSON.stringify(Object.fromEntries(Object.entries(original).filter(([k])=>k!=='agileSprints'&&k!=='versionedSprintV2')))};
    }
  } catch(e:any) {report.error=e.code??(e.message==='DIAGNOSTIC_LIMIT'?'DIAGNOSTIC_LIMIT':'DIAGNOSTIC_FAILED');process.exitCode=1;}
  finally {client.close();report.finishedAt=new Date().toISOString();await writeFile(`${evidence}jira-d1-d2.json`,JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({file:'evidence/jira-d1-d2.json',version:report.version,calls,error:report.error,issues:report.issues.length,calendars:report.calendars.length,subtaskSearch:report.subtaskSearch,subtasks:report.subtasks.length,parents:report.parents.length}));}
}
main().catch((e:any)=>{console.log(JSON.stringify({error:e.code??'DIAGNOSTIC_FAILED'}));process.exitCode=1;});
