import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ServerJiraAdapter, profileSchema } from '../server/jira/adapter';
import { JiraClient } from '../server/jira/client';
import { readPat } from '../server/jira/keychain';
import { AppError, safeError } from '../server/errors';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv.includes('--execute')) console.log('Проверка рабочего адаптера: только разрешённые GET страниц доски 1482, конфигурации 1482 и фильтра 33407. Сопоставление ключей с полным контрольным чтением. Истории и отдельные задачи не запрашиваются.');
else {
  let client: JiraClient | undefined;
  try {
    const report = JSON.parse(await readFile(path.join(root, '.local-data/jira-board.json'), 'utf8')) as { stable: boolean; tasks: { id: string; key: string; fields: { status: { id: string } } }[] };
    const meta = JSON.parse(await readFile(path.join(root, '.local-data/jira-capabilities.json'), 'utf8'));
    const profile = profileSchema.parse(JSON.parse(await readFile(path.join(root, '.local-data/jira-profile.json'), 'utf8')));
    if (!report.stable) throw new AppError('UNSTABLE_REFERENCE', 'Контрольное чтение нестабильно.');
    const signal = new AbortController().signal;
    client = new JiraClient(await readPat(signal));
    const adapter = new ServerJiraAdapter({ get: (url, params, signal) => {
      if (!['/rest/agile/1.0/board/1482/configuration', '/rest/agile/1.0/board/1482/issue', '/rest/api/2/filter/33407'].includes(url)) throw new AppError('SCOPE_LIMIT', 'Запрос вне разрешённого объёма остановлен.');
      return client!.get(url, params, signal);
    } }, profile);
    const selected = await adapter.readBoard('1482', signal);
    const columns: { statuses: { id: string }[] }[] = meta.board.columnConfig.columns;
    const mapped = new Set(columns.flatMap(column => column.statuses.map(status => status.id)));
    const expected = report.tasks.filter(task => mapped.has(task.fields.status.id)).map(task => task.id).sort();
    const actual = selected.candidates.map(candidate => candidate.issueId!).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new AppError('BOARD_MISMATCH', 'Выборка отличается от контрольного чтения; проверьте изменения доски.');
    const result = { checkedAt: new Date().toISOString(), matched: true, count: actual.length, completedVisibility: 'all', evidence: 'Правило скрытия подтверждено пользователем; фильтр, подфильтр, колонки и все страницы прочитаны через API.', fullHistoryImportChecked: false };
    await writeFile(path.join(root, '.local-data/jira-board-adapter.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(safeError(error).message); process.exitCode = 1; }
  finally { client?.close(); }
}
