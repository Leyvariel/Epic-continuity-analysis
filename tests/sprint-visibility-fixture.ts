import {fixture,node,sprint,at} from './sprint-fixtures';
export function visibilityFixture(){
 const f=fixture(),n=f.graph.nodes['3']=node('3','task',[[7,20]]);n.created=n.history!.historyStart=at(5);
 f.input.sprints={'11':sprint('11',1,8),'12':sprint('12',8,15),'13':sprint('13',15,22),'14':sprint('14',22,29),'15':sprint('15',1,5),'16':sprint('16',1,6),'17':sprint('17',18,25)};
 f.input.calendars['100'].sprintIds=Object.keys(f.input.sprints);f.input.tasks['3'].sprintIds=['11','17'];return f;
}
