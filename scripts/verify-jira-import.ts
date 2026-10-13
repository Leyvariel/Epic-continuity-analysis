import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { CacheStore } from '../server/cache';
import { DatasetService } from '../server/service';
import { ServerJiraAdapter, profileSchema } from '../server/jira/adapter';
import { JiraClient } from '../server/jira/client';
import { readPat } from '../server/jira/keychain';
import { AppError, safeError } from '../server/errors';
import type { ImportJobV3 } from '../shared/contracts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv.includes('--execute')) console.log('План: CSV/XLSX и одиночная ссылка только для первых трёх задач уже разрешённой выборки jira-sample.json; повторное обновление одной задачи и восстановление кэша без сети. GET только /rest/api/2/issue/<их id>, те же поля и changelog. Результат отдельно в .local-data/jira-smoke, пользовательский набор не заменяется.');
else try {
  const sample = JSON.parse(await readFile(path.join(root, '.local-data/jira-sample.json'), 'utf8')) as { samples: { id: string; key: string }[] };
  const profile = profileSchema.parse(JSON.parse(await readFile(path.join(root, '.local-data/jira-profile.json'), 'utf8')));
  if (sample.samples.length !== 3 || sample.samples.some(s => !/^\d+$/.test(s.id) || !/^[A-Z][A-Z0-9_]*-\d+$/.test(s.key))) throw new AppError('SAMPLE_INVALID', 'Нужна разрешённая выборка из трёх задач.');
  const ids = new Map(sample.samples.map(s => [s.key, s.id]));
  const asOf = new Date().toISOString();
  const cache = new CacheStore(path.join(root, '.local-data/jira-smoke'));
  const service = new DatasetService(cache, () => asOf, async signal => {
    const client = new JiraClient(await readPat(signal));
    return new ServerJiraAdapter({ close: () => client.close(), get: async (requestPath, params, signal) => {
      const identifier = requestPath.replace('/rest/api/2/issue/', '');
      const id = ids.get(identifier) ?? identifier;
      if (!requestPath.startsWith('/rest/api/2/issue/') || !sample.samples.some(s => s.id === id)) throw new AppError('SCOPE_LIMIT', 'Запрос вне разрешённых трёх задач остановлен.');
      return client.get(`/rest/api/2/issue/${id}`, { ...params, fields: 'summary,status,issuetype,resolution,created,updated,customfield_10000,customfield_43824' }, signal);
    } }, profile, () => asOf);
  });
  const finish = async (job: ImportJobV3) => { await service.waitForIdle(); if (job.status !== 'completed' || !job.dataset) throw new AppError('SMOKE_FAILED', job.errors.map(e => e.message).join(' ') || 'Проверка загрузки не завершена.'); return job.dataset; };
  const keys = sample.samples.map(s => s.key);
  const csv = await finish(service.importJiraFile(Buffer.from(['Ключ', ...keys].join('\n')), 'keys.csv'));
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Ключ'], ...keys.map(key => [key])]), 'Ключи');
  const xlsx = await finish(service.importJiraFile(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), 'keys.xlsx'));
  const projection = (data: typeof csv) => data.epics.map(e => ({ key: e.summary.key, ttmMs: e.ttmMs, ttmState: e.ttmState, intervals: e.intervals, initial: e.initialOpenIntervals, preTtm: e.preTtmIntervals, impedimentMs: e.impedimentMs }));
  if (JSON.stringify(projection(csv)) !== JSON.stringify(projection(xlsx))) throw new AppError('SOURCE_MISMATCH', 'CSV и XLSX дали разные интервалы на одном срезе.');
  const epic = await finish(service.importEpic(`https://hq.tutu.ru/browse/${keys[0]}`));
  if (JSON.stringify(projection(epic)[0]) !== JSON.stringify(projection(csv)[0])) throw new AppError('SOURCE_MISMATCH', 'Одиночный эпик отличается от файлового набора.');
  const refreshed = await finish(service.refresh(epic.id));
  const restored = new DatasetService(cache, () => '2030-01-01T00:00:00Z', async () => { throw new Error('Network forbidden on restore'); });
  await restored.initialize();
  if (JSON.stringify(restored.getDataset()) !== JSON.stringify(refreshed)) throw new AppError('CACHE_MISMATCH', 'Кэш изменил срез или результат.');
  const report = { checkedAt: asOf, scopes: keys, fileModesEqual: true, singleEpicEqual: true, refresh: 'passed', offlineRestore: 'passed', boardVerified: false,
    results: csv.epics.map(e => ({ key: e.summary.key, ttmMs: e.ttmMs, state: e.ttmState, quality: e.quality, statusCoverage: e.statusCoverage, flagCoverage: e.flagCoverage, warnings: e.warnings.map(w => w.code) })) };
  await writeFile(path.join(root, '.local-data/jira-smoke/report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
} catch (error) { console.error(safeError(error).message); process.exitCode = 1; }
