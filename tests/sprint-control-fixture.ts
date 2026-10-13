import {fixture,node,task,sprint,history} from './sprint-fixtures';
import type {HierarchyNodeInput} from '../shared/hierarchy';
export const t=(day:string)=>`${day}T00:00:00+03:00`;
function timeline(n:HierarchyNodeInput,created:string,stages:[string,string,string][],terminal:[string,string]){
 n.created=created;n.history=history(n.key);n.history.historyStart=created;n.history.updated=t('2026-09-15');n.history.currentStatus=terminal[0];n.history.currentStatusId=terminal[1];
 n.history.statusChanges=stages.map(([date,to,id],i)=>({id:String(i),at:date,from:i?stages[i-1][1]:'Open',fromId:i?stages[i-1][2]:'1',to,toId:id}));
 n.currentStatus=terminal[0];n.currentStatusId=terminal[1];n.statusCategories={...n.statusCategories,'1':'new','3':'indeterminate','6':'done'};
}
export function controlFixture(){
 const {graph,input}=fixture();graph.asOf=input.asOf=t('2026-09-15');
 graph.nodes['3']=node('3');graph.nodes['5']=node('5');graph.nodes['6']=node('6');graph.nodes['7']=node('7','subtask');graph.edges.push({parent:'4',child:'6'},{parent:'4',child:'3'});
 for(const n of Object.values(graph.nodes))timeline(n,t('2026-06-01'),[],['Open','1']);
 const stages:[string,string,string][]=[['2026-06-01','[HF] Подготовка','10'],['2026-06-08','[HF] Проверка идей','11'],['2026-06-22','[HF] Отложено','12'],['2026-06-29','[HF] Валидация','13'],['2026-07-13','[HF] Реализация','14'],['2026-08-10','[HF] Запланировано','15'],['2026-08-17','[HF] Оценка результата','16'],['2026-09-14','[HF] Закрыт','6']].map(([d,s,i])=>[t(d),s,i]);
 timeline(graph.nodes['1'],t('2026-06-01'),stages,['[HF] Закрыт','6']);
 const work=(id:string,windows:string[][])=>timeline(graph.nodes[id],t('2026-06-01'),windows.flatMap(([a,b])=>[[t(a),'Work','3'],[t(b),'Done','6']] as [string,string,string][]),['Done','6']);
 work('7',[['2026-06-10','2026-06-11'],['2026-08-25','2026-08-26']]);work('5',[['2026-07-01','2026-07-02'],['2026-08-01','2026-08-02']]);work('6',[['2026-07-19','2026-07-20']]);
 const a=['2026-06-01','2026-06-15','2026-06-29','2026-07-13','2026-07-27','2026-08-10','2026-08-24','2026-09-07','2026-09-14'];
 input.sprints={};for(let i=0;i<8;i++){const id=String(11+i);input.sprints[id]={...sprint(id,1,2),name:`A${i+1}`,startDate:t(a[i]),completeDate:t(a[i+1]),endDate:t(i===7?'2026-09-21':a[i+1]),activatedDate:t(a[i])};}
 for(const [id,name,start,end] of [['21','B1','2026-07-18','2026-08-01'],['22','B2','2026-08-01','2026-08-15']])input.sprints[id]={...sprint(id,1,2,'closed','200'),name,startDate:t(start),completeDate:t(end),endDate:t(end),activatedDate:t(start)};
 input.calendars={'100':{boardId:'100',sprintIds:a.slice(0,-1).map((_,i)=>String(i+11)),coverage:'complete',warnings:[]},'200':{boardId:'200',sprintIds:['21','22'],coverage:'complete',warnings:[]}};
 input.tasks={'3':{...task('3',['11','17']),subtaskIds:['7']},'5':task('5',['13','15']),'6':{...task('6',['21']),calendarIds:['200']}};
 return {graph,input};
}
