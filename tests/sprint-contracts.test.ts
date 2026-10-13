import { describe, it, expect } from 'vitest';
import { sprintInputsSchema, sprintLinkErrors } from '../server/jira/sprint-schema';
import type { SprintInputs } from '../shared/sprints';
const asOf='2026-09-29T00:00:00Z';
const base=():SprintInputs=>({version:1,asOf,mode:'current-subtasks',tasks:{},sprints:{},calendars:{},warnings:[]});
describe('T001: persisted sprint contract',()=>{
 it('rejects a future version and silently discarded extra properties',()=>{expect(sprintInputsSchema.safeParse({...base(),version:2}).success).toBe(false);expect(sprintInputsSchema.safeParse({...base(),futureField:true}).success).toBe(false);});
 it('preserves an empty optional supplement and future without dates',()=>{const s={id:'1',name:'Next',state:'future',startDate:null,endDate:null,completeDate:null,activatedDate:null,originBoardId:'2'};expect(sprintInputsSchema.parse({...base(),sprints:{'1':s}}).sprints['1']).toEqual(s);});
 it('rejects duplicate identities and malformed dates',()=>{const t={issueId:'1',observedAt:asOf,sprintIds:['4','4'],changes:[],membershipCoverage:'complete',rosterCoverage:'complete',subtaskIds:[],uncertainSubtaskIds:[],calendarIds:[],calendarCoverage:'complete',warnings:[]};expect(sprintInputsSchema.safeParse({...base(),tasks:{'1':t}}).success).toBe(false);expect(sprintInputsSchema.safeParse({...base(),asOf:'not-a-date'}).success).toBe(false);});
 it('rejects absent hierarchy, wrong cutoff, and dangling nodes',()=>{const input=base();expect(sprintLinkErrors(input,undefined).length).toBeGreaterThan(0);const g:any={version:1,asOf:'2026-09-28T00:00:00Z',roots:{},nodes:{},edges:[],coverage:'complete',warnings:[]};expect(sprintLinkErrors(input,g).length).toBeGreaterThan(0);});
});
