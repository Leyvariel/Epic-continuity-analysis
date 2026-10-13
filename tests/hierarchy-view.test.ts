import { describe, it, expect } from 'vitest';
import { childrenOf } from '../shared/hierarchy-view';
import { graph, node } from './hierarchy-fixtures';
describe('T003: видимые дети', () => {
  it('исключает реальную резолюцию Не будет выполняться и сохраняет потомков скрытого эпика', () => {
    const g = graph(); g.nodes['R-1'].resolution = 'Не будет выполняться'; g.nodes['C-1'].resolution = 'Не будет выполняться';
    const children = childrenOf(g, 'A-1').children;
    expect(children.map(child => child.id)).not.toContain('R-1');
    expect(children.map(child => child.id)).not.toContain('C-1');
    expect(children.find(child => child.id === 'V-1')?.via).toEqual(['R-1']);
  });
  it('общий ребёнок доступен под обоими родителями; подзадача исключена', () => {
    const g=graph(); expect(childrenOf(g,'A-1').children.map(x=>x.id)).toContain('C-1'); expect(childrenOf(g,'B-1').children.map(x=>x.id)).toEqual(['C-1']);
  });
  it('продвигает потомка скрытого отклонённого эпика и останавливает цикл', () => {
    const g=graph(); g.nodes['R-1'].resolution='Отклонено'; g.edges.push({parent:'B-1',child:'A-1'});
    expect(childrenOf(g,'A-1').children.find(x=>x.id==='V-1')?.via).toEqual(['R-1']);
    expect(childrenOf(g,'B-1',['A-1']).warnings.join(' ')).toMatch(/цикл/i);
  });
  it('граф скрытых общих узлов не размножает допустимого ребёнка', () => {
    const g=graph();g.edges=[];g.nodes['R-1'].resolution='Отклонено'; let previous=['A-1'];
    for(let level=0;level<20;level++){const next=[`X-${level*2+1}`,`X-${level*2+2}`];for(const id of next){g.nodes[id]={...node(id),resolution:'Отклонено'};for(const parent of previous)g.edges.push({parent,child:id});}previous=next;}
    for(const parent of previous)g.edges.push({parent,child:'V-1'});
    expect(childrenOf(g,'A-1').children.map(x=>x.id)).toEqual(['V-1']);
  });
});
