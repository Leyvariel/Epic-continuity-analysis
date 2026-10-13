import {afterEach,expect,it,vi} from 'vitest';
import {execFile} from 'node:child_process';
import {readPat} from '../server/jira/keychain';
import {safeError} from '../server/errors';
vi.mock('node:child_process',()=>({execFile:vi.fn()}));
afterEach(()=>vi.resetAllMocks());
const mock=vi.mocked(execFile);
it('AC-093: selects the exact account and rereads the rotated value',async()=>{
 let value='synthetic-before';
 mock.mockImplementation(((...args:any[])=>{args.at(-1)(null,value);return {} as any;}) as any);
 const signal=new AbortController().signal;
 expect(await readPat(signal)).toBe('synthetic-before');value='synthetic-after';expect(await readPat(signal)).toBe('synthetic-after');
 expect(mock).toHaveBeenCalledTimes(2);
 for(const call of mock.mock.calls)expect(call[1]).toEqual(['find-generic-password','-s','Code Jira Relations PAT','-a','leyva@tutu.tech','-w']);
});
it('AC-093: fallback keeps the account; rejection does not expose native output',async()=>{
 let calls=0;
 mock.mockImplementation(((...args:any[])=>{calls++;args.at(-1)(calls===1?{code:44,stderr:'synthetic-secret'}:null,'synthetic-secret');return {} as any;}) as any);
 expect(await readPat(new AbortController().signal)).toBe('synthetic-secret');
 expect(mock.mock.calls[1][1]).toEqual(['find-generic-password','-s','tutu-jira','-a','leyva@tutu.tech','-w']);
 mock.mockClear();mock.mockImplementation(((...args:any[])=>{args.at(-1)({code:36,stderr:'synthetic-secret'},'synthetic-secret');return {} as any;}) as any);
 const error=await readPat(new AbortController().signal).catch(e=>e);
 expect(safeError(error).code).toBe('KEYCHAIN_DENIED');expect(JSON.stringify(safeError(error))).not.toContain('synthetic-secret');expect(mock).toHaveBeenCalledTimes(1);
});
