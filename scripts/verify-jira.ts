import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { JiraClient } from '../server/jira/client';
import { readPat } from '../server/jira/keychain';
import { safeError } from '../server/errors';

const requests = ['/rest/api/2/serverInfo', '/rest/api/2/myself', '/rest/api/2/field', '/rest/agile/1.0/board/1482/configuration'] as const;
interface Dependencies {
  credentials: (signal: AbortSignal) => Promise<string>;
  get?: (path: string, signal: AbortSignal) => Promise<unknown>;
  save: (report: unknown) => Promise<void>;
}
const scalarId = z.union([z.string(), z.number()]);
const configuration = z.object({ id: scalarId, name: z.string(), type: z.string(),
  filter: z.object({ id: scalarId }).optional(),
  subQuery: z.object({ query: z.string() }).optional(),
  columnConfig: z.object({ columns: z.array(z.object({ name: z.string(), statuses: z.array(z.object({ id: scalarId })) })) }).optional(),
});
export async function verifyJira(execute = false, deps: Dependencies) {
  const plan = { origin: 'https://hq.tutu.ru', requests: requests.map(path => ({ method: 'GET', path })), keychain: ['Code Jira Relations PAT', 'tutu-jira'], output: '.local-data/jira-capabilities.json' };
  if (!execute) return { mode: 'dry-run', ...plan, note: 'PAT и сеть не используются. --execute требует отдельного разрешения. Этот шаг проверяет только метаданные; историю и выборку доски он не подтверждает.' };
  const controller = new AbortController();
  const client = new JiraClient(await deps.credentials(controller.signal));
  const get = deps.get ?? ((path: string, signal: AbortSignal) => client.get(path, {}, signal));
  try {
    const server = z.object({ version: z.string(), deploymentType: z.string().optional() }).parse(await get(requests[0], controller.signal));
    const identity = await get(requests[1], controller.signal);
    z.object({ key: z.string().optional(), name: z.string().optional(), accountId: z.string().optional() }).refine(v => !!(v.key || v.name || v.accountId)).parse(identity);
    const fields = z.array(z.object({ id: z.string(), name: z.string(), schema: z.object({ type: z.string(), custom: z.string().optional(), items: z.string().optional() }).optional() })).parse(await get(requests[2], controller.signal));
    let board: z.infer<typeof configuration> | null = null;
    let boardError: ReturnType<typeof safeError> | null = null;
    try { board = configuration.parse(await get(requests[3], controller.signal)); }
    catch (error) { boardError = safeError(error); }
    const report = { mode: 'metadata-only', ...plan, checkedAt: new Date().toISOString(), authenticated: true, server, fields, board, boardError,
      verifiedHistory: false, verifiedBoardSelection: false, note: 'Не является рабочим профилем адаптера. Нужны сверка документации версии, полная история и контроль видимой выборки.' };
    await deps.save(report); return report;
  } finally { controller.abort(); client.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (process.argv.slice(2).some(arg => arg !== '--execute')) { console.error('Поддерживается только --execute; без него показывается план.'); process.exitCode = 1; }
  else {
    try {
      const report = await verifyJira(process.argv.includes('--execute'), {
        credentials: readPat,
        save: async report => {
          const directory = path.join(root, '.local-data');
          await mkdir(directory, { recursive: true, mode: 0o700 });
          const temporary = path.join(directory, 'jira-capabilities.tmp');
          await writeFile(temporary, JSON.stringify(report, null, 2), { mode: 0o600 });
          await rename(temporary, path.join(directory, 'jira-capabilities.json'));
        },
      });
      console.log(report.mode === 'dry-run' ? JSON.stringify(report, null, 2) : 'Проверены метаданные. Отчёт: .local-data/jira-capabilities.json. История и выборка ещё не подтверждены.');
    } catch (error) { console.error(safeError(error).message); process.exitCode = 1; }
  }
}
