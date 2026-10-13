import { JiraClient } from '../../../../../../../server/jira/client.ts';
import { DatasetService } from '../../../../../../../server/service.ts';
import { relatedTimeline } from '../../../../../../../server/related-timeline.ts';
import type { HistorySnapshot, JiraCacheState } from '../../../../../../../shared/contracts.ts';
import type { HierarchyNodeInput } from '../../../../../../../shared/hierarchy.ts';
import type { JiraGateway, JiraIssue } from '../../../../../../../server/jira/ports.ts';
import type { CacheStore } from '../../../../../../../server/cache.ts';

async function main() {
const created = '2026-09-01T00:00:00+03:00', cut = '2026-09-10T10:00:00+03:00', after = '2026-09-10T10:01:00+03:00';
const h: HistorySnapshot = {
  source: 'jira', key: 'DEMO-2', title: 'Вымышленная задача', historyStart: created, updated: after,
  currentStatus: 'Открыто', currentStatusId: 'new', resolution: '', assignee: '', issueType: 'Задача', importedAt: after,
  statusChanges: [{id: '1', at: after, from: 'В работе', fromId: 'work', to: 'Открыто', toId: 'new'}],
  flagChanges: [], currentFlag: false, flagAvailable: true, historyCount: 1,
  statusCoverage: 'complete', flagCoverage: 'complete', initialStateProven: true,
  proof: {expected: 1, received: 1, terminal: true, adapterVersion: 'synthetic-review'}, warnings: [],
};
const n: HierarchyNodeInput = {
 id: '2', key: 'DEMO-2', title: h.title, type: 'task', resolution: '', created,
 currentStatus: h.currentStatus, currentStatusId: 'new', statusCategories: {work: 'indeterminate', new: 'new'},
 history: h, historyCoverage: 'complete', branchCoverage: 'complete', warnings: [],
};
const full = relatedTimeline(n, cut);
const prematurelyFiltered = relatedTimeline({...n, history: {...h, statusChanges: h.statusChanges.filter(c => Date.parse(c.at) <= Date.parse(cut))}}, cut);
if (full.intervals[0]?.status !== 'В работе' || prematurelyFiltered.intervals[0]?.status !== 'Открыто') throw new Error('Неожиданный результат временного контрпримера');

let requests = 0, childFailure = '', writes = 0, failChild = false;
const client = new JiraClient('synthetic-no-real-credential', {
  fetcher: async () => {requests++; return new Response('', {status: 500});}, delay: async () => {},
});
const root: JiraIssue = {
  id: '1', key: 'DEMO-1', title: 'Вымышленный эпик', flow: 'HF', isEpic: true, isSubtask: false,
  resolution: '', currentStatus: '[HF] Реализация', currentStatusId: 'root-work', statusCategory: 'indeterminate',
  created, updated: created, assignee: '', issueType: 'Эпик', linksKnown: true,
  links: [{parent: '1', child: '2', childKey: 'DEMO-2'}],
};
const child: JiraIssue = {...root, id: '2', key: 'DEMO-2', title: h.title, flow: 'unknown', isEpic: false, links: [], currentStatus: 'В работе', currentStatusId: 'work'};
const gateway: JiraGateway = {
  getIssue: async id => {
    if (id === '1' || id === 'DEMO-1') return root;
    if (failChild) try {await client.get('/rest/api/2/issue/2', {}, new AbortController().signal);} catch(e) {childFailure = (e as {code: string}).code; throw e;}
    return child;
  },
  getHistory: async issue => ({...h, key: issue.key, title: issue.title, updated: issue.updated,
    currentStatus: issue.currentStatus, currentStatusId: issue.currentStatusId, statusChanges: [], historyCount: 0,
    proof: {...h.proof, expected: 0, received: 0}}),
  getStatusCategories: async () => ({'root-work': 'indeterminate', work: 'indeterminate'}),
  readBoard: async () => {throw new Error('Не используется');},
};
let saved: JiraCacheState | null = null;
const cache = {read: async () => null, write: async (state: JiraCacheState) => {writes++; saved = state;}} as unknown as CacheStore;
const service = new DatasetService(cache, () => cut, async () => gateway);
await service.initialize();
const initial = service.importKeys('DEMO-1'); await service.waitForIdle();
if (initial.status !== 'completed' || !service.getDataset()) throw new Error('Синтетический исходный набор не подготовлен');
const previousId = service.getDataset()!.id;
failChild = true;
const refresh = service.refresh(previousId); await service.waitForIdle();
const current = service.getDataset()!;
if (requests !== 3 || childFailure !== 'JIRA_HTTP' || refresh.status !== 'completed' || current.id === previousId || writes !== 2) throw new Error('Неожиданный результат проверки обработки HTTP');
console.log(JSON.stringify({
  note: 'Проверки действующего кода с вымышленными данными, подставным fetch и кэшем в памяти. Новая функция спринтов не тестировалась.',
  postCutoff: {asOf: cut, eventAt: after, fullHistoryStatus: full.intervals[0]?.status, earlyFilteredStatus: prematurelyFiltered.intervals[0]?.status},
  exhaustedHttp: {syntheticHttpAttempts: requests, errorCode: childFailure, refreshStatus: refresh.status, datasetReplaced: current.id !== previousId, memoryCacheWrites: writes},
  liveJiraRequests: 0, workingCacheWrites: 0,
}, null, 2));
client.close();
}
main().catch(e => {console.error(e); process.exitCode = 1;});
