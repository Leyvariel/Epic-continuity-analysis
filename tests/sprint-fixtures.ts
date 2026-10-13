import type { HierarchyInput,HierarchyNodeInput } from '../shared/hierarchy';
import type { HistorySnapshot } from '../shared/contracts';
import type { SprintInputs,SprintRecord,SprintTaskInput } from '../shared/sprints';
export const at=(n:number)=>new Date(Date.UTC(2026,8,n)).toISOString();
export function history(key:string,windows:number[][]=[],status?:string):HistorySnapshot{
 let current='Open',id='1';const changes:HistorySnapshot['statusChanges']=[];
 for(const [a,b] of windows){changes.push({id:`${key}-${a}`,at:at(a),from:current,to:'Working',fromId:id,toId:'3'});current='Working';id='3';if(b){changes.push({id:`${key}-${b}`,at:at(b),from:current,to:'Done',fromId:id,toId:'6'});current='Done';id='6';}}
 if(status){current=status;id='10';}
 return {source:'jira',key,title:key,historyStart:at(1),updated:at(30),currentStatus:current,currentStatusId:id,resolution:'',assignee:'',issueType:'Task',importedAt:at(30),statusChanges:changes,flagChanges:[],currentFlag:false,flagAvailable:true,historyCount:changes.length,statusCoverage:'complete',flagCoverage:'complete',initialStateProven:true,proof:{expected:changes.length,received:changes.length,terminal:true,adapterVersion:'fixture'},warnings:[]};
}
export function node(id:string,type:HierarchyNodeInput['type']='task',windows:number[][]=[]):HierarchyNodeInput{
 const h=history(`A-${id}`,windows,type==='epic'?'[HF] Реализация':undefined);return {id,key:h.key,title:h.key,type,resolution:'',created:at(1),currentStatus:h.currentStatus,currentStatusId:h.currentStatusId,statusCategories:{'1':'new','3':'indeterminate','6':'done','10':'indeterminate'},history:h,historyCoverage:'complete',branchCoverage:'complete',warnings:[]};
}
export function sprint(id:string,start:number,end:number,state:SprintRecord['state']='closed',board='100'):SprintRecord{return {id,name:`S${id}`,state,startDate:at(start),endDate:at(end),completeDate:state==='closed'?at(end):null,activatedDate:at(start),originBoardId:board};}
export function task(id:string,sprints:string[]=['11','12','13']):SprintTaskInput{return {issueId:id,observedAt:at(30),sprintIds:sprints,changes:[],membershipCoverage:'complete',rosterCoverage:'complete',subtaskIds:[],uncertainSubtaskIds:[],calendarIds:['100'],calendarCoverage:'complete',warnings:[]};}
export function fixture(){
 const graph:HierarchyInput={version:1,asOf:at(30),roots:{'A-1':'1'},nodes:{'1':node('1','epic'),'2':node('2','epic'),'3':node('3','task',[[2,3]]),'4':node('4','epic'),'5':node('5')},edges:[{parent:'1',child:'2'},{parent:'2',child:'3'},{parent:'1',child:'4'},{parent:'4',child:'5'}],coverage:'complete',warnings:[]};
 const input:SprintInputs={version:1,asOf:at(30),mode:'current-subtasks',tasks:{'3':task('3'),'5':task('5')},sprints:{'11':sprint('11',1,8),'12':sprint('12',8,15),'13':sprint('13',15,22)},calendars:{'100':{boardId:'100',sprintIds:['11','12','13'],coverage:'complete',warnings:[]}},warnings:[]};
 return {graph,input};
}
