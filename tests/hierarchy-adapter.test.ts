import { describe, it, expect, vi } from 'vitest';
import { ServerJiraAdapter } from '../server/jira/adapter';
const profile = { version: '9.12.10' as const, epicTypeIds: ['6'], flagFieldId: 'customfield_10000', flagOptionId: '10000', historyMode: 'issue-expand' as const, flowRule: 'status-prefix' as const };
const raw = (inverse = false) => ({ id: inverse ? '2' : '1', key: inverse ? 'B-1' : 'A-1', fields: { summary: 'Тест', issuetype: { id: '6', name: 'Эпик', subtask: false }, status: { id: '10', name: '[DF] Закрыт', statusCategory: { key: 'done' } }, resolution: null, created: '2026-09-01T00:00:00+03:00', updated: '2026-09-02T00:00:00+03:00', issuelinks: [{ type: { outward: 'contains', inward: 'is contained in' }, ...(inverse ? { inwardIssue: { id: '1', key: 'A-1' } } : { outwardIssue: { id: '2', key: 'B-1' } }) }] } });
describe('T002: связи и типы Jira', () => {
  it('прямая и обратная стороны дают одинаковое направление', async () => {
    for (const inverse of [false, true]) {
      const issue = await new ServerJiraAdapter({ get: vi.fn(async (url: string) => url.includes('/epic/') ? { startAt: 0, total: 0, issues: [] } : raw(inverse)) }, profile).getIssue('1', new AbortController().signal);
      expect(issue.links).toMatchObject([{ parent: '1', child: '2' }]);
      expect(issue).toMatchObject({ linksKnown: true, isSubtask: false, statusCategory: 'done' });
    }
  });
  it('повреждённые связи не теряют исходную метаинформацию', async () => {
    const value = raw(); value.fields.issuelinks = [{}] as never;
    const issue = await new ServerJiraAdapter({ get: vi.fn().mockResolvedValue(value) }, profile).getIssue('1', new AbortController().signal);
    expect(issue.key).toBe('A-1'); expect(issue.linksKnown).toBe(false); expect(issue.hierarchyWarnings?.length).toBeGreaterThan(0);
  });
});

it('не превращает blocks в contains, сохраняет признак подзадачи и пустую ветку',async()=>{
 const value=raw();value.fields.issuetype.subtask=true;value.fields.issuelinks[0].type={outward:'blocks',inward:'is blocked by'};
 const adapter=new ServerJiraAdapter({get:vi.fn().mockResolvedValue(value)},profile);const issue=await adapter.getIssue('1',new AbortController().signal);expect(issue.links).toEqual([]);expect(issue.isSubtask).toBe(true);
 value.fields.issuelinks=[];expect((await adapter.getIssue('1',new AbortController().signal)).linksKnown).toBe(true);
});
