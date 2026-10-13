// @vitest-environment jsdom
import {it,expect,vi} from 'vitest';
import {act} from 'react';import {createRoot} from 'react-dom/client';import {SourceForm} from '../src/SourceForm';
it('T008: автономный выбор источника передаёт file без автоматической загрузки',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const div=document.createElement('div'),r=createRoot(div),submit=vi.fn(async()=>{});document.body.append(div);
 try{await act(()=>r.render(<SourceForm busy={false} onSubmit={submit}/>));const select=div.querySelector<HTMLSelectElement>('select[aria-label="Источник истории файла"]')!;expect(select).not.toBeNull();await act(()=>{select.value='file';select.dispatchEvent(new Event('change',{bubbles:true}));});expect(submit).not.toHaveBeenCalled();const input=div.querySelector<HTMLInputElement>('input[type=file]')!;expect(input.accept).toBe('.xlsx');Object.defineProperty(input,'files',{value:[new File(['example'],'example.xlsx')],configurable:true});await act(()=>input.dispatchEvent(new Event('change',{bubbles:true})));expect(submit).toHaveBeenCalledWith(expect.objectContaining({historyMode:'file'}));}
 finally{await act(()=>r.unmount());div.remove();}
});

it('отклоняет CSV в автономном режиме с понятным сообщением',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const div=document.createElement('div'),r=createRoot(div),submit=vi.fn(async()=>{});document.body.append(div);
 try{await act(()=>r.render(<SourceForm busy={false} onSubmit={submit}/>));const select=div.querySelector<HTMLSelectElement>('select')!;await act(()=>{select.value='file';select.dispatchEvent(new Event('change',{bubbles:true}));});const input=div.querySelector<HTMLInputElement>('input[type=file]')!;Object.defineProperty(input,'files',{value:[new File(['Ключ'],'keys.csv')],configurable:true});await act(()=>input.dispatchEvent(new Event('change',{bubbles:true})));expect(submit).not.toHaveBeenCalled();expect(div.querySelector('[role=alert]')?.textContent).toContain('только XLSX');}
 finally{await act(()=>r.unmount());div.remove();}
});
