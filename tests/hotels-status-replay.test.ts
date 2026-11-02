import { expect, it } from 'vitest';
import data from '../docs/sdd/changes/archive/2026/LOCAL-20261015-01-expanded-status-model/evidence/hotels-12351-statuses-20261102.json';
import { calculateJiraTimeline } from '../server/jira/normalize';
import { metricsFor } from '../shared/metrics';
import type { HistorySnapshot } from '../shared/contracts';

it('HOTELS-12351 status-only replay preserves the historical 8-second Decided stage and testing',()=>{
 const history:HistorySnapshot={source:'jira',key:data.key,title:data.key,historyStart:data.created,updated:data.updated,
  currentStatus:data.currentStatus.name,currentStatusId:data.currentStatus.id,resolution:data.resolution,assignee:'',issueType:data.issueType.name,
  importedAt:data.checkedAt,statusChanges:data.statusTransitions.map((c,order)=>({id:c.historyId,order,at:c.at,from:c.fromString,to:c.toString,fromId:c.from,toId:c.to})),
  statusCoverage:'complete',initialStateProven:true,proof:{expected:data.changelog.total,received:data.changelog.received,terminal:true,adapterVersion:'status-only-recorded-replay'},
  historyCount:data.changelog.total,flagChanges:[],currentFlag:false,flagAvailable:false,flagCoverage:'unavailable',warnings:[]};
 const r=calculateJiraTimeline({key:data.key,title:data.key,type:'HF',resolution:data.resolution,excelAggregates:{}},history,data.checkedAt);
 expect(r.start).toBe(new Date(data.statusTransitions[0].at).toISOString());
 expect(r.durations?.decided).toBe(8000);
 expect(r.durations?.['epic-testing']).toBe(Date.parse(data.statusTransitions[7].at)-Date.parse(data.statusTransitions[6].at));
 expect(r.ttmMs).toBe(Date.parse(data.statusTransitions[7].at)-Date.parse(data.statusTransitions[0].at));
 expect(r.ttmWithoutFlagMs).toBeNull();
 expect(metricsFor([r],'history').map(c=>c.id)).toEqual(['ttm','ttmWithoutFlag','preparation','validation','decided','solution','ready','implementation','epic-testing']);
});
