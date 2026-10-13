import type {JiraInputs,HistorySnapshot} from '../shared/contracts';
import {fixture,at} from './sprint-fixtures';
export function sprintDatasetInputs():JiraInputs{
 const {graph,input}=fixture();return {hierarchy:graph,sprintInputs:input,source:{kind:'epic',origin:'https://hq.tutu.ru',requestedKey:'A-1',key:'A-1',issueId:'1',url:'https://hq.tutu.ru/browse/A-1',historyMode:'jira'},candidates:[{requestedKey:'A-1',rows:[],issueId:'1'}],audit:{sourceCoverage:'complete',eligibilityCoverage:'complete',inputRows:1,duplicates:0,resolvedIssues:1,entries:[{requestedKey:'A-1',rows:[],issueId:'1',key:'A-1',decision:'included',reason:'HF'}]},asOf:at(30),syncStartedAt:at(30),syncFinishedAt:at(30),epics:[{key:'A-1',title:'Root',type:'HF',resolution:'',excelAggregates:{}}],histories:{'jira:1':graph.nodes['1'].history as HistorySnapshot},historyWarnings:{},warnings:[]};
}
