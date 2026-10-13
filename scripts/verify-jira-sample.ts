import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { JiraClient } from '../server/jira/client';
import { readPat } from '../server/jira/keychain';
import { safeError } from '../server/errors';

const named = z.object({ id: z.string(), name: z.string() });
const fields = z.object({ summary: z.string(), status: named, issuetype: named, resolution: named.nullable(), created: z.string(), updated: z.string(),
  customfield_10000: z.array(z.object({ id: z.string(), value: z.string() })).nullable().optional(),
  customfield_43824: z.object({ id: z.string(), value: z.string() }).nullable().optional(),
});
const issue = z.object({ id: z.string().regex(/^\d+$/), key: z.string().regex(/^[A-Z][A-Z0-9_]*-\d+$/), fields });
const history = z.object({ id: z.string(), created: z.string(), items: z.array(z.object({ field: z.string(), fieldId: z.string().optional(), fieldtype: z.string().optional(), from: z.string().nullable().optional(), to: z.string().nullable().optional(), fromString: z.string().nullable().optional(), toString: z.string().nullable().optional() })) });
const fieldList = 'summary,status,issuetype,resolution,created,updated,customfield_10000,customfield_43824';
interface Dependencies { credentials: (signal: AbortSignal) => Promise<string>; get?: (path: string, params: Record<string, string>, signal: AbortSignal) => Promise<unknown>; save: (report: unknown) => Promise<void> }
export async function verifyBoardSample(execute: boolean, deps: Dependencies) {
  const plan = { origin: 'https://hq.tutu.ru', requests: [
    { method: 'GET', path: '/rest/api/2/filter/33407' },
    { method: 'GET', path: '/rest/agile/1.0/board/1482/issue', params: { startAt: '0', maxResults: '50', fields: fieldList } },
    { method: 'GET', path: '/rest/api/2/issue/<id первых не более 3 задач>', params: { fields: fieldList, expand: 'changelog' } },
  ], output: '.local-data/jira-sample.json' };
  if (!execute) return { mode: 'dry-run', ...plan, note: 'Требуется отдельное разрешение; прежние четыре GET эту выборку не разрешают.' };
  const controller = new AbortController(), client = new JiraClient(await deps.credentials(controller.signal));
  const get = deps.get ?? ((path: string, params: Record<string, string>, signal: AbortSignal) => client.get(path, params, signal));
  try {
    const filter = z.object({ id: z.string(), name: z.string(), jql: z.string() }).parse(await get('/rest/api/2/filter/33407', {}, controller.signal));
    const boardPage = z.object({ startAt: z.number(), total: z.number(), maxResults: z.number(), issues: z.array(issue) }).parse(await get('/rest/agile/1.0/board/1482/issue', { startAt: '0', maxResults: '50', fields: fieldList }, controller.signal));
    const samples = [];
    for (const item of boardPage.issues.slice(0, 3)) {
      const sample = issue.extend({ changelog: z.object({ startAt: z.number(), total: z.number(), maxResults: z.number(), histories: z.array(history) }) }).parse(await get(`/rest/api/2/issue/${item.id}`, { fields: fieldList, expand: 'changelog' }, controller.signal));
      // Preserve history counts, ordering and timestamps, but no authors/comments/descriptions.
      sample.changelog.histories = sample.changelog.histories.map(h => ({ ...h, items: h.items.filter(i => i.field === 'status' || i.field === 'Flagged' || i.fieldId === 'customfield_10000') }));
      samples.push(sample);
    }
    const report = { mode: 'sample-only', checkedAt: new Date().toISOString(), ...plan, filter, boardPage, samples,
      verifiedBoardSelection: false, note: 'Первая страница и три примера не подтверждают полную видимую выборку или длинную историю.' };
    await deps.save(report); return report;
  } finally { controller.abort(); client.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== '--execute')) { console.error('Поддерживается только --execute.'); process.exitCode = 1; }
  else try {
    const report = await verifyBoardSample(process.argv.includes('--execute'), { credentials: readPat, save: async report => {
      const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.local-data');
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(path.join(directory, 'jira-sample.tmp'), JSON.stringify(report, null, 2), { mode: 0o600 });
      await rename(path.join(directory, 'jira-sample.tmp'), path.join(directory, 'jira-sample.json'));
    } });
    console.log(report.mode === 'dry-run' ? JSON.stringify(report, null, 2) : 'Очищенная выборка сохранена: .local-data/jira-sample.json. Полная видимость доски ещё не подтверждена.');
  } catch (error) { console.error(safeError(error).message); process.exitCode = 1; }
}
