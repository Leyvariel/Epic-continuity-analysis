import {it,expect,vi} from 'vitest';
import {sprintIdSet,parseSprint,readSprintCalendar} from '../server/jira/sprints';
const signal=new AbortController().signal;
it('ID history accepts only strict decimal sets, never names or Java strings',()=>{expect(sprintIdSet('12, 14')).toEqual(['12','14']);expect(sprintIdSet(null)).toEqual([]);expect(()=>sprintIdSet('sprint 12')).toThrow();expect(()=>sprintIdSet('12, 12')).toThrow();expect(()=>sprintIdSet(undefined)).toThrow();});
it('metadata uses own IDs and dates, including valid future without dates',()=>{expect(parseSprint({id:13,state:'future',name:'wrong date 2020',originBoardId:10})).toMatchObject({id:'13',startDate:null,originBoardId:'10',state:'future'});expect(()=>parseSprint({id:13,state:'closed',name:'x',startDate:'yesterday'})).toThrow();});
it('calendar follows isLast and actual page count, does not require total',async()=>{const get=vi.fn(async(_p:string,q:Record<string,string>)=>q.startAt==='0'?{startAt:0,isLast:false,values:[{id:1,name:'one',state:'future'}]}:{startAt:1,isLast:true,values:[{id:2,name:'two',state:'future'}]});expect((await readSprintCalendar({get},'1',signal)).map(s=>s.id)).toEqual(['1','2']);expect(get.mock.calls[1][1].startAt).toBe('1');});
it('duplicate or missing pages cannot establish completeness',async()=>{await expect(readSprintCalendar({get:async()=>({startAt:0,isLast:false,values:[]})},'1',signal)).rejects.toThrow();await expect(readSprintCalendar({get:async(_p,q)=>({startAt:Number(q.startAt),isLast:q.startAt!=='0',values:[{id:1,state:'future',name:'same'}]})},'1',signal)).rejects.toThrow();});
it('200th final page accepted, a nonterminal 200th page never implies completeness',async()=>{
 const client={get:async(_p:string,q:Record<string,string>)=>({startAt:Number(q.startAt),isLast:Number(q.startAt)===199,values:[{id:Number(q.startAt)+1,name:'Future',state:'future'}]})};
 expect(await readSprintCalendar(client,'1',new AbortController().signal)).toHaveLength(200);
 client.get=async(_p,q)=>({startAt:Number(q.startAt),isLast:false,values:[{id:Number(q.startAt)+1,name:'Future',state:'future'}]});
 await expect(readSprintCalendar(client,'1',new AbortController().signal)).rejects.toThrow(/предел страниц/);
});
