import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { JiraClient } from '../server/jira/client';
import { readPat } from '../server/jira/keychain';
import { collectPages } from '../server/jira/pagination';
import { safeError, AppError } from '../server/errors';
import { normalize, isRejected } from '../shared/statuses';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pageSchema = z.object({ startAt: z.number(), total: z.number(), issues: z.array(z.object({ id: z.string(), key: z.string(), fields: z.object({ status: z.object({ id: z.string(), name: z.string() }), issuetype: z.object({ id: z.string(), name: z.string() }), resolution: z.object({ id: z.string(), name: z.string() }).nullable() }) })) });
if (!process.argv.includes('--execute')) console.log('План: GET всех страниц /rest/agile/1.0/board/1482/issue, только id/key/status/issuetype/resolution, стабильная сортировка по ключу, два чтения для сверки состава, не более 10 000 кандидатов. Истории не читаются. GET конфигурации 1482 и фильтра 33407 для проверки неизменности настроек. Очищенный отчёт .local-data/jira-board.json. Требуется отдельное разрешение на все страницы.');
else {
  const signal = new AbortController().signal;
  let client: JiraClient | undefined;
  try {
    const meta = JSON.parse(await readFile(path.join(root, '.local-data/jira-capabilities.json'), 'utf8'));
    if (meta.board?.id !== 1482 || meta.board?.filter?.id !== '33407') throw new AppError('SCOPE_CHANGED', 'Нет согласованной конфигурации доски 1482 / фильтра 33407.');
    client = new JiraClient(await readPat(signal));
    const get = client.get.bind(client);
    const config = await get('/rest/agile/1.0/board/1482/configuration', {}, signal);
    const filter = z.object({ id: z.string(), jql: z.string() }).parse(await get('/rest/api/2/filter/33407', {}, signal));
    const load = () => collectPages(async startAt => {
      const page = pageSchema.parse(await get('/rest/agile/1.0/board/1482/issue', { startAt: String(startAt), maxResults: '100', fields: 'status,issuetype,resolution', jql: 'ORDER BY key ASC' }, signal));
      return { ...page, values: page.issues };
    }, { maxItems: 10_000, maxPages: 500 });
    const first = await load(), second = await load();
    const afterConfig = await get('/rest/agile/1.0/board/1482/configuration', {}, signal);
    const afterFilter = z.object({ id: z.string(), jql: z.string() }).parse(await get('/rest/api/2/filter/33407', {}, signal));
    const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const stable = fingerprint(first) === fingerprint(second) && fingerprint(config) === fingerprint(afterConfig) && fingerprint(filter) === fingerprint(afterFilter);
    const hf = second.filter(i => /^\[HF\]/.test(normalize(i.fields.status.name)) && i.fields.issuetype.id === '6' && !isRejected(i.fields.resolution?.name ?? '') && !isRejected(i.fields.status.name));
    const report = { checkedAt: new Date().toISOString(), stable, count: second.length, hfCount: hf.length, statusNames: [...new Set(second.map(i => i.fields.status.name))],
      apiKeys: second.map(i => i.key), hfKeys: hf.map(i => i.key), tasks: second,
      configurationKeys: typeof config === 'object' && config ? Object.keys(config) : [],
      columnConfigurationKeys: typeof config === 'object' && config && 'columnConfig' in config && typeof config.columnConfig === 'object' && config.columnConfig ? Object.keys(config.columnConfig) : [],
      configurationFingerprint: fingerprint(config), filterFingerprint: fingerprint(filter), verifiedBoardVisibility: false,
      note: 'Полнота API-страниц не доказывает совпадение с видимыми карточками. Нужна независимая сверка постоянной видимости, включая скрытие завершённых.' };
    await writeFile(path.join(root, '.local-data/jira-board.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ stable, count: report.count, hfCount: report.hfCount, statusNames: report.statusNames, report: '.local-data/jira-board.json', verifiedBoardVisibility: false }, null, 2));
  } catch (error) { console.error(safeError(error).message); process.exitCode = 1; }
  finally { client?.close(); }
}
